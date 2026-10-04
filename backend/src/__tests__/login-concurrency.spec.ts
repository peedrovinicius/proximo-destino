import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { UserRole } from '@prisma/client'
import * as argon2 from 'argon2'
import { randomUUID } from 'node:crypto'
import { AuthService, LOCK_MINUTES } from '../auth/auth.service'
import { AuditService } from '../auth/audit.service'
import { MfaService } from '../auth/mfa.service'
import { SessionService } from '../auth/session.service'
import { PrismaService } from '../prisma/prisma.service'

describe('bloqueio de login sob concorrência em PostgreSQL isolado', () => {
  const prisma = new PrismaService()
  const id = `login-race-${randomUUID()}`
  const email = `${id}@example.com`
  const password = 'Synthetic-password-for-test-2026'
  let connected = false
  let hash: string
  const events: string[] = []

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test', 'Requires isolated test environment')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    await prisma.$connect()
    connected = true
    hash = await argon2.hash(password)
    await prisma.user.create({ data: { id, email, passwordHash: hash, role: UserRole.ADMIN } })
  })

  after(async () => {
    if (!connected) return
    try { await prisma.user.deleteMany({ where: { id } }) }
    finally { await prisma.$disconnect() }
  })

  function service(read = async () => await prisma.user.findUnique({ where: { id } })) {
    const scoped = {
      user: { findUnique: read, updateMany: prisma.user.updateMany.bind(prisma.user) },
      $queryRaw: prisma.$queryRaw.bind(prisma),
    } as unknown as PrismaService
    return new AuthService(scoped, new JwtService(),
      new ConfigService({ JWT_MFA_SECRET: 'synthetic-mfa-secret-only-for-tests' }),
      {} as MfaService, {} as SessionService,
      { record: async (event: string) => { events.push(event) } } as unknown as AuditService)
  }

  async function reset() {
    events.length = 0
    await prisma.user.update({ where: { id }, data: {
      failedLoginAttempts: 0, lockedUntil: null, passwordHash: hash, isActive: true, role: UserRole.ADMIN,
    } })
  }

  it('conta cinco falhas quando doze requisições leem o mesmo estado inicial', async () => {
    await reset()
    let reads = 0
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const auth = service(async () => {
      const snapshot = await prisma.user.findUnique({ where: { id } })
      if (++reads === 12) release()
      await ready
      return snapshot
    })
    const start = Date.now()
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => auth.loginAdmin(email, 'Wrong-password-for-test', {})))
    assert.ok(results.every(r => r.status === 'rejected' && r.reason instanceof UnauthorizedException))
    const user = await prisma.user.findUniqueOrThrow({ where: { id } })
    assert.equal(user.failedLoginAttempts, 0)
    assert.ok(user.lockedUntil)
    assert.ok(user.lockedUntil.getTime() >= start + LOCK_MINUTES * 60_000)
    assert.equal(events.filter(e => e === 'LOGIN_FAILED').length, 4)
    assert.equal(events.filter(e => e === 'LOGIN_LOCKED').length, 1)
    assert.equal(events.filter(e => e === 'LOGIN_BLOCKED').length, 7)
    const deadline = user.lockedUntil
    await assert.rejects(service().loginAdmin(email, password, {}), UnauthorizedException)
    assert.deepEqual((await prisma.user.findUniqueOrThrow({ where: { id } })).lockedUntil, deadline)
  })

  it('senha correta em andamento não remove bloqueio posterior à leitura', async () => {
    await reset()
    const deadline = new Date(Date.now() + LOCK_MINUTES * 60_000)
    const auth = service(async () => {
      const snapshot = await prisma.user.findUnique({ where: { id } })
      await prisma.user.update({ where: { id }, data: { lockedUntil: deadline } })
      return snapshot
    })
    await assert.rejects(auth.loginAdmin(email, password, {}), UnauthorizedException)
    assert.deepEqual((await prisma.user.findUniqueOrThrow({ where: { id } })).lockedUntil, deadline)
    assert.deepEqual(events, ['LOGIN_BLOCKED'])
  })

  it('senha correta após expiração zera falhas e preserva exigência de MFA', async () => {
    await reset()
    await prisma.user.update({ where: { id }, data: { failedLoginAttempts: 4, lockedUntil: new Date(Date.now() - 1000) } })
    const result = await service().loginAdmin(email, password, {})
    assert.equal(result.status, 'mfa_setup_required')
    const user = await prisma.user.findUniqueOrThrow({ where: { id } })
    assert.equal(user.failedLoginAttempts, 0)
    assert.equal(user.lockedUntil, null)
  })

  it('não autentica senha substituída durante a verificação', async () => {
    await reset()
    const replacement = await argon2.hash('Another-synthetic-password-2026')
    const auth = service(async () => {
      const snapshot = await prisma.user.findUnique({ where: { id } })
      await prisma.user.update({ where: { id }, data: { passwordHash: replacement } })
      return snapshot
    })
    await assert.rejects(auth.loginAdmin(email, password, {}), UnauthorizedException)
    assert.deepEqual(events, ['LOGIN_BLOCKED'])
  })
})
