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
import { CompanyReservationsService } from '../tenancy/company-reservations.service'
import { CompanyReservationAccessService } from '../tenancy/company-reservation-access.service'
import { CompanyClientPortalService } from '../portal/company-client-portal.service'
import * as argon2 from 'argon2'
import { CompanyDataService } from '../tenancy/company-data.service'
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
  let preparedReservationId: string
  const config = new ConfigService({ JWT_ACCESS_SECRET: 'synthetic-http-access-secret-only-for-tests',
    AUDIT_HASH_KEY: 'synthetic-http-audit-key-only-for-tests' })
  const jwt = new JwtService()
  const accessConfig = new ConfigService({ COMPANY_FOUNDATION_ENABLED: 'true', COMPANY_CLIENT_PORTAL_ENABLED: 'true' })
  const access = new CompanyReservationAccessService(prisma, new CompanyScopeService(prisma), accessConfig)
  const portal = new CompanyClientPortalService(prisma, accessConfig)
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
    }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthService).useValue(auth)
      .overrideProvider(CompanyReservationAccessService).useValue(access).compile()
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
  it('searches own clients, trips and reservations without foreign identities or secrets', async () => {
    const response = await call('/admin/search?q=SYNTHETIC')
    assert.equal(response.status, 200)
    const result = await response.json() as { clients: { id: string }[]; trips: { id: string }[]; reservations: { id: string }[] }
    assert.deepEqual(result.clients.map(r => r.id), [clients[0]])
    assert.deepEqual(result.trips.map(r => r.id), [trips[0]])
    assert.deepEqual(result.reservations.map(r => r.id), [reservations[0]])
    for (const field of ['documentEncrypted', 'documentHash', 'accessCodeHash', 'notes', 'companyId']) {
      assert.equal(JSON.stringify(result).includes(`"${field}"`), false)
    }
    for (const query of ['Synthetic 1', 'x', '   ']) {
      const empty = await call(`/admin/search?q=${encodeURIComponent(query)}`)
      assert.equal(empty.status, 200)
      assert.deepEqual(await empty.json(), { clients: [], trips: [], reservations: [] })
    }
    assert.equal((await call('/admin/search?q=Synthetic', unboundToken)).status, 403)
    for (const path of ['/admin/search', '/admin/trips', '/admin/clients']) {
      assert.equal((await call(`${path}?q=one&q=two`)).status, 400)
    }
  })
  it('filters company trips by title, origin and destination', async () => {
    for (const q of ['synthetic 0', ' fortaleza ', 'RECIFE']) {
      const response = await call(`/admin/trips?q=${encodeURIComponent(q)}`)
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json() as { id: string }[]).map(r => r.id), [trips[0]])
    }
    assert.deepEqual(await (await call('/admin/trips?q=Synthetic%201')).json(), [])
  })
  it('blocks company sessions from unscoped credit, finance and writes', async () => {
    for (const path of [`/admin/clients/${clients[0]}/credits`]) {
      assert.equal((await call(path)).status, 403)
    }
    assert.equal((await call('/admin/reservations', tokens[0], 'POST')).status, 400)
    assert.equal(legacyWrites, 0)
  })
  it('aggregates every own online order and manual receipt without details and denies invalid totals', async () => {
    const data = [
      ...Array.from({ length: 201 }, () => ({ status: 'PAID' as const, totalCents: 100, refundedCents: 0 })),
      { status: 'PARTIALLY_REFUNDED' as const, totalCents: 1000, refundedCents: 200 },
      { status: 'PENDING_PAYMENT' as const, totalCents: 500, refundedCents: 0 },
      { status: 'REFUNDED' as const, totalCents: 300, refundedCents: 300 },
      { status: 'CANCELLED' as const, totalCents: 80, refundedCents: 0 },
      { status: 'EXPIRED' as const, totalCents: 70, refundedCents: 0 },
    ]
    const tripIds = data.map((_, i) => `financial-trip-${suffix}-${i}`)
    const reservationIds = data.map((_, i) => `financial-reservation-${suffix}-${i}`)
    const orderIds = data.map((_, i) => `financial-order-${suffix}-${i}`)
    await prisma.trip.createMany({ data: tripIds.map(id => ({ id, companyId: companies[0], title: 'Synthetic finance',
      origin: 'Synthetic', destination: 'Synthetic', departureDate: new Date('2027-01-01') })) })
    await prisma.reservation.createMany({ data: reservationIds.map((id, i) => ({ id, companyId: companies[0], clientId: clients[0], tripId: tripIds[i] })) })
    await prisma.purchaseOrder.createMany({ data: data.map((row, i) => ({ ...row, id: orderIds[i], reservationId: reservationIds[i],
      paymentMethod: 'PIX', passengerCount: 1, unitPriceCents: row.totalCents, providerPaymentId: 'private-provider', providerStatus: 'private-status' })) })
    const foreign = await prisma.purchaseOrder.create({ data: { reservationId: reservations[1], paymentMethod: 'PIX', passengerCount: 1,
      unitPriceCents: 999999, totalCents: 999999, status: 'PAID' } })
    const manual = await prisma.manualPayment.create({ data: { reservationId: reservations[0], method: 'CASH', amountCents: 777777,
      paidAt: new Date(), note: 'private-note' } })
    const reversed = await prisma.manualPayment.create({ data: { reservationId: reservations[0], method: 'TRANSFER',
      status: 'REVERSED', amountCents: 50, paidAt: new Date(), reversedReason: 'private-reason' } })
    const foreignManual = await prisma.manualPayment.create({ data: { reservationId: reservations[1], method: 'CASH',
      amountCents: 888, paidAt: new Date(), note: 'foreign-private' } })
    try {
      const before = await prisma.authAuditEvent.count({ where: { userId: { in: users } } })
      const response = await call('/admin/payments/orders'); assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const body = await response.json()
      assert.deepEqual(body, { summaryOnly: true, coverage: 'ONLINE_AND_MANUAL_PAYMENTS', summary: {
        totalOrders: 206, paidOrders: 202, pendingOrders: 1, refundedOrders: 1, cancelledOrders: 1, expiredOrders: 1,
        paidCents: 798677, pendingCents: 500, refundedCents: 550,
        manualReceivedCount: 1, manualReceivedCents: 777777, manualReversedCount: 1, manualReversedCents: 50,
      }, orders: [], manualPayments: [] })
      assert.equal(await prisma.authAuditEvent.count({ where: { userId: { in: users } } }), before)
      await prisma.purchaseOrder.update({ where: { id: orderIds[0] }, data: { refundedCents: 101 } })
      assert.equal((await call('/admin/payments/orders')).status, 409)
      await prisma.purchaseOrder.update({ where: { id: orderIds[0] }, data: { refundedCents: 0 } })
      const other = await call('/admin/payments/orders', tokens[1]); assert.equal(other.status, 200)
      const otherBody = await other.json() as { summary: { totalOrders: number; paidCents: number } }
      assert.equal(otherBody.summary.totalOrders, 1); assert.equal(otherBody.summary.paidCents, 1000887)
    } finally {
      await prisma.manualPayment.deleteMany({ where: { id: { in: [manual.id, reversed.id, foreignManual.id] } } })
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: [...orderIds, foreign.id] } } })
      // Keep later scenarios independent of these synthetic reservation/trip fixtures.
      await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } })
      await prisma.trip.deleteMany({ where: { id: { in: tripIds } } })
    }
  })
  it('revalidates financial authorization and supports Finance without exposing operational details', async () => {
    const scopes = new CompanyScopeService(prisma), scope = await scopes.resolveSession(users[0], sessions[0])
    const stale = new CompanyDataService(prisma, { resolveSession: async () => scope } as unknown as CompanyScopeService)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try { await assert.rejects(stale.paymentsSummary(users[0], sessions[0]), { status: 403 }) }
    finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
    for (const role of ['AGENT', 'FINANCE'] as const) {
      await prisma.user.update({ where: { id: users[0] }, data: { role } })
      await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role } })
      try { assert.equal((await call('/admin/payments/orders')).status, role === 'FINANCE' ? 200 : 403) }
      finally {
        await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } })
        await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'ADMIN' } })
      }
    }
    assert.equal((await call(`/admin/reservations/${reservations[0]}/finance`)).status, 403)
    assert.equal((await call(`/admin/reservations/${reservations[0]}/finance/reconcile`, tokens[0], 'POST')).status, 403)
  })
  it('refuses manual receipts linked to another reservation through plans, installments or quotes', async () => {
    const quotes = await Promise.all([0, 1].map(i => prisma.quote.create({ data: {
      reservationId: reservations[i], revision: 1, title: 'Synthetic financial quote' } })))
    const plans = await Promise.all([0, 1].map(i => prisma.financePlan.create({ data: {
      reservationId: reservations[i], quoteId: quotes[i].id, totalCents: 100, installmentCount: 1 } })))
    const installments = await Promise.all(plans.map(plan => prisma.installment.create({ data: {
      financePlanId: plan.id, sequence: 1, dueDate: new Date(), amountCents: 100 } })))
    const receipt = await prisma.manualPayment.create({ data: { reservationId: reservations[0], method: 'CASH',
      financePlanId: plans[0].id, installmentId: installments[0].id, amountCents: 100, paidAt: new Date() } })
    const extraQuote = await prisma.quote.create({ data: { reservationId: reservations[1], revision: 2, title: 'Synthetic incompatible quote' } })
    try {
      const good = await call('/admin/payments/orders'); assert.equal(good.status, 200)
      assert.equal((await good.json() as { summary: { manualReceivedCents: number } }).summary.manualReceivedCents, 100)
      await prisma.manualPayment.update({ where: { id: receipt.id }, data: { financePlanId: plans[1].id } })
      assert.equal((await call('/admin/payments/orders')).status, 409)
      await prisma.manualPayment.update({ where: { id: receipt.id }, data: { financePlanId: null, installmentId: installments[1].id } })
      assert.equal((await call('/admin/payments/orders')).status, 409)
      await prisma.manualPayment.update({ where: { id: receipt.id }, data: { financePlanId: plans[0].id, installmentId: installments[0].id } })
      await prisma.financePlan.update({ where: { id: plans[0].id }, data: { quoteId: extraQuote.id } })
      assert.equal((await call('/admin/payments/orders')).status, 409)
      await prisma.financePlan.update({ where: { id: plans[0].id }, data: { quoteId: quotes[0].id } })
      await prisma.manualPayment.update({ where: { id: receipt.id }, data: { amountCents: -1 } })
      assert.equal((await call('/admin/payments/orders')).status, 409)
    } finally {
      await prisma.manualPayment.delete({ where: { id: receipt.id } })
      await prisma.installment.deleteMany({ where: { id: { in: installments.map(row => row.id) } } })
      await prisma.financePlan.deleteMany({ where: { id: { in: plans.map(row => row.id) } } })
      await prisma.quote.deleteMany({ where: { id: { in: [...quotes.map(row => row.id), extraQuote.id] } } })
    }
  })
  it('serves company dashboard metrics without invoking the legacy global reader', async () => {
    for (const token of [tokens[0], tokens[1]]) {
      const response = await call('/admin/dashboard', token)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { metrics: {
        clients: 1, pendingReservations: 1, activeTrips: 0, confirmedReservations: 0,
      }, birthdays: [] })
    }
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
  it('rejects injected ownership, invalid names/CPF and invalid companion inputs', async () => {
    for (const extra of [{ companyId: companies[1] }, { userId: users[1] }, { fullName: '  ' },
      { document: '11111111111' }, { companions: [{ fullName: ' ' }] },
      { companions: { fullName: 'Not an array' } },
      { companions: [{ fullName: 'Synthetic', clientId: clients[1] }] },
      { companions: [{ fullName: 'Synthetic', companyId: companies[1] }] },
      { companions: Array.from({ length: 81 }, () => ({ fullName: 'Synthetic' })) }]) {
      assert.equal((await call('/admin/clients', tokens[0], 'POST', { fullName: 'Synthetic', ...extra })).status, 400)
    }
    assert.equal((await call(`/admin/clients/${clients[2]}`, tokens[0], 'PATCH', { companyId: companies[1] })).status, 400)
  })
  it('creates companions only under the new own-company client and conceals their documents', async () => {
    const response = await call('/admin/clients', tokens[0], 'POST', {
      fullName: 'Synthetic family', companions: [{ fullName: ' Synthetic companion ',
        document: 'COMPANION-PRIVATE-123', relationship: ' Synthetic relation ', birthDate: '2000-01-02' }],
    })
    assert.equal(response.status, 201)
    const client = await response.json() as { id: string }; clients.push(client.id)
    const saved = await prisma.companion.findFirstOrThrow({ where: { clientId: client.id }, include: { client: true } })
    assert.equal(saved.client.companyId, companies[0]); assert.equal(saved.fullName, 'Synthetic companion')
    assert.equal(saved.document, null); assert.equal(revealDocument(saved), 'COMPANION-PRIVATE-123')
    const detail = await call(`/admin/clients/${client.id}`)
    assert.equal(detail.status, 200)
    const data = await detail.json() as { companions: { id: string; fullName: string }[] }
    assert.deepEqual(data.companions.map(row => row.id), [saved.id])
    for (const key of ['clientId', 'document', 'documentHash', 'documentEncrypted']) assert.equal(key in data.companions[0], false)
    assert.equal((await call(`/admin/clients/${client.id}`, tokens[1])).status, 404)
    assert.equal((await call(`/admin/clients/${client.id}`, tokens[0], 'PATCH', {
      companions: [{ id: saved.id, fullName: 'Reparent attempt' }],
    })).status, 400)
    const audit = await prisma.authAuditEvent.findFirstOrThrow({ where: { userId: users[0],
      eventType: 'OPS_COMPANY_CLIENT_CREATED', metadata: { path: ['clientId'], equals: client.id } } })
    assert.equal(JSON.stringify(audit.metadata).includes('COMPANION-PRIVATE-123'), false)
    assert.equal(JSON.stringify(audit.metadata).includes('Synthetic companion'), false)
    assert.equal((audit.metadata as { companionCount: number }).companionCount, 1)
  })
  it('checks CPF uniqueness within one company and allows separate private profiles in another', async () => {
    assert.equal((await call('/admin/clients', tokens[0], 'POST', { fullName: 'Duplicate', document: '52998224725' })).status, 409)
    const response = await call('/admin/clients', tokens[1], 'POST', { fullName: 'Synthetic other', document: '52998224725' })
    assert.equal(response.status, 201); const result = await response.json() as { id: string }; clients.push(result.id)
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: result.id } })).companyId, companies[1])
  })
  it('adds and edits companions only for the matching own-company parent', async () => {
    const path = `/admin/clients/${clients[0]}/companions`
    const created = await call(path, tokens[0], 'POST', { fullName: 'Synthetic added', document: 'PRIVATE-ADDED' })
    assert.equal(created.status, 201)
    const row = await created.json() as { id: string }
    assert.equal('document' in row, false)
    assert.equal((await call(`${path}/${row.id}`, tokens[0], 'PATCH', { fullName: 'Synthetic revised' })).status, 200)
    assert.equal(revealDocument(await prisma.companion.findUniqueOrThrow({ where: { id: row.id } })), 'PRIVATE-ADDED')
    for (const parent of [clients[1], clients[2], 'nonexistent']) {
      assert.equal((await call(`/admin/clients/${parent}/companions/${row.id}`, tokens[0], 'PATCH', { fullName: 'Denied' })).status, 404)
    }
    assert.equal((await call(path, tokens[1], 'POST', { fullName: 'Denied' })).status, 404)
    assert.equal((await call(path, tokens[2], 'POST', { fullName: 'Denied' })).status, 403)
    assert.equal((await call(path, unboundToken, 'POST', { fullName: 'Denied' })).status, 403)
    for (const data of [{ fullName: ' ' }, { fullName: null }, { clientId: clients[1] }, { companyId: companies[1] }]) {
      assert.equal((await call(`${path}/${row.id}`, tokens[0], 'PATCH', data)).status, 400)
    }
    assert.equal((await call(`${path}/${row.id}`, tokens[0], 'PATCH', { document: '', relationship: '' })).status, 200)
    const saved = await prisma.companion.findUniqueOrThrow({ where: { id: row.id } })
    assert.equal(saved.documentEncrypted, null); assert.equal(saved.documentHash, null)
    assert.equal(saved.fullName, 'Synthetic revised')
    const audit = await prisma.authAuditEvent.findMany({ where: { userId: users[0], eventType: { startsWith: 'OPS_COMPANY_COMPANION_' } } })
    assert.equal(JSON.stringify(audit).includes('PRIVATE-ADDED'), false)
  })
  it('serializes concurrent additions at the companion limit', async () => {
    const existing = await prisma.companion.count({ where: { clientId: clients[0] } })
    await prisma.companion.createMany({ data: Array.from({ length: 79 - existing }, (_, i) => ({
      clientId: clients[0], fullName: `Limit synthetic ${suffix} ${i}`,
    })) })
    const responses = await Promise.all([0, 1].map(() => call(`/admin/clients/${clients[0]}/companions`, tokens[0], 'POST', {
      fullName: `Last synthetic ${suffix}`,
    })))
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409])
    assert.equal(await prisma.companion.count({ where: { clientId: clients[0] } }), 80)
    await prisma.companion.deleteMany({ where: { clientId: clients[0], fullName: { contains: suffix } } })
  })
  it('rolls back companion mutations on audit failure and rechecks revoked authorization', async () => {
    const service = new CompanyClientsService(prisma, new CompanyScopeService(prisma))
    const row = await service.createCompanion(users[0], sessions[0], clients[0], { fullName: 'Synthetic rollback original' })
    const failing = new CompanyClientsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), companion: tx.companion,
        authAuditEvent: { create: async () => { throw new Error('synthetic companion audit failure') } } }))
    } as unknown as PrismaService, new CompanyScopeService(prisma))
    await assert.rejects(failing.updateCompanion(users[0], sessions[0], clients[0], row.id, { fullName: 'Must roll back' }), /synthetic companion audit failure/)
    assert.equal((await prisma.companion.findUniqueOrThrow({ where: { id: row.id } })).fullName, 'Synthetic rollback original')
    const count = await prisma.companion.count({ where: { clientId: clients[0] } })
    await assert.rejects(failing.createCompanion(users[0], sessions[0], clients[0], { fullName: 'Must roll back' }), /synthetic companion audit failure/)
    assert.equal(await prisma.companion.count({ where: { clientId: clients[0] } }), count)
    const scope = await new CompanyScopeService(prisma).resolveSession(users[0], sessions[0])
    const stale = new CompanyClientsService(prisma, { resolveSession: async () => scope } as unknown as CompanyScopeService)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try { await assert.rejects(stale.updateCompanion(users[0], sessions[0], clients[0], row.id, { fullName: 'Denied' }), { status: 403 }) }
    finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
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
    await assert.rejects(failing.create(users[0], sessions[0], { fullName: `Rollback ${suffix}`,
      companions: [{ fullName: `Rollback companion ${suffix}` }] }), /synthetic audit failure/)
    assert.equal(await prisma.client.count({ where: { companyId: companies[0], fullName: `Rollback ${suffix}` } }), 0)
    assert.equal(await prisma.companion.count({ where: { fullName: `Rollback companion ${suffix}` } }), 0)
  })
  it('denies client writes for finance and for managed sessions without a company', async () => {
    assert.equal((await call('/admin/clients', unboundToken, 'POST', { fullName: 'Denied' })).status, 403)
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'FINANCE' } })
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'FINANCE' } })
    try {
      assert.equal((await call('/admin/clients', tokens[0], 'POST', { fullName: 'Denied' })).status, 403)
      assert.equal((await call('/admin/search?q=Synthetic')).status, 403)
      assert.equal((await call(`/admin/clients/${clients[2]}`, tokens[0], 'PATCH', { fullName: 'Denied' })).status, 403)
      assert.equal((await call(`/admin/clients/${clients[0]}/companions`, tokens[0], 'POST', { fullName: 'Denied' })).status, 403)
      const companion = await prisma.companion.findFirstOrThrow({ where: { clientId: clients[0] } })
      assert.equal((await call(`/admin/clients/${clients[0]}/companions/${companion.id}`, tokens[0], 'PATCH', { fullName: 'Denied' })).status, 403)
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
  it('reads own trip configuration without losing vehicle fields or exposing a foreign draft', async () => {
    const response = await call(`/admin/trips/${trips[2]}`)
    assert.equal(response.status, 200)
    const result = await response.json() as { id: string; capacity: number; blockedSeats: number[]; deckCount: number }
    assert.equal(result.id, trips[2]); assert.equal(result.capacity, 16)
    assert.equal(result.deckCount, 2); assert.deepEqual(result.blockedSeats, [1])
    for (const key of ['companyId', 'imageData', 'imageMimeType', 'reservations', 'seatAssignments']) assert.equal(key in result, false)
    const listed = await (await call('/admin/trips?q=Synthetic%20revised')).json() as typeof result[]
    assert.equal(listed[0].capacity, 16); assert.deepEqual(listed[0].blockedSeats, [1])
    for (const id of [trips[1], 'nonexistent']) assert.equal((await call(`/admin/trips/${id}`)).status, 404)
    assert.equal((await call(`/admin/trips/${trips[2]}`, tokens[1])).status, 404)
    assert.equal((await call(`/admin/trips/${trips[2]}`, unboundToken)).status, 403)
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
  it('reads and blocks only own empty draft seats, preserving concurrent changes', async () => {
    const service = new CompanyTripsService(prisma, new CompanyScopeService(prisma))
    const trip = await service.create(users[0], sessions[0], { title: 'Synthetic seat draft', origin: 'Synthetic',
      destination: 'Synthetic', departureDate: new Date('2027-01-01'), busTemplate: 'CUSTOM', capacity: 4 })
    trips.push(trip.id)
    const mapPath = `/admin/trips/${trip.id}/seats`
    const initial = await call(mapPath); assert.equal(initial.status, 200)
    const map = await initial.json() as { availableCount: number; assignments: unknown[] }
    assert.equal(map.availableCount, 4); assert.deepEqual(map.assignments, [])
    const concurrent = await Promise.all([1, 2].map(n => call(`${mapPath}/${n}`, tokens[0], 'PATCH', { blocked: true })))
    assert.deepEqual(concurrent.map(r => r.status), [200, 200])
    assert.deepEqual((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).blockedSeats, [1, 2])
    assert.equal((await call(`${mapPath}/1`, tokens[0], 'PATCH', { blocked: false })).status, 200)
    const changed = await (await call(mapPath)).json() as { blockedSeats: number[]; availableCount: number }
    assert.deepEqual(changed.blockedSeats, [2]); assert.equal(changed.availableCount, 3)
    for (const n of [0, 5, 81]) assert.equal((await call(`${mapPath}/${n}`, tokens[0], 'PATCH', { blocked: true })).status, 400)
    for (const id of [trips[1], 'nonexistent']) {
      assert.equal((await call(`/admin/trips/${id}/seats`)).status, 404)
      assert.equal((await call(`/admin/trips/${id}/seats/1`, tokens[0], 'PATCH', { blocked: true })).status, 404)
    }
    const reservation = await prisma.reservation.create({ data: { companyId: companies[0], clientId: clients[0], tripId: trip.id } })
    reservations.push(reservation.id)
    assert.equal((await call(`${mapPath}/3`, tokens[0], 'PATCH', { blocked: true })).status, 409)
    await prisma.trip.update({ where: { id: trip.id }, data: { status: 'ACTIVE' } })
    assert.equal((await call(mapPath)).status, 409)
    assert.equal((await call(`${mapPath}/3`, tokens[0], 'PATCH', { blocked: true })).status, 409)
  })
  it('rolls back seat blocking on audit failure and rejects stale authorization', async () => {
    const trip = await new CompanyTripsService(prisma, new CompanyScopeService(prisma)).create(users[0], sessions[0], {
      title: 'Synthetic seat rollback', origin: 'Synthetic', destination: 'Synthetic', departureDate: new Date('2027-01-01'),
      busTemplate: 'CUSTOM', capacity: 4,
    }); trips.push(trip.id)
    const failing = new CompanyTripsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), trip: tx.trip,
        reservation: tx.reservation, seatAssignment: tx.seatAssignment,
        authAuditEvent: { create: async () => { throw new Error('synthetic seat audit failure') } } }))
    } as unknown as PrismaService, new CompanyScopeService(prisma))
    await assert.rejects(failing.setSeatBlocked(users[0], sessions[0], trip.id, 1, true), /synthetic seat audit failure/)
    assert.deepEqual((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).blockedSeats, [])
    const scope = await new CompanyScopeService(prisma).resolveSession(users[0], sessions[0])
    const stale = new CompanyTripsService(prisma, { resolveSession: async () => scope } as unknown as CompanyScopeService)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try { await assert.rejects(stale.setSeatBlocked(users[0], sessions[0], trip.id, 1, true), { status: 403 }) }
    finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'AGENT' } })
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'AGENT' } })
    try {
      assert.equal((await call(`/admin/trips/${trip.id}/seats`)).status, 403)
      assert.equal((await call(`/admin/trips/${trip.id}/seats/1`, tokens[0], 'PATCH', { blocked: true })).status, 403)
    } finally {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } })
      await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'ADMIN' } })
    }
  })
  it('isolates preparatory trip audit, strips metadata and reports bounded history without writes', async () => {
    const trip = await new CompanyTripsService(prisma, new CompanyScopeService(prisma)).create(users[0], sessions[0], {
      title: 'Synthetic audit draft', origin: 'Synthetic', destination: 'Synthetic', departureDate: new Date('2027-01-01') })
    trips.push(trip.id)
    await prisma.authAuditEvent.createMany({ data: [
      { userId: users[0], eventType: 'OPS_COMPANY_DRAFT_SEAT_ASSIGN', metadata: { companyId: companies[0], tripId: trip.id,
        seatNumber: 1, targetSeat: 1, email: 'secret@example.invalid', document: 'secret-document', token: 'secret-token',
        reservationId: reservations[1], passengerId: 'private-id', nested: { phone: 'secret-phone' } } },
      { userId: users[1], eventType: 'OPS_COMPANY_TRIP_UPDATED', metadata: { companyId: companies[1], tripId: trip.id } },
      { userId: users[0], eventType: 'OPS_COMPANY_TRIP_UPDATED', metadata: { companyId: companies[0], tripId: trips[1] } },
      { userId: users[0], eventType: 'OPS_UNKNOWN_PRIVATE_EVENT', metadata: { companyId: companies[0], tripId: trip.id } },
      { userId: users[0], eventType: 'OPS_COMPANY_TRIP_UPDATED', metadata: { tripId: trip.id } },
    ] })
    const before = await prisma.authAuditEvent.count({ where: { userId: { in: users } } })
    const response = await call(`/admin/trips/${trip.id}/audit`)
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json() as { preparatory: boolean; hasMore: boolean; limit: number;
      events: { eventType: string; metadata: unknown; user: unknown }[] }
    assert.equal(body.preparatory, true); assert.equal(body.hasMore, false); assert.equal(body.limit, 100)
    assert.equal(body.events.length, 2)
    const assigned = body.events.find(row => row.eventType === 'OPS_COMPANY_DRAFT_SEAT_ASSIGN')!
    assert.deepEqual(assigned.metadata, { seatNumber: 1, targetSeat: 1 }); assert.equal(assigned.user, null)
    const serialized = JSON.stringify(body)
    for (const field of ['secret', 'companyId', 'tripId', 'reservationId', 'passengerId', 'email', 'document', 'phone', 'token', 'nested']) {
      assert.equal(serialized.includes(field), false)
    }
    assert.equal(await prisma.authAuditEvent.count({ where: { userId: { in: users } } }), before)
    for (const id of [trips[1], 'nonexistent']) assert.equal((await call(`/admin/trips/${id}/audit`)).status, 404)
    const when = new Date('2028-01-01')
    await prisma.authAuditEvent.createMany({ data: Array.from({ length: 101 }, (_, i) => ({
      userId: users[0], eventType: 'OPS_COMPANY_TRIP_UPDATED', createdAt: when,
      metadata: { companyId: companies[0], tripId: trip.id, seatNumber: i === 0 ? 81 : 2, targetSeat: 'invalid' },
    })) })
    const limited = await (await call(`/admin/trips/${trip.id}/audit`)).json() as {
      hasMore: boolean; events: { id: string; metadata: Record<string, unknown> }[] }
    assert.equal(limited.hasMore, true); assert.equal(limited.events.length, 100)
    assert.deepEqual(limited.events.map(row => row.id), limited.events.map(row => row.id).sort().reverse())
    for (const event of limited.events) {
      assert.equal('targetSeat' in event.metadata, false)
      assert.ok(!('seatNumber' in event.metadata) || event.metadata.seatNumber === 2)
    }
  })
  it('denies stale, revoked or non-admin authorization and operational trips on preparatory audit', async () => {
    const scopes = new CompanyScopeService(prisma)
    const scope = await scopes.resolveSession(users[0], sessions[0])
    const stale = new CompanyTripsService(prisma, { resolveSession: async () => scope } as unknown as CompanyScopeService)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try {
      assert.equal((await call(`/admin/trips/${trips[2]}/audit`)).status, 403)
      await assert.rejects(stale.preparatoryAudit(users[0], sessions[0], trips[2]), { status: 403 })
    } finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'AGENT' } })
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'AGENT' } })
    try { assert.equal((await call(`/admin/trips/${trips[2]}/audit`)).status, 403) }
    finally {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } })
      await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'ADMIN' } })
    }
    await prisma.trip.update({ where: { id: trips[2] }, data: { status: 'ACTIVE' } })
    try { assert.equal((await call(`/admin/trips/${trips[2]}/audit`)).status, 409) }
    finally { await prisma.trip.update({ where: { id: trips[2] }, data: { status: 'DRAFT' } }) }
  })
  it('assigns, moves and releases own preparatory seats with atomic occupancy under concurrency', async () => {
    const service = new CompanyTripsService(prisma, new CompanyScopeService(prisma))
    const trip = await service.create(users[0], sessions[0], { title: 'Synthetic assignment draft', origin: 'Synthetic',
      destination: 'Synthetic', departureDate: new Date('2027-01-01'), busTemplate: 'CUSTOM', capacity: 4, blockedSeats: [4] })
    trips.push(trip.id)
    const extra = await new CompanyClientsService(prisma, new CompanyScopeService(prisma)).create(users[0], sessions[0], { fullName: 'Synthetic seat client' })
    clients.push(extra.id)
    const reserve = new CompanyReservationsService(prisma, new CompanyScopeService(prisma))
    for (const clientId of [clients[0], clients[2], extra.id]) {
      const row = await reserve.create(users[0], sessions[0], { clientId, tripId: trip.id }); reservations.push(row.id)
    }
    const path = `/admin/trips/${trip.id}/seats`
    const first = await call(`${path}/1/assignment`, tokens[0], 'POST', { clientId: clients[0] })
    assert.equal(first.status, 201)
    const initial = await first.json() as { occupiedSeats: number[]; availableCount: number }
    assert.deepEqual(initial.occupiedSeats, [1]); assert.equal(initial.availableCount, 2)
    const competing = await Promise.all([clients[2], extra.id].map(clientId => call(`${path}/2/assignment`, tokens[0], 'POST', { clientId })))
    assert.deepEqual(competing.map(r => r.status).sort(), [201, 409])
    assert.equal(await prisma.seatAssignment.count({ where: { tripId: trip.id } }), 2)
    assert.equal((await call(`${path}/1/assignment`, tokens[0], 'PATCH', { toSeatNumber: 2 })).status, 409)
    assert.equal((await call(`${path}/1/assignment`, tokens[0], 'PATCH', { toSeatNumber: 4 })).status, 409)
    const moved = await call(`${path}/1/assignment`, tokens[0], 'PATCH', { toSeatNumber: 3 }); assert.equal(moved.status, 200)
    assert.deepEqual((await moved.json() as { occupiedSeats: number[] }).occupiedSeats, [2, 3])
    assert.equal((await call(`${path}/3/assignment`, tokens[0], 'DELETE')).status, 200)
    const response = await call(path); assert.equal(response.headers.get('cache-control'), 'no-store')
    const map = await response.json() as { assignments: { passenger: { id: string }; reservation: { client: { id: string } } }[]; occupiedSeats: number[] }
    assert.deepEqual(map.occupiedSeats, [2])
    const serialized = JSON.stringify(map)
    for (const field of ['document', 'email', 'phone', 'companyId', 'accessCodeHash', 'password', 'reservationId']) assert.equal(serialized.includes(`"${field}"`), false)
    for (const n of [0, 5, 81]) assert.equal((await call(`${path}/${n}/assignment`, tokens[0], 'POST', { clientId: clients[0] })).status, 400)
    assert.equal((await call(`${path}/4/assignment`, tokens[0], 'POST', { clientId: clients[0] })).status, 409)
    assert.equal((await call(`${path}/3/assignment`, tokens[0], 'POST', { clientId: clients[1] })).status, 404)
    assert.equal((await call(`/admin/trips/${trips[1]}/seats/3/assignment`, tokens[0], 'POST', { clientId: clients[0] })).status, 404)
    assert.equal((await call(`${path}/3/assignment`, tokens[0], 'POST', { clientId: clients[0], fullName: 'Injected name' })).status, 400)
    assert.equal((await call(`${path}/2/assignment`, tokens[2], 'DELETE')).status, 403)
    // Existing incoherent rows are denied rather than filtered into a misleading free-seat map.
    const malformed = await prisma.seatAssignment.create({ data: { tripId: trip.id, reservationId: reservations[1], seatNumber: 3 } })
    try { assert.equal((await call(path)).status, 409) }
    finally { await prisma.seatAssignment.delete({ where: { id: malformed.id } }) }
  })

  it('rolls back preparatory seat writes and denies operational or revoked state', async () => {
    const scopes = new CompanyScopeService(prisma)
    const service = new CompanyTripsService(prisma, scopes)
    const trip = await service.create(users[0], sessions[0], { title: 'Synthetic assignment rollback', origin: 'Synthetic',
      destination: 'Synthetic', departureDate: new Date('2027-01-01'), busTemplate: 'CUSTOM', capacity: 4 })
    trips.push(trip.id)
    const reservation = await new CompanyReservationsService(prisma, scopes).create(users[0], sessions[0], { clientId: clients[0], tripId: trip.id })
    reservations.push(reservation.id)
    const failing = new CompanyTripsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), trip: tx.trip, client: tx.client,
        reservation: tx.reservation, reservationPassenger: tx.reservationPassenger, seatAssignment: tx.seatAssignment,
        authAuditEvent: { create: async () => { throw new Error('synthetic assignment audit failure') } } }))
    } as unknown as PrismaService, scopes)
    await assert.rejects(failing.assignDraftSeat(users[0], sessions[0], trip.id, 1, { clientId: clients[0] }), /synthetic assignment audit failure/)
    assert.equal(await prisma.seatAssignment.count({ where: { tripId: trip.id } }), 0)
    await service.assignDraftSeat(users[0], sessions[0], trip.id, 1, { clientId: clients[0] })
    await assert.rejects(failing.moveDraftSeat(users[0], sessions[0], trip.id, 1, 2), /synthetic assignment audit failure/)
    await assert.rejects(failing.releaseDraftSeat(users[0], sessions[0], trip.id, 1), /synthetic assignment audit failure/)
    assert.equal((await prisma.seatAssignment.findFirstOrThrow({ where: { tripId: trip.id } })).seatNumber, 1)
    await prisma.reservation.update({ where: { id: reservation.id }, data: { accessCodeHash: 'synthetic-portal-code' } })
    try {
      await assert.rejects(service.moveDraftSeat(users[0], sessions[0], trip.id, 1, 2), { status: 409 })
      await assert.rejects(service.releaseDraftSeat(users[0], sessions[0], trip.id, 1), { status: 409 })
    } finally { await prisma.reservation.update({ where: { id: reservation.id }, data: { accessCodeHash: null } }) }
    const scope = await scopes.resolveSession(users[0], sessions[0])
    const stale = new CompanyTripsService(prisma, { resolveSession: async () => scope } as unknown as CompanyScopeService)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try {
      await assert.rejects(stale.moveDraftSeat(users[0], sessions[0], trip.id, 1, 2), { status: 403 })
      await assert.rejects(stale.releaseDraftSeat(users[0], sessions[0], trip.id, 1), { status: 403 })
    } finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
    await service.releaseDraftSeat(users[0], sessions[0], trip.id, 1)
    assert.equal((await new CompanyReservationsService(prisma, scopes).cancelDraft(users[0], sessions[0], reservation.id, {})).status, 'CANCELLED')
    await assert.rejects(service.assignDraftSeat(users[0], sessions[0], trip.id, 1, { clientId: clients[0] }), { status: 409 })
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
  it('prepares only a pending own-company reservation without checkout, credentials or seats', async () => {
    const response = await call('/admin/reservations', tokens[0], 'POST', { clientId: clients[2], tripId: trips[2] })
    assert.equal(response.status, 201); const result = await response.json() as { id: string; status: string; passengerCount: number }
    reservations.push(result.id); preparedReservationId = result.id
    assert.equal(result.status, 'PENDING'); assert.equal(result.passengerCount, 1)
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: result.id }, include: { passengers: true } })
    assert.equal(row.companyId, companies[0]); assert.equal(row.accessCodeHash, null)
    assert.equal(row.passengers.length, 1); assert.equal(row.passengers[0].isPrimary, true)
    assert.equal(await prisma.seatAssignment.count({ where: { reservationId: result.id } }), 0)
    assert.equal(await prisma.financePlan.count({ where: { reservationId: result.id } }), 0)
    assert.equal(await prisma.purchaseOrder.count({ where: { reservationId: result.id } }), 0)
    for (const key of ['companyId', 'accessCodeHash', 'passengers', 'documentHash']) assert.equal(key in result, false)
    assert.equal(legacyWrites, 0)
  })
  it('rejects cross-company parents, missing IDs and injected reservation status or ownership', async () => {
    for (const data of [{ clientId: clients[1], tripId: trips[2] }, { clientId: clients[2], tripId: trips[1] },
      { clientId: 'nonexistent', tripId: trips[2] }]) assert.equal((await call('/admin/reservations', tokens[0], 'POST', data)).status, 404)
    for (const extra of [{ companyId: companies[1] }, { status: 'CONFIRMED' }, { passengerCount: 80 }, { accessCodeHash: 'forged' }]) {
      assert.equal((await call('/admin/reservations', tokens[0], 'POST', { clientId: clients[2], tripId: trips[2], ...extra })).status, 400)
    }
    assert.equal((await call('/admin/reservations', tokens[0], 'POST', { clientId: clients[2], tripId: trips[2] })).status, 409)
  })
  it('serializes the last available place and accounts for blocked seats', async () => {
    const trip = await prisma.trip.create({ data: { companyId: companies[0], title: 'Synthetic capacity', origin: 'Synthetic',
      destination: 'Synthetic', departureDate: new Date('2027-01-01'), capacity: 1 } }); trips.push(trip.id)
    const responses = await Promise.all([clients[0], clients[2]].map(clientId => call('/admin/reservations', tokens[0], 'POST', { clientId, tripId: trip.id })))
    for (const response of responses) if (response.status === 201) reservations.push((await response.json() as { id: string }).id)
    assert.deepEqual(responses.map(row => row.status).sort(), [201, 409])
    const blocked = await prisma.trip.create({ data: { companyId: companies[0], title: 'Synthetic blocked', origin: 'Synthetic',
      destination: 'Synthetic', departureDate: new Date('2027-01-01'), capacity: 1, blockedSeats: [1] } }); trips.push(blocked.id)
    assert.equal((await call('/admin/reservations', tokens[0], 'POST', { clientId: clients[2], tripId: blocked.id })).status, 409)
  })
  it('rolls back the reservation and primary passenger when audit fails', async () => {
    const trip = await prisma.trip.create({ data: { companyId: companies[0], title: 'Synthetic rollback', origin: 'Synthetic',
      destination: 'Synthetic', departureDate: new Date('2027-01-01'), capacity: 10 } }); trips.push(trip.id)
    const failing = new CompanyReservationsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), client: tx.client, trip: tx.trip, reservation: tx.reservation,
        authAuditEvent: { create: async () => { throw new Error('synthetic reservation audit failure') } } }))
    } as unknown as PrismaService, new CompanyScopeService(prisma))
    await assert.rejects(failing.create(users[0], sessions[0], { clientId: clients[2], tripId: trip.id }), /synthetic reservation audit failure/)
    assert.equal(await prisma.reservation.count({ where: { tripId: trip.id } }), 0)
    assert.equal(await prisma.reservationPassenger.count({ where: { reservation: { tripId: trip.id } } }), 0)
  })
  it('keeps confirmation, financial and implicit seat reservations blocked', async () => {
    for (const [path, method, body] of [
      [`/admin/reservations/${reservations[0]}/status`, 'PATCH', { status: 'CONFIRMED' }],
      [`/admin/reservations/${reservations[0]}/finance/manual-payments`, 'POST', {}],
    ] as const) assert.equal((await call(path, tokens[0], method, body)).status, 403)
    assert.equal((await call(`/admin/trips/${trips[2]}/seats/2/assignment`, tokens[0], 'POST', { fullName: 'Implicit client' })).status, 400)
    assert.equal((await call('/admin/reservations', unboundToken, 'POST', { clientId: clients[2], tripId: trips[2] })).status, 403)
  })
  it('scopes passenger reads and edits, encrypts documents and refuses foreign passenger IDs', async () => {
    const id = preparedReservationId
    const list = await call(`/admin/reservations/${id}/passengers`)
    assert.equal(list.status, 200)
    const passengers = await list.json() as { id: string }[]
    const passenger = passengers[0].id
    assert.equal((await call(`/admin/reservations/${reservations[1]}/passengers`)).status, 404)
    const changed = await call(`/admin/reservations/${id}/passengers`, tokens[0], 'PATCH', {
      passengers: [{ id: passenger, fullName: 'Synthetic edited passenger', document: 'SYNTHETIC-123' }],
    })
    assert.equal(changed.status, 200)
    const output = JSON.stringify(await changed.json())
    assert.equal(output.includes('SYNTHETIC-123'), false); assert.equal(output.includes('documentEncrypted'), false)
    const saved = await prisma.reservationPassenger.findUniqueOrThrow({ where: { id: passenger } })
    assert.equal(saved.document, null); assert.equal(revealDocument(saved), 'SYNTHETIC-123')
    assert.equal((await call(`/admin/reservations/${id}/passengers`, tokens[0], 'PATCH', { passengers: [{ id: 'foreign' }] })).status, 404)
    assert.equal((await call(`/admin/reservations/${id}/passengers`, tokens[0], 'PATCH', { passengers: [{ id: passenger, seatNumber: 1 }] })).status, 400)
    assert.equal((await call(`/admin/reservations/${id}/passengers`, tokens[0], 'PATCH', { passengers: [{ id: passenger }, { id: passenger }] })).status, 400)
    assert.equal(legacyWrites, 0)
  })
  it('cancels only own non-operational drafts, refuses bonus and frees capacity without deleting history', async () => {
    const id = preparedReservationId
    const beforeActive = await prisma.reservation.count({ where: { tripId: trips[2], status: { not: 'CANCELLED' } } })
    assert.equal((await call(`/admin/reservations/${reservations[1]}/cancel`, tokens[0], 'POST')).status, 404)
    assert.equal((await call(`/admin/reservations/${id}/cancel`, tokens[0], 'POST', { creditAsBonus: true })).status, 400)
    await prisma.reservation.update({ where: { id }, data: { accessCodeHash: 'synthetic-code' } })
    assert.equal((await call(`/admin/reservations/${id}/cancel`, tokens[0], 'POST')).status, 409)
    await prisma.reservation.update({ where: { id }, data: { accessCodeHash: null } })
    const response = await call(`/admin/reservations/${id}/cancel`, tokens[0], 'POST')
    assert.equal(response.status, 201)
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id } })).status, 'CANCELLED')
    assert.equal(await prisma.reservationPassenger.count({ where: { reservationId: id } }), 1)
    assert.equal((await call(`/admin/reservations/${id}/cancel`, tokens[0], 'POST')).status, 409)
    assert.equal((await call(`/admin/reservations/${id}/passengers`, tokens[0], 'PATCH', { passengers: [{ id: 'foreign' }] })).status, 409)
    assert.equal(await prisma.reservation.count({ where: { tripId: trips[2], status: { not: 'CANCELLED' } } }), beforeActive - 1)
    assert.equal(await prisma.authAuditEvent.count({ where: { userId: users[0], eventType: 'OPS_COMPANY_DRAFT_RESERVATION_CANCELLED',
      metadata: { path: ['reservationId'], equals: id } } }), 1)
    assert.equal(legacyWrites, 0)
  })
  it('refuses reservation preparation on published or past trips', async () => {
    const tripId = trips.at(-1)!
    await prisma.trip.update({ where: { id: tripId }, data: { status: 'ACTIVE' } })
    assert.equal((await call('/admin/reservations', tokens[0], 'POST', { clientId: clients[2], tripId })).status, 409)
    await prisma.trip.update({ where: { id: tripId }, data: { status: 'DRAFT', departureDate: new Date('2020-01-01') } })
    assert.equal((await call('/admin/reservations', tokens[0], 'POST', { clientId: clients[2], tripId })).status, 409)
  })
  it('rolls back passenger edits and cancellation when audit fails; serializes competing cancellations', async () => {
    const trip = await prisma.trip.create({ data: { companyId: companies[0], title: 'Synthetic draft rollback',
      origin: 'Synthetic', destination: 'Synthetic', departureDate: new Date('2027-01-01'), capacity: 2 } })
    trips.push(trip.id)
    const reservation = await new CompanyReservationsService(prisma, new CompanyScopeService(prisma))
      .create(users[0], sessions[0], { clientId: clients[0], tripId: trip.id })
    reservations.push(reservation.id)
    const passenger = await prisma.reservationPassenger.findFirstOrThrow({ where: { reservationId: reservation.id } })
    const failing = new CompanyReservationsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), trip: tx.trip, reservation: tx.reservation,
        reservationPassenger: tx.reservationPassenger,
        authAuditEvent: { create: async () => { throw new Error('synthetic mutation audit failure') } } }))
    } as unknown as PrismaService, new CompanyScopeService(prisma))
    await assert.rejects(failing.updatePassengers(users[0], sessions[0], reservation.id,
      { passengers: [{ id: passenger.id, fullName: 'Must roll back' }] }), /synthetic mutation audit failure/)
    assert.equal((await prisma.reservationPassenger.findUniqueOrThrow({ where: { id: passenger.id } })).fullName, passenger.fullName)
    await assert.rejects(failing.cancelDraft(users[0], sessions[0], reservation.id, {}), /synthetic mutation audit failure/)
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'PENDING')
    const concurrent = await Promise.all([1, 2].map(() => call(`/admin/reservations/${reservation.id}/cancel`, tokens[0], 'POST')))
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409])
  })
  it('revalidates revoked membership before reserving and denies finance', async () => {
    const scope = await new CompanyScopeService(prisma).resolveSession(users[0], sessions[0])
    const service = new CompanyReservationsService(prisma, { resolveSession: async () => scope } as unknown as CompanyScopeService)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try { await assert.rejects(service.create(users[0], sessions[0], { clientId: clients[2], tripId: trips[2] }), { status: 403 }) }
    finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'FINANCE' } })
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'FINANCE' } })
    try { assert.equal((await call('/admin/reservations', tokens[0], 'POST', { clientId: clients[2], tripId: trips[2] })).status, 403) }
    finally {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } })
      await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'ADMIN' } })
    }
  })
  it('issues a private expiring company code once, rotates it and revokes existing portal sessions', async () => {
    await prisma.trip.update({ where: { id: trips[0] }, data: { status: 'SCHEDULED' } })
    await prisma.client.update({ where: { id: clients[0] }, data: { email: `${clients[0]}@example.invalid` } })
    const path = `/admin/reservations/${reservations[0]}/company-portal-code`
    assert.equal((await call(path, tokens[0], 'POST', {})).status, 400)
    assert.equal((await call(path, tokens[0], 'POST', { confirmedPrivateDelivery: false })).status, 400)
    assert.equal((await call(path, tokens[0], 'POST', { confirmedPrivateDelivery: true, companyId: companies[1] })).status, 400)
    assert.equal((await call(path, tokens[1], 'POST', { confirmedPrivateDelivery: true })).status, 404)
    assert.equal((await call(path, tokens[2], 'POST', { confirmedPrivateDelivery: true })).status, 403)
    const response = await call(path, tokens[0], 'POST', { confirmedPrivateDelivery: true })
    assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store')
    const issued = await response.json() as { code: string; expiresAt: string; delivery: string; reservationId: string }
    assert.match(issued.code, /^[A-F0-9]{48}$/); assert.equal(issued.delivery, 'MANUAL_PRIVATE')
    assert.equal(issued.reservationId, reservations[0])
    assert.ok(new Date(issued.expiresAt).getTime() > Date.now() + 23 * 60 * 60_000)
    const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[0] } })
    assert.notEqual(saved.accessCodeHash, issued.code); assert.ok(await argon2.verify(saved.accessCodeHash!, issued.code))
    const credentials = { reservationId: reservations[0], email: `${clients[0]}@example.invalid`, code: issued.code }
    const session = await portal.login(companies[0], credentials)
    const rotated = await access.issue(users[0], sessions[0], reservations[0])
    assert.ok('code' in rotated); assert.notEqual(rotated.code, issued.code)
    await assert.rejects(portal.portal(companies[0], session.accessToken), { status: 401 })
    await assert.rejects(portal.login(companies[0], credentials), { status: 401 })
    const newSession = await portal.login(companies[0], { ...credentials, code: rotated.code! })
    const revoked = await call(`${path}/revoke`, tokens[0], 'POST')
    assert.equal(revoked.status, 201); assert.deepEqual(await revoked.json(), { revoked: true })
    await assert.rejects(portal.portal(companies[0], newSession.accessToken), { status: 401 })
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[0] } })).accessCodeHash, null)
    const audit = JSON.stringify(await prisma.authAuditEvent.findMany({ where: { userId: users[0], eventType: { in: ['OPS_COMPANY_PORTAL_CODE_ISSUED', 'OPS_COMPANY_PORTAL_CODE_REVOKED'] } } }))
    for (const secret of [issued.code, rotated.code!, saved.accessCodeHash!, credentials.email, session.accessToken]) assert.equal(audit.includes(secret), false)
  })
  it('rejects missing or expired company code validity on login and current sessions', async () => {
    const issued = await access.issue(users[0], sessions[0], reservations[0])
    assert.ok('code' in issued)
    const credentials = { reservationId: reservations[0], email: `${clients[0]}@example.invalid`, code: issued.code! }
    const session = await portal.login(companies[0], credentials)
    for (const expiry of [null, new Date(Date.now() - 1000)]) {
      await prisma.reservation.update({ where: { id: reservations[0] }, data: { companyPortalCodeExpiresAt: expiry } })
      await assert.rejects(portal.login(companies[0], credentials), { status: 401 })
      await assert.rejects(portal.portal(companies[0], session.accessToken), { status: 401 })
    }
    await access.revoke(users[0], sessions[0], reservations[0])
  })
  it('rolls back code rotation and revocation if audit fails, preserving the previous login', async () => {
    const issued = await access.issue(users[0], sessions[0], reservations[0])
    assert.ok('code' in issued)
    const session = await portal.login(companies[0], { reservationId: reservations[0], email: `${clients[0]}@example.invalid`, code: issued.code! })
    const before = await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[0] } })
    const failing = new CompanyReservationAccessService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) => prisma.$transaction(tx =>
      callback(new Proxy(tx, { get: (target, key) => key === 'authAuditEvent' ? { create: async () => { throw new Error('synthetic code audit failure') } } : Reflect.get(target, key) }))),
    } as unknown as PrismaService, new CompanyScopeService(prisma), accessConfig)
    await assert.rejects(failing.issue(users[0], sessions[0], reservations[0]), /synthetic code audit failure/)
    await assert.rejects(failing.revoke(users[0], sessions[0], reservations[0]), /synthetic code audit failure/)
    assert.deepEqual(await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[0] } }), before)
    assert.equal((await portal.portal(companies[0], session.accessToken)).readOnly, true)
    await access.revoke(users[0], sessions[0], reservations[0])
  })
  it('keeps code issuance disabled by default, restricted to current admins and eligible own reservations', async () => {
    for (const flags of [{}, { COMPANY_FOUNDATION_ENABLED: 'true' }, { COMPANY_FOUNDATION_ENABLED: true, COMPANY_CLIENT_PORTAL_ENABLED: true }]) {
      await assert.rejects(new CompanyReservationAccessService(prisma, new CompanyScopeService(prisma), new ConfigService(flags))
        .issue(users[0], sessions[0], reservations[0]), { status: 404 })
    }
    const scope = await new CompanyScopeService(prisma).resolveSession(users[0], sessions[0])
    const stale = new CompanyReservationAccessService(prisma, { resolveSession: async () => scope } as unknown as CompanyScopeService, accessConfig)
    await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: false } })
    try { await assert.rejects(stale.issue(users[0], sessions[0], reservations[0]), { status: 403 }) }
    finally { await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { isActive: true } }) }
    for (const role of ['FINANCE', 'AGENT'] as const) {
      await prisma.user.update({ where: { id: users[0] }, data: { role } })
      await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role } })
      try { await assert.rejects(access.issue(users[0], sessions[0], reservations[0]), { status: 403 }) }
      finally {
        await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } })
        await prisma.companyMembership.updateMany({ where: { userId: users[0] }, data: { role: 'ADMIN' } })
      }
    }
    await prisma.trip.update({ where: { id: trips[0] }, data: { status: 'DRAFT' } })
    try { await assert.rejects(access.issue(users[0], sessions[0], reservations[0]), { status: 409 }) }
    finally { await prisma.trip.update({ where: { id: trips[0] }, data: { status: 'SCHEDULED' } }) }
    await prisma.client.update({ where: { id: clients[0] }, data: { email: null } })
    try { await assert.rejects(access.issue(users[0], sessions[0], reservations[0]), { status: 409 }) }
    finally { await prisma.client.update({ where: { id: clients[0] }, data: { email: `${clients[0]}@example.invalid` } }) }
    await prisma.reservation.update({ where: { id: reservations[0] }, data: { clientId: clients[1] } })
    try { await assert.rejects(access.issue(users[0], sessions[0], reservations[0]), { status: 404 }) }
    finally { await prisma.reservation.update({ where: { id: reservations[0] }, data: { clientId: clients[0] } }) }
    await prisma.reservation.update({ where: { id: reservations[0] }, data: { status: 'CANCELLED' } })
    try { await assert.rejects(access.issue(users[0], sessions[0], reservations[0]), { status: 409 }); await access.revoke(users[0], sessions[0], reservations[0]) }
    finally { await prisma.reservation.update({ where: { id: reservations[0] }, data: { status: 'PENDING' } }) }
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
