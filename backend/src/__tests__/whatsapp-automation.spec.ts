import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import {
  OutboundMessageStatus,
  PurchasePaymentMethod,
  PurchaseStatus,
  ReservationStatus,
  TripStatus,
} from '@prisma/client'
import { WhatsAppAutomationService } from '../notifications/whatsapp-automation.service'
import { PrismaService } from '../prisma/prisma.service'

describe('automação de WhatsApp', () => {
  const prisma = new PrismaService()
  const service = new WhatsAppAutomationService(
    prisma,
    new ConfigService({
      WHATSAPP_AUTOMATION_ENABLED: 'true',
      WHATSAPP_TEMPLATE_LANGUAGE: 'pt_BR',
    }),
  )

  const suffix = randomUUID().slice(0, 8)
  const clientId = `wa-client-${suffix}`
  const tripId = `wa-trip-${suffix}`
  const reservationId = `wa-reservation-${suffix}`
  const orderId = `wa-order-${suffix}`

  before(async () => {
    await prisma.$connect()

    const now = new Date()
    const localParts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Fortaleza',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(now)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )
    const birthday = new Date(
      Date.UTC(
        1990,
        Number(localParts.month) - 1,
        Number(localParts.day),
        12,
      ),
    )

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Cliente Automático',
        email: `whatsapp-${suffix}@example.com`,
        phone: '85999998888',
        birthDate: birthday,
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem WhatsApp',
        origin: 'Fortaleza',
        destination: 'Natal',
        departureDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: TripStatus.SCHEDULED,
        capacity: 20,
      },
    })

    await prisma.reservation.create({
      data: {
        id: reservationId,
        clientId,
        tripId,
        status: ReservationStatus.CONFIRMED,
      },
    })

    await prisma.purchaseOrder.create({
      data: {
        id: orderId,
        reservationId,
        status: PurchaseStatus.PAID,
        paymentMethod: PurchasePaymentMethod.PIX,
        unitPriceCents: 35000,
        passengerCount: 1,
        totalCents: 35000,
        paidAt: new Date(),
      },
    })
  })

  after(async () => {
    await prisma.outboundMessage.deleteMany({
      where: {
        OR: [
          { sourceId: clientId },
          { sourceId: reservationId },
          { sourceId: orderId },
        ],
      },
    })
    await prisma.purchaseOrder.deleteMany({ where: { id: orderId } })
    await prisma.reservation.deleteMany({ where: { id: reservationId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.$disconnect()
  })

  it('enfileira confirmação e pagamento sem duplicar', async () => {
    await service.enqueueReservationConfirmed(reservationId)
    await service.enqueueReservationConfirmed(reservationId)
    await service.enqueuePaymentConfirmed(orderId)
    await service.enqueuePaymentConfirmed(orderId)

    const messages = await prisma.outboundMessage.findMany({
      where: {
        sourceId: { in: [reservationId, orderId] },
        eventType: {
          in: ['RESERVATION_CONFIRMED', 'PAYMENT_CONFIRMED'],
        },
      },
      orderBy: { eventType: 'asc' },
    })

    assert.equal(messages.length, 2)
    assert.ok(
      messages.every((item) => item.status === OutboundMessageStatus.PENDING),
    )
    assert.ok(messages.every((item) => item.recipientPhone === '5585999998888'))
  })

  it('agenda lembrete de viagem e aniversário automaticamente', async () => {
    const result = await service.processNow()
    assert.equal(result.providerConfigured, false)
    assert.equal(result.deliveryMode, 'OUTBOX_ONLY')

    const messages = await prisma.outboundMessage.findMany({
      where: {
        OR: [
          {
            sourceId: reservationId,
            eventType: 'TRIP_REMINDER',
          },
          {
            sourceId: clientId,
            eventType: 'BIRTHDAY',
          },
        ],
      },
    })

    assert.ok(messages.some((item) => item.eventType === 'TRIP_REMINDER'))

    const localHour = Number(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Fortaleza',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    )

    if (localHour >= 8) {
      assert.ok(messages.some((item) => item.eventType === 'BIRTHDAY'))
    }
  })

  it('registra cancelamento e mantém o evento idempotente', async () => {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: ReservationStatus.CANCELLED },
    })

    await service.enqueueReservationCancelled(reservationId)
    await service.enqueueReservationCancelled(reservationId)

    const count = await prisma.outboundMessage.count({
      where: {
        sourceId: reservationId,
        eventType: 'RESERVATION_CANCELLED',
      },
    })

    assert.equal(count, 1)
  })
})
