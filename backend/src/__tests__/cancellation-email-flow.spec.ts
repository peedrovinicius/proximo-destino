import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  PurchasePaymentMethod,
  PurchaseStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { EmailAutomationService } from '../notifications/email-automation.service'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'

describe('cancelamento com comunicação transacional', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const adminId = `cancel-email-admin-${suffix}`
  const clientId = `cancel-email-client-${suffix}`
  const tripId = `cancel-email-trip-${suffix}`
  const reservationId = `cancel-email-reservation-${suffix}`
  const purchaseId = `cancel-email-purchase-${suffix}`
  const clientEmail = `cancel-email-${suffix}@example.com`
  const adminEmail = `cancel-email-admin-${suffix}@example.com`

  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'cancel-email-test-secret',
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'Próximo Destino <noreply@example.com>',
    ADMIN_EMAIL: adminEmail,
    PUBLIC_API_URL: 'https://api.example.com/api/v1',
  })

  const email = new EmailAutomationService(prisma, config)
  const portal = new PortalService(
    prisma,
    new JwtService(),
    config,
  )
  const admin = new AdminService(prisma)

  before(async () => {
    await prisma.$connect()

    ;(portal as unknown as { email?: EmailAutomationService }).email = email
    ;(admin as unknown as { email?: EmailAutomationService }).email = email

    await prisma.user.create({
      data: {
        id: adminId,
        email: adminEmail,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Cliente Cancelamento',
        email: clientEmail,
        phone: '85999990000',
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem Cancelamento',
        origin: 'Fortaleza',
        destination: 'Natal',
        departureDate: new Date(Date.now() + 20 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 20,
        priceCents: 32_000,
      },
    })

    await prisma.reservation.create({
      data: {
        id: reservationId,
        clientId,
        tripId,
        status: ReservationStatus.CONFIRMED,
        passengerCount: 1,
      },
    })

    await prisma.purchaseOrder.create({
      data: {
        id: purchaseId,
        reservationId,
        status: PurchaseStatus.PAID,
        paymentMethod: PurchasePaymentMethod.PIX,
        unitPriceCents: 32_000,
        passengerCount: 1,
        totalCents: 32_000,
        paidAt: new Date(),
      },
    })

    await prisma.seatAssignment.create({
      data: {
        tripId,
        reservationId,
        seatNumber: 5,
      },
    })
  })

  after(async () => {
    await prisma.emailOutboundMessage.deleteMany({
      where: { sourceId: reservationId },
    })
    await prisma.clientCreditTransaction.deleteMany({
      where: { clientId },
    })
    await prisma.authAuditEvent.deleteMany({
      where: { userId: adminId },
    })
    await prisma.seatAssignment.deleteMany({
      where: { reservationId },
    })
    await prisma.purchaseOrder.deleteMany({
      where: { id: purchaseId },
    })
    await prisma.reservation.deleteMany({
      where: { id: reservationId },
    })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.user.deleteMany({ where: { id: adminId } })
    await prisma.$disconnect()
  })

  it('avisa pedido e conclusão do cancelamento para cliente e administração', async () => {
    const requested = await portal.requestCancellation(
      clientId,
      reservationId,
      'Mudança de planos',
    )
    assert.equal(requested.cancellationRequestStatus, 'PENDING')

    const requestMessage =
      await prisma.emailOutboundMessage.findFirstOrThrow({
        where: {
          eventType: 'CANCELLATION_REQUESTED',
          sourceId: reservationId,
        },
      })
    assert.equal(requestMessage.recipientEmail, clientEmail)
    const requestCopies = Array.isArray(requestMessage.adminCopyEmails)
      ? requestMessage.adminCopyEmails
      : []
    assert.ok(requestCopies.includes(adminEmail))

    const result = await admin.cancelReservation(
      reservationId,
      true,
      'Crédito integral para próxima viagem',
      adminId,
    )

    assert.equal(result.cancelled, true)
    assert.equal(result.paidCents, 32_000)
    assert.equal(result.bonusGrantedCents, 32_000)

    const cancelledMessage =
      await prisma.emailOutboundMessage.findFirstOrThrow({
        where: {
          eventType: 'RESERVATION_CANCELLED',
          sourceId: reservationId,
        },
      })
    assert.equal(cancelledMessage.recipientEmail, clientEmail)
    const cancelledCopies = Array.isArray(cancelledMessage.adminCopyEmails)
      ? cancelledMessage.adminCopyEmails
      : []
    assert.ok(cancelledCopies.includes(adminEmail))
    assert.ok(cancelledMessage.textBody.includes('320,00'))

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
    })
    assert.equal(reservation.status, ReservationStatus.CANCELLED)

    assert.equal(
      await prisma.seatAssignment.count({
        where: { reservationId },
      }),
      0,
    )
  })
})
