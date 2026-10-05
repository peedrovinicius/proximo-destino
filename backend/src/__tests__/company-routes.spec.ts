import 'reflect-metadata'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
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
import { CompanyClientsService } from '../tenancy/company-clients.service'
import { CompanyScopeService } from '../tenancy/company-scope.service'
import { revealDocument } from '../security/sensitive-data'
import { CompanyTripsService } from '../tenancy/company-trips.service'
import { listBusTemplates } from '../trips/bus-templates'
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
        { provide: TripsService, useValue: { listAdmin: () => ['legacy'], busTemplates: () => listBusTemplates(),
          create: () => { legacyWrites++; return { id: 'legacy' } } } },
        { provide: AdminService, useValue: { listReservations: () => ['legacy'], dashboard: () => ({ legacy: true }),
          createReservation: () => { legacyWrites++; return { id: 'legacy' } } } },
      ],
    }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthService).useValue(auth).compile()
    app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1'); base = await app.getUrl()
  })
  after(async () => {
    if (!connected) return
    try {
      await app?.close()
      await prisma.reservation.deleteMany({ where: { id: { in: reservations } } })
      await prisma.authAuditEvent.deleteMany({ where: { userId: { in: users } } })
      await prisma.client.deleteMany({ where: { id: { in: clients } } })
      await prisma.trip.deleteMany({ where: { id: { in: trips } } })
      await prisma.authSession.deleteMany({ where: { userId: { in: users } } })
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: companies } } })
      await prisma.company.deleteMany({ where: { id: { in: companies } } })
      await prisma.user.deleteMany({ where: { id: { in: [owner, ...users] } } })
    } finally { await prisma.$disconnect() }
  })
  const call = (path: string, token = tokens[0], method = 'GET', body: object = {}) => fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(['POST', 'PATCH'].includes(method) ? { body: JSON.stringify(body) } : {}),
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
    assert.equal((await call('/admin/reservations', tokens[0], 'POST')).status, 403)
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
  it('creates in the persisted company and encrypts CPF without exposing internal fields', async () => {
    const response = await call('/admin/clients', tokens[0], 'POST', { fullName: 'Synthetic new client', document: '529.982.247-25' })
    assert.equal(response.status, 201)
    const saved = await response.json() as { id: string }
    clients.push(saved.id)
    const row = await prisma.client.findUniqueOrThrow({ where: { id: saved.id } })
    assert.equal(row.companyId, companies[0]); assert.equal(row.document, null)
    assert.equal(revealDocument(row), '52998224725')
    for (const key of ['document', 'documentHash', 'documentEncrypted', 'companyId', 'notes', 'userId']) assert.equal(key in saved, false)
    assert.equal(legacyWrites, 0)
  })
  it('updates only own clients and conceals foreign and missing IDs', async () => {
    assert.equal((await call(`/admin/clients/${clients[2]}`, tokens[0], 'PATCH', { fullName: 'Synthetic renamed' })).status, 200)
    for (const id of [clients[1], 'nonexistent']) {
      assert.equal((await call(`/admin/clients/${id}`, tokens[0], 'PATCH', { fullName: 'Forbidden edit' })).status, 404)
    }
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: clients[1] } })).fullName, 'Synthetic 1')
  })
  it('rejects injected ownership, invalid names/CPF and unscoped companion creation', async () => {
    for (const extra of [{ companyId: companies[1] }, { userId: users[1] }, { fullName: '  ' },
      { document: '11111111111' }, { companions: [{ fullName: 'Synthetic companion' }] }]) {
      assert.equal((await call('/admin/clients', tokens[0], 'POST', { fullName: 'Synthetic', ...extra })).status, 400)
    }
    assert.equal((await call(`/admin/clients/${clients[2]}`, tokens[0], 'PATCH', { companyId: companies[1] })).status, 400)
  })
  it('checks CPF uniqueness within one company and allows separate private profiles in another', async () => {
    assert.equal((await call('/admin/clients', tokens[0], 'POST', { fullName: 'Duplicate', document: '52998224725' })).status, 409)
    const response = await call('/admin/clients', tokens[1], 'POST', { fullName: 'Synthetic other', document: '52998224725' })
    assert.equal(response.status, 201); const result = await response.json() as { id: string }; clients.push(result.id)
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: result.id } })).companyId, companies[1])
  })
  it('preserves CPF on unrelated edits and clears it only when explicitly requested', async () => {
    await call(`/admin/clients/${clients[2]}`, tokens[0], 'PATCH', { phone: 'synthetic' })
    assert.equal(revealDocument(await prisma.client.findUniqueOrThrow({ where: { id: clients[2] } })), '52998224725')
    assert.equal((await call(`/admin/clients/${clients[2]}`, tokens[0], 'PATCH', { document: '' })).status, 200)
    const row = await prisma.client.findUniqueOrThrow({ where: { id: clients[2] } })
    assert.equal(row.documentEncrypted, null); assert.equal(row.documentHash, null)
    const audit = await prisma.authAuditEvent.findMany({ where: { userId: users[0], eventType: { startsWith: 'OPS_COMPANY_CLIENT_' } } })
    assert.ok(audit.length > 0); assert.equal(JSON.stringify(audit).includes('52998224725'), false)
  })
  it('rechecks revoked authorization inside the write transaction even after scope resolution', async () => {
    const resolved = await new CompanyScopeService(prisma).resolveSession(users[0], sessions[0])
    const writes = new CompanyClientsService(prisma, { resolveSession: async () => resolved } as unknown as CompanyScopeService)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try {
      await assert.rejects(writes.create(users[0], sessions[0], { fullName: 'Denied write' }), { status: 403 })
    } finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
  })
  it('serializes concurrent CPF creation in the same company', async () => {
    const responses = await Promise.all([0, 1].map(() => call('/admin/clients', tokens[0], 'POST', {
      fullName: 'Synthetic concurrent', document: '11144477735',
    })))
    for (const response of responses) if (response.status === 201) clients.push((await response.json() as { id: string }).id)
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409])
  })
  it('rolls back the client when its audit event cannot be recorded', async () => {
    const failing = new CompanyClientsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), client: tx.client,
        authAuditEvent: { create: async () => { throw new Error('synthetic audit failure') } } }))
    } as unknown as PrismaService, new CompanyScopeService(prisma))
    await assert.rejects(failing.create(users[0], sessions[0], { fullName: `Rollback ${suffix}` }), /synthetic audit failure/)
    assert.equal(await prisma.client.count({ where: { companyId: companies[0], fullName: `Rollback ${suffix}` } }), 0)
  })
  it('denies client writes for finance and for managed sessions without a company', async () => {
    assert.equal((await call('/admin/clients', unboundToken, 'POST', { fullName: 'Denied' })).status, 403)
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'FINANCE' } })
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'FINANCE' } })
    try {
      assert.equal((await call('/admin/clients', tokens[0], 'POST', { fullName: 'Denied' })).status, 403)
      assert.equal((await call(`/admin/clients/${clients[2]}`, tokens[0], 'PATCH', { fullName: 'Denied' })).status, 403)
    } finally {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } })
      await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'ADMIN' } })
    }
  })
  const draft = { title: 'Synthetic draft', origin: 'Fortaleza', destination: 'Recife', departureDate: '2027-01-01',
    returnDate: '2027-01-03', busTemplate: 'CUSTOM', capacity: 16, deckCount: 2, lowerDeckCapacity: 8,
    priceCents: 15000, blockedSeats: [1] }
  it('creates a company draft with validated vehicle configuration and no publication', async () => {
    assert.equal((await call('/admin/trips/bus-templates')).status, 200)
    const response = await call('/admin/trips', tokens[0], 'POST', draft)
    assert.equal(response.status, 201); const result = await response.json() as { id: string; status: string; capacity: number }
    trips.push(result.id); assert.equal(result.status, 'DRAFT'); assert.equal(result.capacity, 16)
    assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: result.id } })).companyId, companies[0])
    assert.equal('companyId' in result, false); assert.equal('imageData' in result, false)
    assert.equal(legacyWrites, 0)
  })
  it('edits only own drafts and preserves unrelated vehicle fields', async () => {
    const response = await call(`/admin/trips/${trips[2]}`, tokens[0], 'PATCH', { title: 'Synthetic revised' })
    assert.equal(response.status, 200)
    const row = await prisma.trip.findUniqueOrThrow({ where: { id: trips[2] } })
    assert.equal(row.title, 'Synthetic revised'); assert.equal(row.capacity, 16)
    assert.deepEqual(row.blockedSeats, [1]); assert.equal(row.lowerDeckCapacity, 8)
    for (const id of [trips[1], 'nonexistent']) assert.equal((await call(`/admin/trips/${id}`, tokens[0], 'PATCH', { title: 'Denied' })).status, 404)
  })
  it('rejects ownership injection, publication and invalid dates, prices or bus configuration', async () => {
    for (const extra of [{ companyId: companies[1] }, { status: 'ACTIVE' }, { status: 'SCHEDULED' },
      { title: ' ' }, { returnDate: '2026-01-01' }, { priceCents: 2147483648 }, { blockedSeats: [17] },
      { lowerDeckCapacity: 16 }, { deckCount: 1, vehicleFeatures: [{ type: 'DOOR', deck: 2, position: 'FRONT', side: 'LEFT' }] }]) {
      assert.equal((await call('/admin/trips', tokens[0], 'POST', { ...draft, ...extra })).status, 400)
    }
    assert.equal((await call(`/admin/trips/${trips[2]}`, tokens[0], 'PATCH', { status: 'ACTIVE' })).status, 400)
    assert.equal((await call(`/admin/trips/${trips[2]}`, tokens[0], 'PATCH', { departureDate: '2027-02-01' })).status, 400)
  })
  it('refuses editing a non-draft or a draft with reservations', async () => {
    await prisma.trip.update({ where: { id: trips[2] }, data: { status: 'ACTIVE' } })
    assert.equal((await call(`/admin/trips/${trips[2]}`, tokens[0], 'PATCH', { title: 'Denied' })).status, 409)
    await prisma.trip.update({ where: { id: trips[2] }, data: { status: 'DRAFT' } })
    const reservation = await prisma.reservation.create({ data: { companyId: companies[0], clientId: clients[0], tripId: trips[2] } })
    reservations.push(reservation.id)
    assert.equal((await call(`/admin/trips/${trips[2]}`, tokens[0], 'PATCH', { title: 'Denied' })).status, 409)
    assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: trips[2] } })).title, 'Synthetic revised')
  })
  it('rolls back a draft if audit insertion fails', async () => {
    const failing = new CompanyTripsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), trip: tx.trip,
        authAuditEvent: { create: async () => { throw new Error('synthetic trip audit failure') } } }))
    } as unknown as PrismaService, new CompanyScopeService(prisma))
    const title = `Rollback trip ${suffix}`
    await assert.rejects(failing.create(users[0], sessions[0], { title, origin: 'Synthetic', destination: 'Synthetic',
      departureDate: new Date('2027-01-01') }), /synthetic trip audit failure/)
    assert.equal(await prisma.trip.count({ where: { companyId: companies[0], title } }), 0)
  })
  it('denies draft creation for finance and sessions without company scope', async () => {
    assert.equal((await call('/admin/trips', unboundToken, 'POST', draft)).status, 403)
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'FINANCE' } })
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'FINANCE' } })
    try { assert.equal((await call('/admin/trips', tokens[0], 'POST', draft)).status, 403) }
    finally {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } })
      await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'ADMIN' } })
    }
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
