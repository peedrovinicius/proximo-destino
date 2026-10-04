import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { NotFoundException } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { AdminNotificationsService } from '../notifications/admin-notifications.service'
import { PrismaService } from '../prisma/prisma.service'

describe('alertas de segurança persistentes e restritos em PostgreSQL isolado', () => {
  const prisma = new PrismaService()
  const notifications = new AdminNotificationsService(prisma)
  const suffix = randomUUID()
  const admin = `security-admin-${suffix}`
  const agent = `security-agent-${suffix}`
  let connected = false
  let alertId: string

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test', 'Requires isolated test environment')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    await prisma.$connect()
    connected = true
    await prisma.user.createMany({ data: [
      { id: admin, email: `${admin}@example.com`, passwordHash: 'synthetic', role: UserRole.ADMIN },
      { id: agent, email: `${agent}@example.com`, passwordHash: 'synthetic', role: UserRole.AGENT },
    ] })
    await prisma.authAuditEvent.create({ data: {
      userId: admin, eventType: 'LOGIN_LOCKED', emailHash: 'synthetic-private-email-hash',
      ipHash: 'synthetic-private-ip-hash', metadata: { token: 'synthetic-sensitive-metadata' },
    } })
  })

  after(async () => {
    if (!connected) return
    try {
      await prisma.adminNotification.deleteMany({ where: { userId: { in: [admin, agent] } } })
      await prisma.authAuditEvent.deleteMany({ where: { userId: admin } })
      await prisma.user.deleteMany({ where: { id: { in: [admin, agent] } } })
    } finally { await prisma.$disconnect() }
  })

  it('gera e persiste alerta para ADMIN sem expor hashes ou metadados', async () => {
    const feed = await notifications.list(admin)
    const alert = feed.items.find(item => item.type === 'SECURITY_AUTH_ANOMALY')
    assert.ok(alert)
    alertId = alert.id
    assert.equal(alert.actionTab, 'audit')
    assert.equal(alert.isRead, false)
    assert.ok(!JSON.stringify(alert).includes('synthetic-private'))
    assert.ok(!JSON.stringify(alert).includes('synthetic-sensitive'))
    const agentFeed = await notifications.list(agent)
    assert.ok(agentFeed.items.every(item => item.type !== 'SECURITY_AUTH_ANOMALY'))
    await assert.rejects(notifications.markRead(agent, alertId), NotFoundException)
  })

  it('sincronizações concorrentes não duplicam o alerta nem o tornam não lido novamente', async () => {
    const where = { userId: admin, type: 'SECURITY_AUTH_ANOMALY' }
    const initial = await prisma.adminNotification.count({ where })
    await Promise.all(Array.from({ length: 6 }, () => notifications.syncUser(admin)))
    assert.equal(await prisma.adminNotification.count({ where }), initial)
    await notifications.markRead(admin, alertId)
    await notifications.syncUser(admin)
    assert.equal((await prisma.adminNotification.findUniqueOrThrow({ where: { id: alertId } })).isRead, true)
  })

  it('rebaixar ADMIN retira leitura e marcação dos alertas de segurança antigos', async () => {
    await prisma.user.update({ where: { id: admin }, data: { role: UserRole.AGENT } })
    const feed = await notifications.list(admin)
    assert.ok(feed.items.every(item => item.type !== 'SECURITY_AUTH_ANOMALY'))
    await assert.rejects(notifications.markRead(admin, alertId), NotFoundException)
    await prisma.adminNotification.update({ where: { id: alertId }, data: { isRead: false, readAt: null } })
    await notifications.markAllRead(admin)
    assert.equal((await prisma.adminNotification.findUniqueOrThrow({ where: { id: alertId } })).isRead, false)
  })
})
