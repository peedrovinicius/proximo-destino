import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from '../tenancy/company-scope.service'
import { CompanyDataService } from '../tenancy/company-data.service'

describe('core company data isolation in PostgreSQL (no production writes)', () => {
  const prisma = new PrismaService()
  const readers = new CompanyDataService(prisma, new CompanyScopeService(prisma))
  const suffix = randomUUID()
  const owner = `scope-owner-${suffix}`
  const users = [`scope-a-${suffix}`, `scope-b-${suffix}`]
  const companies = [`company-a-${suffix}`, `company-b-${suffix}`]
  const clients = [`client-a-${suffix}`, `client-b-${suffix}`, `client-legacy-${suffix}`]
  const trips = [`trip-a-${suffix}`, `trip-b-${suffix}`, `trip-legacy-${suffix}`]
  const reservations = [`reservation-a-${suffix}`, `reservation-b-${suffix}`, `reservation-legacy-${suffix}`]
  const sessions = [`session-a-${suffix}`, `session-b-${suffix}`]
  let connected = false

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires isolated database')
    await prisma.$connect(); connected = true
    await prisma.user.createMany({ data: [owner, ...users].map(id => ({ id, email: `${id}@example.invalid`,
      passwordHash: 'synthetic-unusable', role: id === owner ? 'CREATOR' : 'ADMIN' })) })
    await prisma.company.createMany({ data: companies.map(id => ({ id, slug: id, tradeName: id,
      contactEmail: 'contact@example.invalid', responsibleName: 'Synthetic responsible',
      responsibleEmail: 'responsible@example.invalid', createdById: owner, status: 'ACTIVE' })) })
    for (let i = 0; i < 2; i++) {
      await prisma.companyMembership.create({ data: { userId: users[i], companyId: companies[i], role: 'ADMIN' } })
      await prisma.authSession.create({ data: { id: sessions[i], userId: users[i], companyId: companies[i],
        refreshTokenHash: 'synthetic-unusable', expiresAt: new Date(Date.now() + 300_000) } })
    }
    for (let i = 0; i < 3; i++) {
      await prisma.client.create({ data: { id: clients[i], companyId: companies[i] ?? null,
        fullName: `Synthetic client ${i}`, email: `${clients[i]}@example.invalid`, notes: 'Private notes must not be exposed' } })
      await prisma.trip.create({ data: { id: trips[i], companyId: companies[i] ?? null, title: `Synthetic trip ${i}`,
        origin: 'Fortaleza', destination: 'Recife', departureDate: new Date('2027-01-01'), status: 'ACTIVE' } })
      await prisma.reservation.create({ data: { id: reservations[i], companyId: companies[i] ?? null,
        clientId: clients[i], tripId: trips[i], accessCodeHash: 'Private hash must not be exposed' } })
    }
  })
  after(async () => {
    if (!connected) return
    try {
      await prisma.reservation.deleteMany({ where: { id: { in: reservations } } })
      await prisma.client.deleteMany({ where: { id: { in: clients } } })
      await prisma.trip.deleteMany({ where: { id: { in: trips } } })
      await prisma.authSession.deleteMany({ where: { id: { in: sessions } } })
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: companies } } })
      await prisma.company.deleteMany({ where: { id: { in: companies } } })
      await prisma.user.deleteMany({ where: { id: { in: [owner, ...users] } } })
    } finally { await prisma.$disconnect() }
  })
  it('lists only the current company, never the other company or legacy unassigned data', async () => {
    for (let i = 0; i < 2; i++) {
      assert.deepEqual((await readers.clients(users[i], sessions[i])).map(row => row.id), [clients[i]])
      assert.deepEqual((await readers.trips(users[i], sessions[i])).map(row => row.id), [trips[i]])
      assert.deepEqual((await readers.reservations(users[i], sessions[i])).map(row => row.id), [reservations[i]])
    }
  })
  it('returns the same 404 for a foreign ID and a nonexistent ID', async () => {
    for (const i of [1, 2]) {
      await assert.rejects(readers.client(users[0], sessions[0], clients[i]), { status: 404 })
      await assert.rejects(readers.trip(users[0], sessions[0], trips[i]), { status: 404 })
      await assert.rejects(readers.reservation(users[0], sessions[0], reservations[i]), { status: 404 })
    }
    await assert.rejects(readers.client(users[0], sessions[0], 'nonexistent'), { status: 404 })
  })
  it('revalidates the session instead of trusting a user-supplied company or another session', async () => {
    await assert.rejects(readers.clients(users[0], sessions[1]), { status: 403 })
    await assert.rejects(readers.reservations(owner, sessions[0]), { status: 403 })
  })
  it('excludes encrypted/internal fields, private notes and reservation access hashes', async () => {
    const client = await readers.client(users[0], sessions[0], clients[0])
    const reservation = await readers.reservation(users[0], sessions[0], reservations[0])
    for (const key of ['notes', 'documentEncrypted', 'documentHash', 'userId']) assert.equal(key in client, false)
    assert.equal('accessCodeHash' in reservation, false)
    assert.equal('imageData' in reservation.trip, false)
  })
  it('database rejects cross-company and scoped/unscoped reservations', async () => {
    for (const data of [
      { companyId: companies[0], clientId: clients[0], tripId: trips[1] },
      { companyId: companies[1], clientId: clients[0], tripId: trips[1] },
      { companyId: null, clientId: clients[0], tripId: trips[2] },
      { companyId: companies[0], clientId: clients[2], tripId: trips[0] },
    ]) await assert.rejects(prisma.reservation.create({ data }), /company scope mismatch/)
    assert.equal(await prisma.reservation.count({ where: { clientId: { in: clients } } }), 3)
  })
  it('database prevents parent reassignment that would move another company reservation', async () => {
    await assert.rejects(prisma.client.update({ where: { id: clients[0] }, data: { companyId: companies[1] } }), /company scope mismatch/)
    await assert.rejects(prisma.trip.update({ where: { id: trips[0] }, data: { companyId: null } }), /company scope mismatch/)
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: clients[0] } })).companyId, companies[0])
  })
  it('permits coherent deferred reassignment of synthetic legacy records in one transaction', async () => {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED')
      await tx.reservation.update({ where: { id: reservations[2] }, data: { companyId: companies[0] } })
      await tx.client.update({ where: { id: clients[2] }, data: { companyId: companies[0] } })
      await tx.trip.update({ where: { id: trips[2] }, data: { companyId: companies[0] } })
    })
    assert.equal((await readers.reservation(users[0], sessions[0], reservations[2])).id, reservations[2])
  })
  it('rejects inconsistent changes at commit even if constraints are deferred', async () => {
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED')
      await tx.reservation.update({ where: { id: reservations[0] }, data: { companyId: companies[1] } })
    }), /company scope mismatch/)
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: reservations[0] } })).companyId, companies[0])
  })
  it('finance cannot browse clients/trips and gets minimized reservation identity', async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'FINANCE' } })
    await prisma.companyMembership.updateMany({ where: { userId: users[0], companyId: companies[0] }, data: { role: 'FINANCE' } })
    await assert.rejects(readers.clients(users[0], sessions[0]), { status: 403 })
    await assert.rejects(readers.trips(users[0], sessions[0]), { status: 403 })
    const reservation = await readers.reservation(users[0], sessions[0], reservations[0])
    assert.deepEqual(reservation.client, { id: clients[0] })
  })
})
