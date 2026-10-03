import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import {
  PurchasePaymentMethod,
  PurchaseStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { EmailAutomationService } from '../notifications/email-automation.service'
import { PrismaService } from '../prisma/prisma.service'

describe('automação transacional de e-mail', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const adminId = `email-admin-${suffix}`
  const clientId = `email-client-${suffix}`
  const tripId = `email-trip-${suffix}`
  const reservationId = `email-reservation-${suffix}`
  const purchaseId = `email-purchase-${suffix}`
  const clientEmail = `cliente-${suffix}@example.com`
  const adminEmail = `admin-${suffix}@example.com`

  const config = new ConfigService({
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'Próximo Destino <noreply@example.com>',
    ADMIN_EMAIL: adminEmail,
    PUBLIC_API_URL: 'https://api.example.com/api/v1',
  })
  const service = new EmailAutomationService(prisma, config)
  const originalFetch = globalThis.fetch

  before(async () => {
    await prisma.$connect()

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
        fullName: 'Cliente E-mail',
        email: clientEmail,
        phone: '85999994444',
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem E-mail',
        origin: 'Fortaleza',
        destination: 'Recife',
        departureDate: new Date(Date.now() + 10 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 20,
        priceCents: 24_000,
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
        unitPriceCents: 24_000,
        passengerCount: 1,
        totalCents: 24_000,
        paidAt: new Date(),
      },
    })
  })

  after(async () => {
    globalThis.fetch = originalFetch
    await prisma.emailOutboundMessage.deleteMany({
      where: {
        OR: [
          { sourceId: reservationId },
          { sourceId: purchaseId },
        ],
      },
    })
    await prisma.purchaseOrder.deleteMany({ where: { id: purchaseId } })
    await prisma.reservation.deleteMany({ where: { id: reservationId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.user.deleteMany({ where: { id: adminId } })
    await prisma.$disconnect()
  })

  it('enfileira uma única reserva com código de acesso e cópia administrativa', async () => {
    await service.enqueueReservationCreated(
      reservationId,
      'ABCDE-12345',
    )
    await service.enqueueReservationCreated(
      reservationId,
      'ABCDE-12345',
    )

    const messages = await prisma.emailOutboundMessage.findMany({
      where: {
        eventType: 'RESERVATION_CREATED',
        sourceId: reservationId,
      },
    })

    assert.equal(messages.length, 1)
    assert.equal(messages[0].recipientEmail, clientEmail)
    assert.match(messages[0].textBody, /ABCDE-12345/)
    assert.deepEqual(messages[0].adminCopyEmails, [adminEmail])
  })

  it('envia pelo provedor com cliente em TO e administração em BCC', async () => {
    await service.enqueuePaymentConfirmed(purchaseId)

    const providerBodies: Array<{
      to?: unknown
      bcc?: unknown
      from?: unknown
    }> = []

    globalThis.fetch = async (_input, init) => {
      providerBodies.push(
        JSON.parse(String(init?.body ?? '{}')) as {
          to?: unknown
          bcc?: unknown
          from?: unknown
        },
      )
      return new Response(JSON.stringify({ id: 'resend-e2e-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await service.processNow()
    assert.ok(result.processed >= 1)

    const providerBody = providerBodies[0]
    assert.ok(providerBody)
    assert.deepEqual(providerBody.to, [clientEmail])
    assert.deepEqual(providerBody.bcc, [adminEmail])
    assert.equal(
      providerBody.from,
      'Próximo Destino <noreply@example.com>',
    )

    const sent = await prisma.emailOutboundMessage.findFirstOrThrow({
      where: {
        eventType: 'PAYMENT_CONFIRMED',
        sourceId: purchaseId,
      },
    })
    assert.equal(sent.status, 'SENT')
    assert.equal(sent.providerMessageId, 'resend-e2e-id')
    assert.ok(sent.sentAt)
  })

  it('expõe status do provedor e da cópia administrativa', async () => {
    const status = await service.status()
    assert.equal(status.providerConfigured, true)
    assert.equal(status.adminCopyConfigured, true)
    assert.equal(status.deliveryMode, 'RESEND_API')
  })
})
