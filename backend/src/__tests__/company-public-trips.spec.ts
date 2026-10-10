import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, after, describe, it } from 'node:test'
import { Controller, Get, UseGuards, ValidationPipe, type INestApplication } from '@nestjs/common'
import * as argon2 from 'argon2'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyPublicTripsService } from '../trips/company-public-trips.service'
import { CompanyPublicTripsController } from '../trips/company-public-trips.controller'
import { TripsService } from '../trips/trips.service'
import { TripsController } from '../trips/trips.controller'
import { PortalService } from '../portal/portal.service'
import { ClientPortalGuard } from '../portal/client-portal.guard'
import { CompanyClientPortalController } from '../portal/company-client-portal.controller'
import { CompanyClientPortalService } from '../portal/company-client-portal.service'

@Controller('test-legacy-portal')
class LegacyPortalProbe {
  @Get()
  @UseGuards(ClientPortalGuard)
  read() { return { legacy: true } }
}

describe('company public catalogs in isolated PostgreSQL', () => {
  const prisma = new PrismaService(), suffix = randomUUID()
  const config = new ConfigService({ COMPANY_FOUNDATION_ENABLED: 'true', COMPANY_CLIENT_PORTAL_ENABLED: 'true', JWT_ACCESS_SECRET: 'synthetic-public-portal-test-secret' })
  const jwt = new JwtService()
  const owner = `public-owner-${suffix}`
  const companies = ['a', 'b', 'draft', 'suspended'].map(s => `public-company-${s}-${suffix}`)
  const ids = ['a', 'b', 'draft-company', 'suspended-company', 'draft-trip', 'past', 'cancelled', 'legacy'].map(s => `public-trip-${s}-${suffix}`)
  const clients = [0, 1, 2].map(i => `public-client-${i}-${suffix}`)
  const reservations = [0, 1, 2].map(i => `public-reservation-${i}-${suffix}`)
  let app: INestApplication | undefined, base: string
  const get = (path: string) => fetch(`${base}${path}`)
  before(async () => {
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['127.0.0.1', 'localhost', 'postgres'].includes(new URL(process.env.DATABASE_URL!).hostname))
    await prisma.$connect()
    await prisma.user.create({ data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic', role: 'CREATOR' } })
    for (let i = 0; i < companies.length; i++) {
      await prisma.company.create({ data: { id: companies[i], slug: companies[i], tradeName: `Synthetic company ${i}`,
        status: i === 2 ? 'DRAFT' : i === 3 ? 'SUSPENDED' : 'ACTIVE', createdById: owner,
        contactEmail: 'private-contact@example.invalid', responsibleName: 'private-responsible', responsibleEmail: 'private-responsible@example.invalid' } })
    }
    await prisma.trip.createMany({ data: ids.map((id, i) => ({ id, companyId: i === 7 ? null : companies[i < 4 ? i : 0],
      title: `Synthetic public ${i}`, origin: 'Fortaleza', destination: 'Recife', status: i === 4 ? 'DRAFT' : i === 6 ? 'CANCELLED' : 'SCHEDULED',
      departureDate: i === 5 ? new Date('2020-01-01') : new Date('2027-01-01'), capacity: 4, busTemplate: 'CUSTOM',
      seatLayout: 'TWO_BY_TWO', blockedSeats: [4], vehicleFeatures: [{ type: 'RESTROOM', position: 'REAR', side: 'RIGHT', deck: 1, secret: 'private-feature' }] })) })
    for (let i = 0; i < 3; i++) {
      const companyId = i < 2 ? companies[i] : null
      await prisma.client.create({ data: { id: clients[i], companyId, fullName: 'private-passenger', email: `${clients[i]}@example.invalid` } })
      await prisma.reservation.create({ data: { id: reservations[i], companyId, clientId: clients[i], tripId: i < 2 ? ids[i] : ids[7],
        accessCodeHash: await argon2.hash('SYNTHETIC-CODE'), companyPortalCodeExpiresAt: new Date(Date.now() + 86_400_000) } })
    }
    await prisma.seatAssignment.create({ data: { tripId: ids[0], reservationId: reservations[0], seatNumber: 1 } })
    const module = await Test.createTestingModule({ controllers: [CompanyPublicTripsController, TripsController, LegacyPortalProbe, CompanyClientPortalController],
      providers: [CompanyPublicTripsService, TripsService, ClientPortalGuard, CompanyClientPortalService, { provide: JwtService, useValue: jwt },
        { provide: PrismaService, useValue: prisma }, { provide: ConfigService, useValue: config }] }).compile()
    app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.listen(0, '127.0.0.1'); base = await app.getUrl()
  })
  after(async () => {
    await app?.close()
    await prisma.authAuditEvent.deleteMany({ where: { OR: companies.map(companyId => ({ metadata: { path: ['companyId'], equals: companyId } })) } })
    await prisma.seatAssignment.deleteMany({ where: { tripId: { in: ids } } })
    await prisma.reservation.deleteMany({ where: { id: { in: reservations } } })
    await prisma.client.deleteMany({ where: { id: { in: clients } } })
    await prisma.trip.deleteMany({ where: { id: { in: ids } } })
    await prisma.company.deleteMany({ where: { id: { in: companies } } })
    await prisma.user.deleteMany({ where: { id: owner } }); await prisma.$disconnect()
  })
  it('lists only the selected active company and future published trips without private fields', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await get(`/public/companies/${companies[i]}/trips`)
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
      const body = await response.json() as { trips: { id: string }[]; company: { slug: string; tradeName: string }; readOnly: boolean; hasMore: boolean }
      assert.deepEqual(body.trips.map(row => row.id), [ids[i]])
      assert.deepEqual(body.company, { slug: companies[i], tradeName: `Synthetic company ${i}` })
      assert.equal(body.readOnly, true); assert.equal(body.hasMore, false)
      const text = JSON.stringify(body)
      for (const field of ['companyId', 'responsible', 'contactEmail', 'passenger', 'reservations', 'createdBy', 'private']) assert.equal(text.includes(field), false)
      const detail = await get(`/public/companies/${companies[i]}/trips/${ids[i]}`)
      assert.equal(detail.status, 200); assert.equal((await detail.json() as { trip: { id: string } }).trip.id, ids[i])
    }
  })
  it('denies foreign, draft, past and disabled company catalogs without enabling reservation writes', async () => {
    for (const id of ids.slice(1)) assert.equal((await get(`/public/companies/${companies[0]}/trips/${id}`)).status, 404)
    for (const slug of [companies[2], companies[3], 'unknown', 'INVALID!']) {
      assert.equal((await get(`/public/companies/${slug}/trips`)).status, 404)
    }
    config.set('COMPANY_FOUNDATION_ENABLED', 'false')
    try { assert.equal((await get(`/public/companies/${companies[0]}/trips`)).status, 404) }
    finally { config.set('COMPANY_FOUNDATION_ENABLED', 'true') }
    assert.equal((await fetch(`${base}/public/companies/${companies[0]}/trips`, { method: 'POST' })).status, 404)
    const portal = new PortalService(prisma, new JwtService(), config)
    await assert.rejects(portal.requestReservation({ tripId: ids[0], fullName: 'Synthetic request', email: 'synthetic@example.invalid',
      phone: '85999999999', passengerCount: 1 }), { status: 404 })
  })
  it('returns only seat numbers and safe vehicle features, refusing incoherent occupancy', async () => {
    const path = `/public/companies/${companies[0]}/trips/${ids[0]}/seats`
    const response = await get(path); assert.equal(response.status, 200)
    const body = await response.json() as { occupiedSeats: number[]; blockedSeats: number[]; availableCount: number; vehicleFeatures: object[] }
    assert.deepEqual(body.occupiedSeats, [1]); assert.deepEqual(body.blockedSeats, [4]); assert.equal(body.availableCount, 2)
    assert.deepEqual(body.vehicleFeatures, [{ type: 'RESTROOM', position: 'REAR', side: 'RIGHT', deck: 1 }])
    const text = JSON.stringify(body)
    for (const field of ['private', 'client', 'passenger', 'companyId', 'reservationId', 'assignments']) assert.equal(text.includes(field), false)
    assert.equal((await get(`/public/companies/${companies[1]}/trips/${ids[0]}/seats`)).status, 404)
    const malformed = await prisma.seatAssignment.create({ data: { tripId: ids[0], reservationId: reservations[1], seatNumber: 3 } })
    try { assert.equal((await get(path)).status, 409) }
    finally { await prisma.seatAssignment.delete({ where: { id: malformed.id } }) }
  })
  it('validates repeated filters and calendar dates and keeps legacy public routes company-free', async () => {
    const path = `/public/companies/${companies[0]}/trips`
    for (const query of ['origin=A&origin=B', 'departureDate=2027-02-31', 'departureDate=tomorrow']) assert.equal((await get(`${path}?${query}`)).status, 400)
    const filtered = await (await get(`${path}?origin=FORTALEZA&destination=Recife&departureDate=2027-01-01`)).json() as { trips: { id: string }[] }
    assert.deepEqual(filtered.trips.map(row => row.id), [ids[0]])
    const legacy = await (await get('/public/trips?origin=Fortaleza&destination=Recife')).json() as { id: string }[]
    assert.ok(legacy.some(row => row.id === ids[7]))
    for (const id of ids.slice(0, 7)) assert.equal(legacy.some(row => row.id === id), false)
    for (const suffix of ['', '/seats', '/image']) assert.equal((await get(`/public/trips/${ids[0]}${suffix}`)).status, 404)
    assert.equal((await get(`/public/trips/${ids[7]}`)).status, 200)
  })
  it('bounds catalog responses and explicitly signals additional trips', async () => {
    const extra = Array.from({ length: 101 }, (_, i) => `public-extra-${suffix}-${String(i).padStart(3, '0')}`)
    try {
      await prisma.trip.createMany({ data: extra.map(id => ({ id, companyId: companies[0], title: 'Synthetic bounded catalog',
        origin: 'Synthetic origin', destination: 'Synthetic destination', status: 'SCHEDULED', departureDate: new Date('2027-01-02') })) })
      const path = `/public/companies/${companies[0]}/trips?origin=Synthetic%20origin`
      const response = await get(path); assert.equal(response.status, 200)
      const body = await response.json() as { trips: { id: string }[]; hasMore: boolean; limit: number }
      assert.equal(body.limit, 100); assert.equal(body.hasMore, true)
      assert.deepEqual(body.trips.map(row => row.id), extra.slice(0, 100))
    } finally { await prisma.trip.deleteMany({ where: { id: { in: extra } } }) }
  })
  it('never overwrites a company client through a legacy anonymous reservation', async () => {
    const portal = new PortalService(prisma, jwt, config)
    const before = await prisma.client.findUniqueOrThrow({ where: { id: clients[0] } })
    await assert.rejects(portal.requestReservation({ tripId: ids[7], fullName: 'Anonymous overwrite attempt',
      email: `${clients[0]}@example.invalid`, phone: '85999999999', passengerCount: 1, selectedSeats: [2] }), { status: 409 })
    assert.deepEqual(await prisma.client.findUniqueOrThrow({ where: { id: clients[0] } }), before)
    assert.equal(await prisma.reservation.count({ where: { tripId: ids[7] } }), 1)
    assert.equal(await prisma.seatAssignment.count({ where: { tripId: ids[7] } }), 0)
  })
  it('excludes company codes from legacy login while preserving unassigned reservations', async () => {
    const portal = new PortalService(prisma, jwt, config)
    for (const client of clients.slice(0, 2)) {
      await assert.rejects(portal.login({ email: `${client}@example.invalid`, code: 'SYNTHETIC-CODE' }), { status: 401 })
    }
    const result = await portal.login({ email: `${clients[2]}@example.invalid`, code: 'SYNTHETIC-CODE' })
    assert.equal((await fetch(`${base}/test-legacy-portal`, { headers: { Authorization: `Bearer ${result.accessToken}` } })).status, 200)
  })
  it('denies company, mismatched and missing reservations even with correctly signed legacy tokens', async () => {
    for (const [clientId, reservationId] of [[clients[0], reservations[0]], [clients[1], reservations[1]],
      [clients[2], reservations[0]], [clients[0], reservations[2]], [clients[2], 'missing-reservation']]) {
      const token = await jwt.signAsync({ sub: clientId, rid: reservationId, type: 'client_portal', companyId: null },
        { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1m' })
      const response = await fetch(`${base}/test-legacy-portal`, { headers: { Authorization: `Bearer ${token}` } })
      assert.equal(response.status, 401)
    }
  })
  const portal = new CompanyClientPortalService(prisma, config)
  const credentials = (i = 0) => ({ reservationId: reservations[i], email: `${clients[i]}@example.invalid`, code: 'SYNTHETIC-CODE' })
  const post = (slug: string, input: object) => fetch(`${base}/public/companies/${slug}/client/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  it('issues a hashed opaque session and reads only that company reservation through HTTP', async () => {
    const response = await post(companies[0], credentials())
    assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store')
    const result = await response.json() as { accessToken: string; readOnly: boolean }
    assert.match(result.accessToken, /^[A-Za-z0-9_-]{43}$/); assert.equal(result.readOnly, true)
    const session = await prisma.companyClientPortalSession.findFirstOrThrow({ where: { reservationId: reservations[0], revokedAt: null } })
    assert.notEqual(session.tokenHash, result.accessToken); assert.equal(session.tokenHash.length, 64)
    const read = await fetch(`${base}/public/companies/${companies[0]}/client/portal`, { headers: { Authorization: `Bearer ${result.accessToken}` } })
    assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store')
    const body = await read.json() as { company: object; reservation: { seats: number[] } }
    assert.deepEqual(body.company, { slug: companies[0], tradeName: 'Synthetic company 0' })
    assert.deepEqual(body.reservation.seats, [1])
    for (const value of ['private-passenger', '@example.invalid', 'accessCode', 'tokenHash', 'credentialVersion', 'clientId', 'reservationId', 'companyId']) {
      assert.equal(JSON.stringify(body).includes(value), false)
    }
    assert.equal((await fetch(`${base}/public/companies/${companies[1]}/client/portal`, { headers: { Authorization: `Bearer ${result.accessToken}` } })).status, 401)
    assert.equal((await fetch(`${base}/test-legacy-portal`, { headers: { Authorization: `Bearer ${result.accessToken}` } })).status, 401)
  })
  it('rejects injected ownership and invalid inputs, and keeps both feature gates strict', async () => {
    for (const input of [{ ...credentials(), companyId: companies[0] }, { ...credentials(), email: 'invalid' }, { ...credentials(), code: [] }]) {
      assert.equal((await post(companies[0], input)).status, 400)
    }
    for (const name of ['COMPANY_FOUNDATION_ENABLED', 'COMPANY_CLIENT_PORTAL_ENABLED']) {
      for (const value of [undefined, 'false', 'TRUE', '1']) {
        config.set(name, value)
        try { assert.equal((await post(companies[0], credentials())).status, 404) }
        finally { config.set(name, 'true') }
      }
    }
    await assert.rejects(portal.login(companies[1], credentials()), { status: 401 })
    await assert.rejects(portal.login(companies[0], credentials(2)), { status: 401 })
  })
  it('persists five failed attempts, locks for fifteen minutes and resets only after expiry', async () => {
    for (let i = 0; i < 5; i++) await assert.rejects(portal.login(companies[1], { ...credentials(1), code: 'WRONG-CODE' }), { status: 401 })
    const locked = await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[1] } })
    assert.equal(locked.companyPortalFailedAttempts, 5)
    assert.ok(locked.companyPortalLockedUntil!.getTime() > Date.now() + 14 * 60_000)
    await assert.rejects(portal.login(companies[1], credentials(1)), { status: 401 })
    assert.equal(await prisma.companyClientPortalSession.count({ where: { reservationId: reservations[1] } }), 0)
    await prisma.reservation.update({ where: { id: reservations[1] }, data: { companyPortalLockedUntil: new Date(0) } })
    await portal.login(companies[1], credentials(1))
    const reset = await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[1] } })
    assert.equal(reset.companyPortalFailedAttempts, 0); assert.equal(reset.companyPortalLockedUntil, null)
  })
  it('revokes preceding sessions at login, expires sessions and makes logout persistent', async () => {
    const first = await portal.login(companies[0], credentials()), second = await portal.login(companies[0], credentials())
    await assert.rejects(portal.portal(companies[0], first.accessToken), { status: 401 })
    assert.equal((await portal.portal(companies[0], second.accessToken)).readOnly, true)
    await portal.logout(companies[0], second.accessToken)
    await assert.rejects(portal.portal(companies[0], second.accessToken), { status: 401 })
    const expired = await portal.login(companies[0], credentials())
    await prisma.companyClientPortalSession.updateMany({ where: { reservationId: reservations[0], revokedAt: null }, data: { expiresAt: new Date(0) } })
    await assert.rejects(portal.portal(companies[0], expired.accessToken), { status: 401 })
  })
  it('revalidates company status, cancellation and credential rotation on each portal read', async () => {
    const result = await portal.login(companies[0], credentials())
    await prisma.company.update({ where: { id: companies[0] }, data: { status: 'SUSPENDED' } })
    try { await assert.rejects(portal.portal(companies[0], result.accessToken), { status: 401 }) }
    finally { await prisma.company.update({ where: { id: companies[0] }, data: { status: 'ACTIVE' } }) }
    await prisma.reservation.update({ where: { id: reservations[0] }, data: { status: 'CANCELLED' } })
    try { await assert.rejects(portal.portal(companies[0], result.accessToken), { status: 401 }) }
    finally { await prisma.reservation.update({ where: { id: reservations[0] }, data: { status: 'PENDING' } }) }
    const before = await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[0] } })
    await prisma.reservation.update({ where: { id: reservations[0] }, data: { accessCodeHash: await argon2.hash('ROTATED-CODE') } })
    try { await assert.rejects(portal.portal(companies[0], result.accessToken), { status: 401 }) }
    finally { await prisma.reservation.update({ where: { id: reservations[0] }, data: { accessCodeHash: before.accessCodeHash } }) }
  })
  it('rolls back session issuance and preceding-session revocation when audit fails', async () => {
    const active = await portal.login(companies[0], credentials())
    const before = await prisma.companyClientPortalSession.findMany({ where: { reservationId: reservations[0] }, orderBy: { id: 'asc' } })
    const failing = new CompanyClientPortalService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) => prisma.$transaction(tx =>
      callback(new Proxy(tx, { get: (target, key) => key === 'authAuditEvent' ? { create: async () => { throw new Error('synthetic audit failure') } } : Reflect.get(target, key) }))),
    } as unknown as PrismaService, config)
    await assert.rejects(failing.login(companies[0], credentials()), /synthetic audit failure/)
    assert.deepEqual(await prisma.companyClientPortalSession.findMany({ where: { reservationId: reservations[0] }, orderBy: { id: 'asc' } }), before)
    assert.equal((await portal.portal(companies[0], active.accessToken)).readOnly, true)
    await assert.rejects(failing.logout(companies[0], active.accessToken), /synthetic audit failure/)
    assert.equal((await portal.portal(companies[0], active.accessToken)).readOnly, true)
  })
})
