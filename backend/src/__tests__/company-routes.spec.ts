import 'reflect-metadata'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { AuthModule } from '../auth/auth.module'
import { AuthService } from '../auth/auth.service'
import { SessionService } from '../auth/session.service'
import type { MfaService } from '../auth/mfa.service'
import type { AuditService } from '../auth/audit.service'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'
import { TenancyModule } from '../tenancy/tenancy.module'
import { ClientsController } from '../clients/clients.controller'
import { ClientsService } from '../clients/clients.service'
import { AdminTripsController } from '../trips/admin-trips.controller'
import { TripsService } from '../trips/trips.service'
import { AdminController } from '../admin/admin.controller'
import { AdminService } from '../admin/admin.service'

describe('company HTTP reads and legacy route gate in isolated PostgreSQL', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID()
  const owner = `route-owner-${suffix}`
  const users = [`route-a-${suffix}`, `route-b-${suffix}`, `route-legacy-${suffix}`]
  const companies = [`route-company-a-${suffix}`, `route-company-b-${suffix}`]
  const clients = [`route-client-a-${suffix}`, `route-client-b-${suffix}`]
  const trips = [`route-trip-a-${suffix}`, `route-trip-b-${suffix}`]
  const reservations = [`route-reservation-a-${suffix}`, `route-reservation-b-${suffix}`]
  const sessions = users.map(id => `session-${id}`)
  const tokens: string[] = []
  let unboundToken: string
  let unboundSession: string
  let app: INestApplication | undefined
  let base: string
  let connected = false
  let legacyWrites = 0
  const config = new ConfigService({ JWT_ACCESS_SECRET: 'synthetic-http-access-secret-only-for-tests',
    AUDIT_HASH_KEY: 'synthetic-http-audit-key-only-for-tests' })
  const jwt = new JwtService()
  const auth = new AuthService(prisma, jwt, config, {} as MfaService, new SessionService(prisma, config),
    { record: async () => {} } as unknown as AuditService)
  const sign = (user: string, session: string) => jwt.signAsync({ sub: user, sid: session, type: 'access',
    role: 'ADMIN', companyId: companies[1] }, { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '10m' })

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname))
    await prisma.$connect(); connected = true
    await prisma.user.createMany({ data: [owner, ...users].map(id => ({ id,
      email: `${id}@example.invalid`, passwordHash: 'synthetic-unusable', role: id === owner ? 'CREATOR' : 'ADMIN' })) })
    for (let i = 0; i < 2; i++) {
      await prisma.company.create({ data: { id: companies[i], slug: companies[i], tradeName: companies[i],
        status: 'ACTIVE', contactEmail: 'contact@example.invalid', responsibleName: 'Synthetic responsible',
        responsibleEmail: 'responsible@example.invalid', createdById: owner } })
      await prisma.companyMembership.create({ data: { userId: users[i], companyId: companies[i], role: 'ADMIN' } })
      await prisma.client.create({ data: { id: clients[i], companyId: companies[i], fullName: `Synthetic ${i}` } })
      await prisma.trip.create({ data: { id: trips[i], companyId: companies[i], title: `Synthetic ${i}`,
        origin: 'Fortaleza', destination: 'Recife', departureDate: new Date('2027-01-01') } })
      await prisma.reservation.create({ data: { id: reservations[i], companyId: companies[i], clientId: clients[i], tripId: trips[i] } })
    }
    for (let i = 0; i < users.length; i++) {
      await prisma.authSession.create({ data: { id: sessions[i], userId: users[i], companyId: companies[i] ?? null,
        refreshTokenHash: 'synthetic-unusable', expiresAt: new Date(Date.now() + 300_000) } })
      tokens.push(await sign(users[i], sessions[i]))
    }
    const unbound = await prisma.authSession.create({ data: { userId: users[0], refreshTokenHash: 'synthetic-unusable',
      expiresAt: new Date(Date.now() + 300_000) } })
    unboundSession = unbound.id; unboundToken = await sign(users[0], unbound.id)
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, TenancyModule],
      controllers: [ClientsController, AdminTripsController, AdminController], providers: [
        { provide: ClientsService, useValue: { list: () => ['legacy'], findById: () => ({ id: 'legacy' }),
          create: () => { legacyWrites++; return { id: 'legacy' } }, credits: () => ['legacy'] } },
        { provide: TripsService, useValue: { listAdmin: () => ['legacy'], create: () => { legacyWrites++; return { id: 'legacy' } } } },
        { provide: AdminService, useValue: { listReservations: () => ['legacy'], dashboard: () => ({ legacy: true }),
          createReservation: () => { legacyWrites++; return { id: 'legacy' } } } },
      ],
    }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthService).useValue(auth).compile()
    app = module.createNestApplication({ logger: false }); await app.listen(0, '127.0.0.1'); base = await app.getUrl()
  })
  after(async () => {
    if (!connected) return
    try {
      await app?.close()
      await prisma.reservation.deleteMany({ where: { id: { in: reservations } } })
      await prisma.client.deleteMany({ where: { id: { in: clients } } })
      await prisma.trip.deleteMany({ where: { id: { in: trips } } })
      await prisma.authSession.deleteMany({ where: { userId: { in: users } } })
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: companies } } })
      await prisma.company.deleteMany({ where: { id: { in: companies } } })
      await prisma.user.deleteMany({ where: { id: { in: [owner, ...users] } } })
    } finally { await prisma.$disconnect() }
  })
  const call = (path: string, token = tokens[0], method = 'GET') => fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })

  it('uses persisted company despite a forged company claim and serves only own lists', async () => {
    assert.equal((await auth.verifyAccessToken(tokens[0])).companyId, companies[0])
    for (const [path, id] of [['/admin/clients', clients[0]], ['/admin/trips', trips[0]], ['/admin/reservations', reservations[0]]]) {
      const response = await call(path); assert.equal(response.status, 200)
      assert.deepEqual((await response.json() as { id: string }[]).map(row => row.id), [id])
    }
  })
  it('serves own client detail and hides foreign details', async () => {
    assert.equal((await call(`/admin/clients/${clients[0]}`)).status, 200)
    assert.equal((await call(`/admin/clients/${clients[1]}`)).status, 404)
    assert.equal((await call(`/admin/clients/${clients[0]}`, tokens[1])).status, 404)
  })
  it('blocks company sessions from unscoped dashboard, credit, finance and writes', async () => {
    for (const path of ['/admin/dashboard', `/admin/clients/${clients[0]}/credits`, '/admin/payments/orders']) {
      assert.equal((await call(path)).status, 403)
    }
    for (const path of ['/admin/clients', '/admin/trips', '/admin/reservations']) assert.equal((await call(path, tokens[0], 'POST')).status, 403)
    assert.equal(legacyWrites, 0)
  })
  it('never falls back to legacy routes for an unbound session of a managed user', async () => {
    assert.equal((await call('/admin/clients', unboundToken)).status, 403)
    assert.equal((await call('/admin/dashboard', unboundToken)).status, 403)
  })
  it('preserves explicitly unassigned legacy accounts', async () => {
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: users[2] } })).companyManaged, false)
    const response = await call('/admin/clients', tokens[2]); assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), ['legacy'])
    assert.equal((await call('/admin/dashboard', tokens[2])).status, 200)
  })
  it('allows company users to view/revoke only their own sessions', async () => {
    const response = await call('/auth/sessions'); assert.equal(response.status, 200)
    const result = await response.json() as { id: string }[]
    assert.ok(result.some(row => row.id === sessions[0])); assert.ok(result.every(row => row.id !== sessions[1]))
    assert.equal((await call(`/auth/sessions/${sessions[1]}`, tokens[0], 'DELETE')).status, 204)
    assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: sessions[1] } })).revokedAt, null)
  })
  it('revocation and deletion do not restore global access, and the marker cannot be cleared', async () => {
    await prisma.companyMembership.deleteMany({ where: { userId: users[0] } })
    assert.equal((await call('/admin/clients')).status, 403)
    assert.equal((await call('/admin/dashboard', unboundToken)).status, 403)
    assert.equal((await auth.verifyAccessToken(unboundToken)).requiresCompanyScope, true)
    await assert.rejects(prisma.user.update({ where: { id: users[0] }, data: { companyManaged: false } }), /cannot become legacy/)
    assert.equal((await call('/auth/sessions')).status, 200)
    assert.ok(unboundSession)
  })
})
