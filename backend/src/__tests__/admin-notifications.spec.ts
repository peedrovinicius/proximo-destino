import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import {
  CancellationRequestStatus,
  PurchasePaymentMethod,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { AdminNotificationsService } from '../notifications/admin-notifications.service'
import { PrismaService } from '../prisma/prisma.service'

describe('histórico persistente de notificações administrativas', () => {
  const prisma = new PrismaService()
  const notifications = new AdminNotificationsService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const userId = `notification-admin-${suffix}`
  const clientId = `notification-client-${suffix}`
  const tripId = `notification-trip-${suffix}`
  const reservationId = `notification-reservation-${suffix}`
  const orderId = `notification-order-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.user.create({
      data: {
        id: userId,
        email: `notification-admin-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    const local = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Fortaleza',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Cliente Notificação',
        email: `notification-client-${suffix}@example.com`,
        phone: '85999990000',
        birthDate: new Date(
          Date.UTC(
            1992,
            Number(local.month) - 1,
            Number(local.day),
            12,
          ),
        ),
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem de Notificação',
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
        status: ReservationStatus.PENDING,
        cancellationRequestStatus: CancellationRequestStatus.PENDING,
        cancellationRequestedAt: new Date(),
        cancellationRequestReason: 'Teste do histórico',
      },
    })

    await prisma.purchaseOrder.create({
      data: {
        id: orderId,
        reservationId,
        paymentMethod: PurchasePaymentMethod.PIX,
        unitPriceCents: 32000,
        passengerCount: 1,
        totalCents: 32000,
      },
    })
  })

  after(async () => {
    await prisma.adminNotification.deleteMany({ where: { userId } })
    await prisma.purchaseOrder.deleteMany({ where: { id: orderId } })
    await prisma.reservation.deleteMany({ where: { id: reservationId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it('gera alertas uma única vez e mantém histórico persistente', async () => {
    const first = await notifications.list(userId)
    const types = new Set(first.items.map((item) => item.type))

    assert.ok(types.has('RESERVATION_PENDING'))
    assert.ok(types.has('PAYMENT_PENDING'))
    assert.ok(types.has('TRIP_UPCOMING'))
    assert.ok(types.has('BIRTHDAY'))
    assert.ok(types.has('CANCELLATION_REQUEST'))
    assert.ok(first.unreadCount >= 5)

    const initialCount = await prisma.adminNotification.count({
      where: {
        userId,
        sourceKey: { contains: suffix },
      },
    })

    await notifications.list(userId)

    const afterSecondSync = await prisma.adminNotification.count({
      where: {
        userId,
        sourceKey: { contains: suffix },
      },
    })

    assert.equal(initialCount, 5)
    assert.equal(afterSecondSync, initialCount)
  })

  it('marca individual e todas como lidas sem apagar o histórico', async () => {
    const feed = await notifications.list(userId)
    const firstUnread = feed.items.find((item) => !item.isRead)
    assert.ok(firstUnread)

    const read = await notifications.markRead(userId, firstUnread.id)
    assert.equal(read.isRead, true)
    assert.ok(read.readAt)

    const all = await notifications.markAllRead(userId)
    assert.ok(all.updated >= 0)

    await notifications.list(userId)

    const scoped = await prisma.adminNotification.findMany({
      where: {
        userId,
        sourceKey: { contains: suffix },
      },
    })

    assert.equal(scoped.length, 5)
    assert.ok(scoped.every((item) => item.isRead))
  })

  it('mantém a notificação no histórico após a pendência ser resolvida', async () => {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.CONFIRMED,
        cancellationRequestStatus: CancellationRequestStatus.REJECTED,
      },
    })

    const feed = await notifications.list(userId)

    assert.ok(
      feed.items.some((item) => item.type === 'RESERVATION_PENDING'),
    )
    assert.ok(
      feed.items.some((item) => item.type === 'CANCELLATION_REQUEST'),
    )
  })
})
