import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  CancellationRequestStatus,
  PurchasePaymentMethod,
  PurchaseStatus,
  QuoteStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { ClientsService } from '../clients/clients.service'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'

describe('cancelamento com bônus do cliente', () => {
  const prisma = new PrismaService()
  const admin = new AdminService(prisma)
  const clients = new ClientsService(prisma)
  const portal = new PortalService(
    prisma,
    new JwtService(),
    new ConfigService({
      JWT_ACCESS_SECRET: 'cancellation-request-test-secret',
    }),
  )
  const suffix = randomUUID().slice(0, 8)

  const actorId = `bonus-actor-${suffix}`
  const clientId = `bonus-client-${suffix}`
  const tripId = `bonus-trip-${suffix}`
  const nextTripId = `bonus-next-trip-${suffix}`
  const reservationId = `bonus-reservation-${suffix}`
  const nextReservationId = `bonus-next-reservation-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.user.create({
      data: {
        id: actorId,
        email: `bonus-admin-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Cliente com bônus',
        email: `bonus-client-${suffix}@example.com`,
      },
    })

    await prisma.trip.createMany({
      data: [
        {
          id: tripId,
          title: 'Viagem cancelada',
          origin: 'Fortaleza',
          destination: 'Natal',
          departureDate: new Date(Date.now() + 5 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 20,
        },
        {
          id: nextTripId,
          title: 'Próxima viagem',
          origin: 'Fortaleza',
          destination: 'Recife',
          departureDate: new Date(Date.now() + 15 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 20,
        },
      ],
    })

    await prisma.reservation.create({
      data: {
        id: reservationId,
        clientId,
        tripId,
        status: ReservationStatus.CONFIRMED,
      },
    })

    const passenger = await prisma.reservationPassenger.create({
      data: {
        reservationId,
        sequence: 1,
        fullName: 'Cliente com bônus',
        isPrimary: true,
      },
    })

    await prisma.seatAssignment.create({
      data: {
        tripId,
        reservationId,
        passengerId: passenger.id,
        seatNumber: 4,
      },
    })

    await prisma.purchaseOrder.create({
      data: {
        reservationId,
        status: PurchaseStatus.PAID,
        paymentMethod: PurchasePaymentMethod.PIX,
        unitPriceCents: 32000,
        passengerCount: 1,
        totalCents: 32000,
      },
    })

    await prisma.reservation.create({
      data: {
        id: nextReservationId,
        clientId,
        tripId: nextTripId,
        status: ReservationStatus.CONFIRMED,
      },
    })

    await prisma.quote.create({
      data: {
        reservationId: nextReservationId,
        revision: 1,
        status: QuoteStatus.APPROVED,
        title: 'Cotação próxima viagem',
        subtotalCostCents: 20000,
        subtotalSaleCents: 40000,
        discountCents: 0,
        totalCents: 40000,
        marginCents: 20000,
        approvedAt: new Date(),
      },
    })
  })

  after(async () => {
    await prisma.clientCreditTransaction.deleteMany({
      where: { clientId },
    })
    await prisma.purchaseOrder.deleteMany({
      where: { reservationId },
    })
    await prisma.quote.deleteMany({
      where: { reservationId: nextReservationId },
    })
    await prisma.reservation.deleteMany({
      where: { clientId },
    })
    await prisma.trip.deleteMany({
      where: { id: { in: [tripId, nextTripId] } },
    })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.authAuditEvent.deleteMany({ where: { userId: actorId } })
    await prisma.user.deleteMany({ where: { id: actorId } })
    await prisma.$disconnect()
  })

  it('solicita, aprova, cancela, libera assento e converte pagamento em bônus uma única vez', async () => {
    const request = await portal.requestCancellation(
      clientId,
      reservationId,
      'Mudança de planos do passageiro',
    )

    assert.equal(
      request.cancellationRequestStatus,
      CancellationRequestStatus.PENDING,
    )
    assert.equal(request.cancellationFinancial.reviewableCents, 32000)

    const result = await admin.cancelReservation(
      reservationId,
      true,
      'Cliente preferiu manter crédito',
      actorId,
    )

    assert.equal(result.paidCents, 32000)
    assert.equal(result.bonusGrantedCents, 32000)

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        status: true,
        cancellationRequestStatus: true,
        seatAssignments: true,
        purchaseOrder: { select: { status: true } },
      },
    })

    assert.equal(reservation?.status, ReservationStatus.CANCELLED)
    assert.equal(
      reservation?.cancellationRequestStatus,
      CancellationRequestStatus.APPROVED,
    )
    assert.equal(reservation?.seatAssignments.length, 0)
    assert.equal(
      reservation?.purchaseOrder?.status,
      PurchaseStatus.PAID,
    )

    const finance = await admin.reservationFinance(reservationId)
    assert.equal(finance.summary.grossPaidCents, 32000)
    assert.equal(finance.summary.refundedCents, 0)
    assert.equal(finance.summary.refundableCents, 32000)

    const second = await admin.cancelReservation(
      reservationId,
      true,
      'Tentativa repetida',
      actorId,
    )
    assert.equal(second.bonusGrantedCents, 32000)

    const credits = await clients.credits(clientId)
    assert.equal(credits.balanceCents, 32000)
    assert.equal(
      credits.transactions.filter(
        (item) => item.type === 'CANCELLATION_CREDIT',
      ).length,
      1,
    )
  })

  it('permite ao administrador recusar a solicitação sem cancelar a reserva', async () => {
    const request = await portal.requestCancellation(
      clientId,
      nextReservationId,
      'Quero avaliar outra data',
    )

    assert.equal(
      request.cancellationRequestStatus,
      CancellationRequestStatus.PENDING,
    )

    const rejected = await admin.rejectCancellationRequest(
      nextReservationId,
      'A agência entrou em contato e manteve a viagem.',
      actorId,
    )
    assert.equal(rejected.rejected, true)

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: nextReservationId },
      select: {
        status: true,
        cancellationRequestStatus: true,
        cancellationRequestResolutionNote: true,
      },
    })

    assert.equal(reservation.status, ReservationStatus.CONFIRMED)
    assert.equal(
      reservation.cancellationRequestStatus,
      CancellationRequestStatus.REJECTED,
    )
    assert.match(
      reservation.cancellationRequestResolutionNote ?? '',
      /manteve a viagem/i,
    )
  })

  it('usa bônus como desconto da próxima cotação e permite retirada manual', async () => {
    const applied = await admin.applyBonus(
      nextReservationId,
      12000,
      'Usar no próximo pacote',
      actorId,
    )

    assert.equal(applied.remainingBonusCents, 20000)
    assert.equal(applied.quoteTotalCents, 28000)

    const quote = await prisma.quote.findFirst({
      where: { reservationId: nextReservationId },
      select: {
        discountCents: true,
        totalCents: true,
      },
    })
    assert.equal(quote?.discountCents, 12000)
    assert.equal(quote?.totalCents, 28000)

    const removed = await clients.removeBonus(
      clientId,
      5000,
      'Ajuste administrativo',
      actorId,
    )
    assert.equal(removed.balanceCents, 15000)

    const types = removed.transactions.map((item) => item.type)
    assert.ok(types.includes('BONUS_USED'))
    assert.ok(types.includes('BONUS_REMOVED'))
  })
})
