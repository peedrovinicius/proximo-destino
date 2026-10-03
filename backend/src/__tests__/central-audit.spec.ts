import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { UserRole } from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { PrismaService } from '../prisma/prisma.service'

describe('central de auditoria operacional', () => {
  const prisma = new PrismaService()
  const admin = new AdminService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const adminId = `audit-admin-${suffix}`
  const financeId = `audit-finance-${suffix}`
  const reservationId = `audit-reservation-${suffix}`
  const tripId = `audit-trip-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          email: `audit-admin-${suffix}@example.com`,
          passwordHash: 'test-hash',
          role: UserRole.ADMIN,
        },
        {
          id: financeId,
          email: `audit-finance-${suffix}@example.com`,
          passwordHash: 'test-hash',
          role: UserRole.FINANCE,
        },
      ],
    })

    await prisma.authAuditEvent.createMany({
      data: [
        {
          userId: adminId,
          eventType: 'OPS_RESERVATION_STATUS_CHANGED',
          metadata: {
            reservationId,
            beforeStatus: 'PENDING',
            afterStatus: 'CONFIRMED',
          },
        },
        {
          userId: adminId,
          eventType: 'OPS_SEAT_BLOCKED',
          metadata: {
            tripId,
            seatNumber: 12,
          },
        },
        {
          userId: financeId,
          eventType: 'OPS_MANUAL_PAYMENT_RECEIVED',
          metadata: {
            reservationId,
            amountCents: 25000,
            method: 'CASH',
          },
        },
        {
          userId: adminId,
          eventType: 'OPS_MERCADO_PAGO_DISCONNECTED',
          metadata: {
            provider: 'MERCADO_PAGO',
          },
        },
      ],
    })
  })

  after(async () => {
    await prisma.authAuditEvent.deleteMany({
      where: {
        userId: { in: [adminId, financeId] },
      },
    })
    await prisma.user.deleteMany({
      where: {
        id: { in: [adminId, financeId] },
      },
    })
    await prisma.$disconnect()
  })

  it('classifica eventos por área operacional', async () => {
    const result = await admin.auditTrail('ALL', 'ALL', suffix)

    const categories = new Set(
      result.events.map((event) => event.category),
    )

    assert.ok(categories.has('RESERVATIONS'))
    assert.ok(categories.has('SEATS'))
    assert.ok(categories.has('FINANCE'))
    assert.ok(categories.has('SETTINGS'))
  })

  it('filtra por função e categoria', async () => {
    const finance = await admin.auditTrail(
      'FINANCE',
      'FINANCE',
      reservationId,
    )

    assert.equal(finance.events.length, 1)
    assert.equal(
      finance.events[0].eventType,
      'OPS_MANUAL_PAYMENT_RECEIVED',
    )
    assert.equal(finance.events[0].user?.role, UserRole.FINANCE)
  })

  it('permite localizar evento por identificador da entidade', async () => {
    const result = await admin.auditTrail(
      'RESERVATIONS',
      'ADMIN',
      reservationId,
    )

    assert.equal(result.events.length, 1)
    assert.equal(
      result.events[0].eventType,
      'OPS_RESERVATION_STATUS_CHANGED',
    )
    assert.equal(result.summary.total, 1)
  })
})
