import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  BoardingStatus,
  InstallmentStatus,
  ManualPaymentMethod,
  ManualPaymentStatus,
  PurchaseStatus,
  QuoteStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { DocumentsService } from '../documents/documents.service'
import { EmailAutomationService } from '../notifications/email-automation.service'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('E2E do ciclo completo da viagem', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const actorId = `e2e-admin-${suffix}`
  const journeyTripId = `e2e-journey-${suffix}`
  const cancelTripId = `e2e-cancel-${suffix}`
  const nextTripId = `e2e-next-${suffix}`
  const manualTripId = `e2e-manual-${suffix}`
  const journeyEmail = `e2e-journey-${suffix}@example.com`
  const cancelEmail = `e2e-cancel-${suffix}@example.com`
  const manualEmail = `e2e-manual-${suffix}@example.com`

  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'full-lifecycle-test-secret',
    PUBLIC_API_URL: 'http://localhost:3000/api/v1',
    ADMIN_EMAIL: `e2e-admin-${suffix}@example.com`,
    EMAIL_FROM: 'Próximo Destino <noreply@example.com>',
    RESEND_API_KEY: 're_e2e_fake_key_not_sent',
  })

  const paymentConnection = {
    status: async () => ({ readyForPayments: true }),
    getAccessToken: async () => 'fake-access-token',
  }

  const email = new EmailAutomationService(prisma, config)
  const portal = new PortalService(
    prisma,
    new JwtService(),
    config,
    paymentConnection as never,
    undefined,
    email,
  )
  const admin = new AdminService(prisma)
  const trips = new TripsService(prisma)
  const documents = new DocumentsService(prisma, config)

  const portalInternals = portal as unknown as {
    initializePurchasePayment: (
      purchaseOrderId: string,
    ) => Promise<Record<string, unknown>>
    applyPurchaseStatus: (
      purchaseOrderId: string,
      status: PurchaseStatus,
      provider?: {
        paymentId?: string
        orderId?: string
        providerStatus?: string
      },
    ) => Promise<unknown>
  }

  before(async () => {
    await prisma.$connect()

    portalInternals.initializePurchasePayment = async () => ({
      provider: 'MERCADO_PAGO',
      kind: 'PIX',
      status: 'pending',
      qrCode: 'E2E-PIX-CODE',
      qrCodeBase64: null,
      ticketUrl: null,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    })

    await prisma.user.create({
      data: {
        id: actorId,
        email: `e2e-admin-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    const departure = new Date(Date.now() + 30 * 86_400_000)
    await prisma.trip.createMany({
      data: [
        {
          id: journeyTripId,
          title: 'E2E Jornada Completa',
          origin: 'Fortaleza',
          destination: 'Recife',
          departureDate: departure,
          status: TripStatus.SCHEDULED,
          capacity: 8,
          priceCents: 25_000,
        },
        {
          id: cancelTripId,
          title: 'E2E Cancelamento e Bônus',
          origin: 'Fortaleza',
          destination: 'Natal',
          departureDate: new Date(departure.getTime() + 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 8,
          priceCents: 32_000,
        },
        {
          id: nextTripId,
          title: 'E2E Uso do Bônus',
          origin: 'Fortaleza',
          destination: 'João Pessoa',
          departureDate: new Date(departure.getTime() + 2 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 8,
          priceCents: 40_000,
        },
        {
          id: manualTripId,
          title: 'E2E Financeiro Manual',
          origin: 'Fortaleza',
          destination: 'Maceió',
          departureDate: new Date(departure.getTime() + 3 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 8,
          priceCents: 30_000,
        },
      ],
    })
  })

  after(async () => {
    const tripIds = [
      journeyTripId,
      cancelTripId,
      nextTripId,
      manualTripId,
    ]

    const reservations = await prisma.reservation.findMany({
      where: { tripId: { in: tripIds } },
      select: { id: true, clientId: true },
    })
    const reservationIds = reservations.map((item) => item.id)
    const clientIds = [...new Set(reservations.map((item) => item.clientId))]

    await prisma.emailOutboundMessage.deleteMany({
      where: {
        OR: [
          { sourceId: { in: reservationIds } },
          { sourceId: { in: reservationIds.length ? reservationIds : ['__none__'] } },
        ],
      },
    })
    if (reservationIds.length) {
      const purchaseIds = await prisma.purchaseOrder.findMany({
        where: { reservationId: { in: reservationIds } },
        select: { id: true },
      })
      await prisma.emailOutboundMessage.deleteMany({
        where: { sourceId: { in: purchaseIds.map((item) => item.id) } },
      })
    }
    await prisma.travelDocument.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.clientCreditTransaction.deleteMany({
      where: { clientId: { in: clientIds } },
    })
    await prisma.manualPayment.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.purchaseOrder.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.financePlan.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.quote.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.reservationService.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.seatAssignment.deleteMany({
      where: { tripId: { in: tripIds } },
    })
    await prisma.reservationPassenger.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.reservation.deleteMany({
      where: { id: { in: reservationIds } },
    })
    await prisma.client.deleteMany({
      where: {
        OR: [
          { id: { in: clientIds } },
          { email: { in: [journeyEmail, cancelEmail, manualEmail] } },
        ],
      },
    })
    await prisma.trip.deleteMany({
      where: { id: { in: tripIds } },
    })
    await prisma.authAuditEvent.deleteMany({
      where: { userId: actorId },
    })
    await prisma.user.deleteMany({ where: { id: actorId } })
    await prisma.$disconnect()
  })

  it('compra, confirma pagamento, atualiza passageiros e assentos, emite documentos, valida QR e conclui embarque', async () => {
    const purchase = await portal.requestReservation({
      tripId: journeyTripId,
      fullName: 'Passageiro Principal E2E',
      email: journeyEmail,
      phone: '85999991111',
      passengerCount: 2,
      passengers: [
        { fullName: 'Passageiro Principal E2E' },
        { fullName: 'Acompanhante E2E' },
      ],
      selectedSeats: [1, 2],
      intent: 'PURCHASE',
      paymentMethod: 'PIX',
    })

    assert.ok(purchase.purchaseOrder)
    assert.equal(purchase.purchaseOrder?.status, PurchaseStatus.PENDING_PAYMENT)
    assert.deepEqual(purchase.selectedSeats, [1, 2])
    assert.equal(purchase.passengers.length, 2)

    await portalInternals.applyPurchaseStatus(
      purchase.purchaseOrder!.id,
      PurchaseStatus.PAID,
      {
        paymentId: `mp-e2e-${suffix}`,
        providerStatus: 'approved',
      },
    )

    const confirmed = await prisma.reservation.findUniqueOrThrow({
      where: { id: purchase.reservation.id },
      select: {
        clientId: true,
        status: true,
        purchaseOrder: true,
      },
    })
    assert.equal(confirmed.status, ReservationStatus.CONFIRMED)
    assert.equal(confirmed.purchaseOrder?.status, PurchaseStatus.PAID)
    assert.ok(confirmed.purchaseOrder?.paidAt)

    const transactionalEmails = await prisma.emailOutboundMessage.findMany({
      where: {
        OR: [
          { sourceId: purchase.reservation.id },
          { sourceId: purchase.purchaseOrder!.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })
    const eventTypes = transactionalEmails.map((message) => message.eventType)
    assert.ok(eventTypes.includes('RESERVATION_CREATED'))
    assert.ok(eventTypes.includes('PAYMENT_CONFIRMED'))
    assert.ok(eventTypes.includes('RESERVATION_CONFIRMED'))
    for (const message of transactionalEmails) {
      assert.equal(message.recipientEmail, journeyEmail)
      assert.ok(Array.isArray(message.adminCopyEmails))
      assert.ok(
        message.adminCopyEmails.includes(`e2e-admin-${suffix}@example.com`),
      )
      assert.ok(!message.adminCopyEmails.includes(journeyEmail))
    }

    const passengerUpdate = await portal.updateClientPassengers(
      confirmed.clientId,
      purchase.reservation.id,
      {
        passengers: purchase.passengers.map((passenger, index) => ({
          id: passenger.id,
          fullName:
            index === 0
              ? 'Passageiro Principal Atualizado'
              : 'Acompanhante Atualizado',
          document: index === 0 ? '12345678901' : '98765432100',
          birthDate: new Date(
            index === 0 ? '1995-05-10T00:00:00.000Z' : '1998-08-15T00:00:00.000Z',
          ),
        })),
      },
    )
    assert.equal(
      passengerUpdate.passengers[0]?.fullName,
      'Passageiro Principal Atualizado',
    )

    const changedSeats = await portal.updateClientSeats(
      confirmed.clientId,
      purchase.reservation.id,
      { selectedSeats: [1, 3] },
    )
    assert.deepEqual(
      changedSeats.seatAssignments.map((item) => item.seatNumber),
      [1, 3],
    )

    await prisma.quote.create({
      data: {
        reservationId: purchase.reservation.id,
        revision: 1,
        status: QuoteStatus.APPROVED,
        title: 'Compra E2E aprovada',
        subtotalCostCents: 35_000,
        subtotalSaleCents: 50_000,
        discountCents: 0,
        totalCents: 50_000,
        marginCents: 15_000,
        approvedAt: new Date(),
      },
    })

    const receipt = await documents.issuePurchaseReceipt(
      purchase.reservation.id,
      actorId,
      {},
    )
    const voucher = await documents.issueTravelVoucher(
      purchase.reservation.id,
      actorId,
      {},
    )

    const receiptRecord = await prisma.travelDocument.findUniqueOrThrow({
      where: { id: receipt.id },
      select: { snapshot: true },
    })
    const receiptSnapshot = receiptRecord.snapshot as {
      finance?: {
        totalCents: number
        paidCents: number
        outstandingCents: number
      } | null
    }

    assert.equal(receiptSnapshot.finance?.totalCents, 50_000)
    assert.equal(receiptSnapshot.finance?.paidCents, 50_000)
    assert.equal(receiptSnapshot.finance?.outstandingCents, 0)

    const [receiptPdf, voucherPdf] = await Promise.all([
      documents.renderAdminPdf(receipt.id, UserRole.ADMIN),
      documents.renderAdminPdf(voucher.id, UserRole.ADMIN),
    ])
    assert.ok(receiptPdf.buffer.length > 1_000)
    assert.ok(voucherPdf.buffer.length > 1_000)

    const scan = await trips.scanBoardingQr(
      journeyTripId,
      `PD-VERIFY:${voucher.verificationCode}`,
      actorId,
    )
    assert.equal(scan.reservationId, purchase.reservation.id)
    assert.equal(scan.passengerIds.length, 2)

    const boarded = await trips.bulkUpdateBoardingStatus(
      journeyTripId,
      scan.passengerIds,
      BoardingStatus.BOARDED,
      actorId,
    )
    assert.equal(boarded.summary.total, 2)
    assert.equal(boarded.summary.boarded, 2)
    assert.equal(boarded.summary.pending, 0)

    await trips.completeTrip(journeyTripId, actorId)

    const completed = await prisma.trip.findUniqueOrThrow({
      where: { id: journeyTripId },
      select: { status: true },
    })
    assert.equal(completed.status, TripStatus.COMPLETED)
  })

  it('cancela compra paga, gera bônus e usa o crédito em uma nova viagem', async () => {
    const purchase = await portal.requestReservation({
      tripId: cancelTripId,
      fullName: 'Cliente Bônus E2E',
      email: cancelEmail,
      phone: '85999992222',
      passengerCount: 1,
      passengers: [{ fullName: 'Cliente Bônus E2E' }],
      selectedSeats: [4],
      intent: 'PURCHASE',
      paymentMethod: 'PIX',
    })

    await portalInternals.applyPurchaseStatus(
      purchase.purchaseOrder!.id,
      PurchaseStatus.PAID,
      {
        paymentId: `mp-bonus-${suffix}`,
        providerStatus: 'approved',
      },
    )

    const client = await prisma.client.findUniqueOrThrow({
      where: { email: cancelEmail },
      select: { id: true },
    })

    const requested = await portal.requestCancellation(
      client.id,
      purchase.reservation.id,
      'Mudança de planos no E2E',
    )
    assert.equal(requested.cancellationRequestStatus, 'PENDING')

    const cancelled = await admin.cancelReservation(
      purchase.reservation.id,
      true,
      'Crédito integral para próxima viagem',
      actorId,
    )
    assert.equal(cancelled.cancelled, true)
    assert.equal(cancelled.paidCents, 32_000)
    assert.equal(cancelled.bonusGrantedCents, 32_000)

    const cancelledSeat = await prisma.seatAssignment.count({
      where: { reservationId: purchase.reservation.id },
    })
    assert.equal(cancelledSeat, 0)

    const nextReservation = await prisma.reservation.create({
      data: {
        clientId: client.id,
        tripId: nextTripId,
        status: ReservationStatus.CONFIRMED,
      },
    })
    await prisma.quote.create({
      data: {
        reservationId: nextReservation.id,
        revision: 1,
        status: QuoteStatus.APPROVED,
        title: 'Nova viagem com bônus',
        subtotalCostCents: 20_000,
        subtotalSaleCents: 40_000,
        discountCents: 0,
        totalCents: 40_000,
        marginCents: 20_000,
        approvedAt: new Date(),
      },
    })

    const bonus = await admin.applyBonus(
      nextReservation.id,
      12_000,
      'Uso parcial do bônus E2E',
      actorId,
    )
    assert.equal(bonus.appliedCents, 12_000)
    assert.equal(bonus.remainingBonusCents, 20_000)
    assert.equal(bonus.quoteTotalCents, 28_000)
  })

  it('registra pagamento manual parcial no comprovante e mantém a parcela cancelada após estorno', async () => {
    const client = await prisma.client.create({
      data: {
        fullName: 'Cliente Manual E2E',
        email: manualEmail,
        phone: '85999993333',
      },
    })
    const reservation = await prisma.reservation.create({
      data: {
        clientId: client.id,
        tripId: manualTripId,
        status: ReservationStatus.CONFIRMED,
      },
    })
    const quote = await prisma.quote.create({
      data: {
        reservationId: reservation.id,
        revision: 1,
        status: QuoteStatus.APPROVED,
        title: 'Financeiro manual E2E',
        subtotalCostCents: 20_000,
        subtotalSaleCents: 30_000,
        discountCents: 0,
        totalCents: 30_000,
        marginCents: 10_000,
        approvedAt: new Date(),
      },
    })
    const plan = await prisma.financePlan.create({
      data: {
        reservationId: reservation.id,
        quoteId: quote.id,
        totalCents: 30_000,
        installmentCount: 1,
        installments: {
          create: {
            sequence: 1,
            dueDate: new Date(Date.now() + 7 * 86_400_000),
            amountCents: 30_000,
          },
        },
      },
      include: { installments: true },
    })
    const installment = plan.installments[0]

    const partial = await admin.registerManualPayment(
      reservation.id,
      {
        amountCents: 10_000,
        method: ManualPaymentMethod.TRANSFER,
        installmentId: installment.id,
        reference: `TED-E2E-${suffix}`,
      },
      actorId,
    )
    assert.equal(partial.summary.netPaidCents, 10_000)
    assert.equal(partial.summary.outstandingCents, 20_000)

    const receipt = await documents.issuePurchaseReceipt(
      reservation.id,
      actorId,
      {},
    )
    const receiptRecord = await prisma.travelDocument.findUniqueOrThrow({
      where: { id: receipt.id },
      select: { snapshot: true },
    })
    const snapshot = receiptRecord.snapshot as {
      finance?: {
        paidCents: number
        outstandingCents: number
      } | null
    }
    assert.equal(snapshot.finance?.paidCents, 10_000)
    assert.equal(snapshot.finance?.outstandingCents, 20_000)

    const cancelled = await admin.cancelReservation(
      reservation.id,
      false,
      'Cancelamento com estorno do pagamento parcial',
      actorId,
    )
    assert.equal(cancelled.paidCents, 10_000)
    assert.equal(cancelled.bonusGrantedCents, 0)

    const payment = await prisma.manualPayment.findFirstOrThrow({
      where: {
        reservationId: reservation.id,
        status: ManualPaymentStatus.RECEIVED,
      },
    })

    await admin.reverseManualPayment(
      reservation.id,
      payment.id,
      'Estorno do lançamento após cancelamento',
      actorId,
    )

    const reversed = await prisma.manualPayment.findUniqueOrThrow({
      where: { id: payment.id },
    })
    assert.equal(reversed.status, ManualPaymentStatus.REVERSED)

    const finalInstallment = await prisma.installment.findUniqueOrThrow({
      where: { id: installment.id },
    })
    assert.equal(finalInstallment.status, InstallmentStatus.CANCELLED)
    assert.equal(finalInstallment.paidAt, null)
  })
})
