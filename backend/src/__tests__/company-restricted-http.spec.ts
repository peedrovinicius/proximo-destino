import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
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
import { ClientsController } from '../clients/clients.controller'
import { ClientsService } from '../clients/clients.service'
import { AdminTripsController } from '../trips/admin-trips.controller'
import { TripsService } from '../trips/trips.service'
import { AdminController } from '../admin/admin.controller'
import { AdminService } from '../admin/admin.service'

describe('company HTTP A/B isolation using the restricted PostgreSQL runtime login', () => {
  const owner = new PrismaService()
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
  const role = `http_tenant_${suffix}`
  const creator = `http-owner-${suffix}`
  const users = [`http-user-a-${suffix}`, `http-user-b-${suffix}`]
  const companies = [`http-company-a-${suffix}`, `http-company-b-${suffix}`]
  const sessions = [`http-session-a-${suffix}`, `http-session-b-${suffix}`]
  const clients = [`http-client-a-${suffix}`, `http-client-b-${suffix}`]
  const trips = [`http-trip-a-${suffix}`, `http-trip-b-${suffix}`]
  const reservations = [`http-reservation-a-${suffix}`, `http-reservation-b-${suffix}`]
  const tokens: string[] = []
  const config = new ConfigService({
    JWT_ACCESS_SECRET: `restricted-http-access-${suffix}`,
    AUDIT_HASH_KEY: `restricted-http-audit-${suffix}`,
  })
  const jwt = new JwtService()
  let runtime: PrismaService | undefined
  let app: INestApplication | undefined
  let base = ''
  let connected = false
  let roleCreated = false

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname),
      'Never run restricted HTTP tenant proof against production')
    await owner.$connect()
    connected = true

    await owner.user.createMany({ data: [
      { id: creator, email: `${creator}@example.invalid`, passwordHash: 'synthetic', role: 'CREATOR' },
      ...users.map(id => ({ id, email: `${id}@example.invalid`, passwordHash: 'synthetic', role: 'ADMIN' as const })),
    ] })
    for (let i = 0; i < 2; i++) {
      await owner.company.create({ data: {
        id: companies[i], slug: companies[i], tradeName: `Restricted tenant ${i}`,
        contactEmail: 'contact@example.invalid', responsibleName: 'Synthetic',
        responsibleEmail: 'responsible@example.invalid', status: 'ACTIVE', createdById: creator,
      } })
      await owner.companyMembership.create({ data: {
        companyId: companies[i], userId: users[i], role: 'ADMIN',
      } })
      await owner.authSession.create({ data: {
        id: sessions[i], companyId: companies[i], userId: users[i],
        refreshTokenHash: 'synthetic', expiresAt: new Date(Date.now() + 300_000),
      } })
      await owner.client.create({ data: {
        id: clients[i], companyId: companies[i], fullName: `HTTP client ${i}`,
      } })
      await owner.trip.create({ data: {
        id: trips[i], companyId: companies[i], title: `HTTP trip ${i}`,
        origin: 'Fortaleza', destination: 'Recife', departureDate: new Date('2027-06-01'),
      } })
      await owner.reservation.create({ data: {
        id: reservations[i], companyId: companies[i], clientId: clients[i], tripId: trips[i],
      } })
      // Deliberately lie in the token. AuthService must use persisted AuthSession.companyId.
      tokens.push(await jwt.signAsync({
        sub: users[i], sid: sessions[i], type: 'access', role: 'ADMIN',
        companyId: companies[1 - i], authVersion: 0,
      }, { secret: config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: '10m' }))
    }

    const password = randomUUID()
    await owner.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    roleCreated = true
    await owner.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM "${role}"`)
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    for (const table of ['User', 'AuthSession', 'Company', 'CompanyMembership']) {
      await owner.$executeRawUnsafe(`GRANT SELECT ON TABLE public."${table}" TO "${role}"`)
    }
    await owner.$executeRawUnsafe(`GRANT SELECT ON TABLE public."Companion" TO "${role}"`)
    for (const table of ['Client', 'Trip', 'Reservation']) {
      await owner.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON TABLE public."${table}" TO "${role}"`)
    }
    await owner.$executeRawUnsafe(
      `GRANT SELECT, INSERT ON TABLE public."AuthAuditEvent" TO "${role}"`)

    database.username = role
    database.password = password
    runtime = new PrismaService({ datasourceUrl: database.toString() })
    await runtime.$connect()

    const auth = new AuthService(runtime, jwt, config, {} as MfaService,
      new SessionService(runtime, config), { record: async () => {} } as unknown as AuditService)

    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, TenancyModule],
      controllers: [ClientsController, AdminTripsController, AdminController],
      providers: [
        { provide: ClientsService, useValue: {
          list: () => { throw new Error('legacy client reader must not run') },
          findById: () => { throw new Error('legacy client detail must not run') },
          create: () => { throw new Error('legacy client writer must not run') },
          credits: () => { throw new Error('legacy credits must not run') },
        } },
        { provide: TripsService, useValue: {
          listAdmin: () => { throw new Error('legacy trip reader must not run') },
          busTemplates: () => [],
          create: () => { throw new Error('legacy trip writer must not run') },
        } },
        { provide: AdminService, useValue: {
          listReservations: () => { throw new Error('legacy reservation reader must not run') },
          dashboard: () => { throw new Error('legacy dashboard must not run') },
          createReservation: () => { throw new Error('legacy reservation writer must not run') },
        } },
      ],
    }).overrideProvider(PrismaService).useValue(runtime)
      .overrideProvider(AuthService).useValue(auth)
      .compile()

    app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = await app.getUrl()
  })

  after(async () => {
    await app?.close()
    await runtime?.$disconnect()
    if (!connected) return
    try {
      if (roleCreated) {
        await owner.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
      await owner.reservation.deleteMany({ where: { id: { in: reservations } } })
      await owner.authAuditEvent.deleteMany({ where: { userId: { in: users } } })
      await owner.client.deleteMany({ where: { companyId: { in: companies } } })
      await owner.trip.deleteMany({ where: { id: { in: trips } } })
      await owner.authSession.deleteMany({ where: { id: { in: sessions } } })
      await owner.companyMembership.deleteMany({ where: { companyId: { in: companies } } })
      await owner.company.deleteMany({ where: { id: { in: companies } } })
      await owner.user.deleteMany({ where: { id: { in: [creator, ...users] } } })
    } finally {
      await owner.$disconnect()
    }
  })

  const call = (path: string, token: string, method = 'GET', body?: object) => fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  it('ignores forged token company claims and serves only the persisted tenant', async () => {
    for (let i = 0; i < 2; i++) {
      for (const [path, expected] of [
        ['/admin/clients', clients[i]],
        ['/admin/trips', trips[i]],
        ['/admin/reservations', reservations[i]],
      ] as const) {
        const response = await call(path, tokens[i])
        assert.equal(response.status, 200)
        assert.deepEqual((await response.json() as { id: string }[]).map(row => row.id), [expected])
      }
    }
  })

  it('returns 404 for foreign IDs in both tenant directions', async () => {
    for (let i = 0; i < 2; i++) {
      const other = 1 - i
      assert.equal((await call(`/admin/clients/${clients[other]}`, tokens[i])).status, 404)
      assert.equal((await call(`/admin/trips/${trips[other]}`, tokens[i])).status, 404)
    }
  })

  it('allows an own-company HTTP write while RLS fixes ownership to the persisted session', async () => {
    const response = await call('/admin/clients', tokens[0], 'POST', { fullName: 'Restricted HTTP created' })
    assert.equal(response.status, 201)
    const body = await response.json() as { id: string }
    clients.push(body.id)
    const saved = await owner.client.findUniqueOrThrow({ where: { id: body.id } })
    assert.equal(saved.companyId, companies[0])
    assert.equal(saved.fullName, 'Restricted HTTP created')
  })

  it('fails closed immediately after membership revocation', async () => {
    await owner.companyMembership.updateMany({ where: { companyId: companies[0], userId: users[0] },
      data: { isActive: false } })
    try {
      assert.equal((await call('/admin/clients', tokens[0])).status, 403)
      assert.equal((await call('/admin/clients', tokens[0], 'POST', { fullName: 'Must fail' })).status, 403)
    } finally {
      await owner.companyMembership.updateMany({ where: { companyId: companies[0], userId: users[0] },
        data: { isActive: true } })
    }
  })
})
