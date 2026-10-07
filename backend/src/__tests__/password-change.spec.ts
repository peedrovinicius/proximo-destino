import 'reflect-metadata'
import assert from 'node:assert/strict'
import { before, after, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import * as argon2 from 'argon2'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { UserRole } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import { AuthController } from '../auth/auth.controller'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CompanyScopeService } from '../tenancy/company-scope.service'
import { SessionService } from '../auth/session.service'
import { AuditService } from '../auth/audit.service'
import type { MfaService } from '../auth/mfa.service'

describe('self-service password change in isolated PostgreSQL', () => {
  const prisma = new PrismaService(), jwt = new JwtService(), ids: string[] = []
  const currentPassword = 'Synthetic-current-password-2026', newPassword = 'Synthetic-new-password-2026'
  const config = new ConfigService({ COMPANY_FOUNDATION_ENABLED: 'true', JWT_ACCESS_SECRET: 'synthetic-password-access',
    JWT_REFRESH_SECRET: 'synthetic-password-refresh', JWT_MFA_SECRET: 'synthetic-password-mfa', AUDIT_HASH_KEY: 'synthetic-password-audit' })
  const auth = new AuthService(prisma, jwt, config, { verify: async () => true } as unknown as MfaService,
    new SessionService(prisma, config), new AuditService(prisma, config))
  let app: INestApplication, base: string
  before(async () => {
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(new URL(process.env.DATABASE_URL!).hostname))
    await prisma.$connect()
    const module = await Test.createTestingModule({ controllers: [AuthController], providers: [JwtAuthGuard, CompanyScopeService,
      { provide: AuthService, useValue: auth }, { provide: ConfigService, useValue: config }, { provide: PrismaService, useValue: prisma }] }).compile()
    app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.listen(0, '127.0.0.1'); base = await app.getUrl()
  })
  after(async () => {
    await app?.close()
    await prisma.authAuditEvent.deleteMany({ where: { userId: { in: ids } } })
    await prisma.authSession.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect()
  })
  async function fixture(role: UserRole = 'CREATOR') {
    const id = `password-${randomUUID()}`; ids.push(id)
    const user = await prisma.user.create({ data: { id, email: `${id}@example.invalid`, role,
      mfaEnabled: role === 'CREATOR', passwordHash: await argon2.hash(currentPassword) } })
    const sessions = await Promise.all([1, 2].map(() => prisma.authSession.create({ data: { userId: id,
      refreshTokenHash: 'synthetic', expiresAt: new Date(Date.now() + 300_000) } })))
    const token = await jwt.signAsync({ sub: id, sid: sessions[0].id, type: 'access', authVersion: 0 },
      { secret: config.get<string>('JWT_ACCESS_SECRET') })
    return { user, sessions, token }
  }
  const call = (token: string, body: object) => fetch(`${base}/auth/password/change`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  it('changes only the authenticated creator password, clears cookie and revokes old sessions and MFA challenges', async () => {
    const { user, sessions, token } = await fixture()
    const challenge = await auth.loginCreator(user.email, currentPassword, {})
    assert.ok('challengeToken' in challenge)
    assert.equal((await call(token, { currentPassword, newPassword, userId: 'someone-else' })).status, 400)
    assert.equal((await call(token, { currentPassword, newPassword: 'too-short' })).status, 400)
    assert.equal((await call(token, { currentPassword, newPassword: currentPassword })).status, 400)
    const response = await call(token, { currentPassword, newPassword })
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(response.headers.get('set-cookie')!, /pd_refresh=;/)
    assert.deepEqual(await response.json(), { passwordChanged: true, allSessionsRevoked: true })
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    assert.ok(await argon2.verify(saved.passwordHash, newPassword)); assert.equal(await argon2.verify(saved.passwordHash, currentPassword), false)
    assert.equal(saved.authVersion, 1); assert.equal(saved.mfaEnabled, true)
    assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 0)
    await assert.rejects(auth.verifyAccessToken(token), { status: 401 })
    await assert.rejects(auth.verifyMfa(challenge.challengeToken!, '123456', {}), { status: 401 })
    // A session created late by an in-flight login still cannot use the old credential version.
    await prisma.authSession.update({ where: { id: sessions[0].id }, data: { revokedAt: null } })
    await assert.rejects(auth.verifyAccessToken(token), { status: 401 })
    const missingVersion = await jwt.signAsync({ sub: user.id, sid: sessions[0].id, type: 'access' }, { secret: config.get<string>('JWT_ACCESS_SECRET') })
    await assert.rejects(auth.verifyAccessToken(missingVersion), { status: 401 })
    const newChallenge = await auth.loginCreator(user.email, newPassword, {})
    assert.ok('challengeToken' in newChallenge)
    const logged = await auth.verifyMfa(newChallenge.challengeToken!, '123456', {})
    assert.equal((await auth.verifyAccessToken(logged.accessToken)).id, user.id)
    const events = JSON.stringify(await prisma.authAuditEvent.findMany({ where: { userId: user.id } }))
    for (const secret of [currentPassword, newPassword, saved.passwordHash]) assert.equal(events.includes(secret), false)
  })
  it('persists five incorrect current passwords and locks subsequent attempts without changing credentials', async () => {
    const { user, sessions } = await fixture('AGENT')
    for (let i = 0; i < 5; i++) await assert.rejects(auth.changePassword(user.id, sessions[0].id, 'Incorrect-synthetic-password', newPassword), { status: 401 })
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    assert.ok(saved.lockedUntil! > new Date()); assert.equal(saved.passwordHash, user.passwordHash)
    assert.equal(saved.authVersion, 0)
    await assert.rejects(auth.changePassword(user.id, sessions[0].id, currentPassword, newPassword), { status: 401 })
    assert.equal(await prisma.authAuditEvent.count({ where: { userId: user.id, eventType: 'PASSWORD_CHANGE_FAILED' } }), 5)
  })
  it('rolls back new password, version, session revocations and failure counters when audit fails', async () => {
    const { user, sessions } = await fixture('ADMIN')
    const failing = new AuthService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) => prisma.$transaction(tx =>
      callback(new Proxy(tx, { get: (target, key) => key === 'authAuditEvent' ? { create: async () => { throw new Error('synthetic password audit failure') } } : Reflect.get(target, key) }))),
    } as unknown as PrismaService, jwt, config, {} as MfaService, {} as SessionService, {} as AuditService)
    for (const password of [currentPassword, 'Incorrect-synthetic-password']) {
      await assert.rejects(failing.changePassword(user.id, sessions[0].id, password, newPassword), /synthetic password audit failure/)
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), user)
      assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 2)
    }
  })
  it('refuses revoked, expired and foreign sessions, inactive users and client accounts', async () => {
    const { user, sessions } = await fixture('FINANCE')
    await assert.rejects(auth.changePassword(user.id, 'foreign-session', currentPassword, newPassword), { status: 401 })
    await prisma.authSession.update({ where: { id: sessions[0].id }, data: { revokedAt: new Date() } })
    await assert.rejects(auth.changePassword(user.id, sessions[0].id, currentPassword, newPassword), { status: 401 })
    await prisma.authSession.update({ where: { id: sessions[1].id }, data: { expiresAt: new Date(0) } })
    await assert.rejects(auth.changePassword(user.id, sessions[1].id, currentPassword, newPassword), { status: 401 })
    const client = await fixture('CLIENT')
    await assert.rejects(auth.changePassword(client.user.id, client.sessions[0].id, currentPassword, newPassword), { status: 401 })
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
    await assert.rejects(auth.changePassword(user.id, sessions[0].id, currentPassword, newPassword), { status: 401 })
  })
})
