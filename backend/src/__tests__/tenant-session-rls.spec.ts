import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

describe('session-backed tenant RLS with a restricted PostgreSQL login', () => {
  const owner = new PrismaService()
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
  const role = `tenant_session_${suffix}`
  const ownerId = `rls-owner-${suffix}`
  const users = [`rls-user-a-${suffix}`, `rls-user-b-${suffix}`]
  const companies = [`rls-company-a-${suffix}`, `rls-company-b-${suffix}`]
  const sessions = [`rls-session-a-${suffix}`, `rls-session-b-${suffix}`]
  const clients = [`rls-client-a-${suffix}`, `rls-client-b-${suffix}`]
  const trips = [`rls-trip-a-${suffix}`, `rls-trip-b-${suffix}`]
  const reservations = [`rls-reservation-a-${suffix}`, `rls-reservation-b-${suffix}`]
  const companions = [`rls-companion-a-${suffix}`, `rls-companion-b-${suffix}`]
  const passengers = [`rls-passenger-a-${suffix}`, `rls-passenger-b-${suffix}`]
  const seats = [`rls-seat-a-${suffix}`, `rls-seat-b-${suffix}`]
  const documents = [`rls-document-a-${suffix}`, `rls-document-b-${suffix}`]
  const portalSessions = [`rls-portal-a-${suffix}`, `rls-portal-b-${suffix}`]
  let runtime: PrismaService | undefined
  let connected = false
  let roleCreated = false

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname),
      'Never run tenant RLS proof against production')
    await owner.$connect()
    connected = true

    await owner.user.createMany({ data: [
      { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic', role: 'CREATOR' },
      ...users.map((id, index) => ({ id, email: `${id}@example.invalid`,
        passwordHash: 'synthetic', role: index === 0 ? 'ADMIN' as const : 'AGENT' as const })),
    ] })

    for (let i = 0; i < 2; i++) {
      await owner.company.create({ data: {
        id: companies[i], slug: companies[i], tradeName: `Synthetic tenant ${i}`,
        contactEmail: 'contact@example.invalid', responsibleName: 'Synthetic',
        responsibleEmail: 'responsible@example.invalid', status: 'ACTIVE', createdById: ownerId,
      } })
      await owner.companyMembership.create({ data: {
        companyId: companies[i], userId: users[i], role: i === 0 ? 'ADMIN' : 'AGENT',
      } })
      await owner.authSession.create({ data: {
        id: sessions[i], companyId: companies[i], userId: users[i],
        refreshTokenHash: 'synthetic', expiresAt: new Date(Date.now() + 300_000),
      } })
      await owner.client.create({ data: {
        id: clients[i], companyId: companies[i], fullName: `Synthetic client ${i}`,
      } })
      await owner.trip.create({ data: {
        id: trips[i], companyId: companies[i], title: `Synthetic trip ${i}`,
        origin: 'Fortaleza', destination: 'Recife', departureDate: new Date('2027-04-01'),
        capacity: 40,
      } })
      await owner.reservation.create({ data: {
        id: reservations[i], companyId: companies[i], clientId: clients[i], tripId: trips[i],
        passengers: { create: { id: passengers[i], sequence: 1, isPrimary: true,
          fullName: `Synthetic passenger ${i}` } },
      } })
      await owner.companion.create({ data: {
        id: companions[i], clientId: clients[i], fullName: `Synthetic companion ${i}`,
      } })
      await owner.seatAssignment.create({ data: {
        id: seats[i], tripId: trips[i], reservationId: reservations[i],
        passengerId: passengers[i], seatNumber: i + 1,
      } })
      await owner.travelDocument.create({ data: {
        id: documents[i], reservationId: reservations[i], type: 'TRAVEL_VOUCHER',
        version: 1, documentNumber: `synthetic-doc-${suffix}-${i}`,
        verificationCode: `synthetic-code-${suffix}-${i}`,
        snapshot: { label: 'fictitious document', tenant: i },
      } })
      await owner.companyClientPortalSession.create({ data: {
        id: portalSessions[i], reservationId: reservations[i],
        companyId: companies[i], clientId: clients[i],
        tokenHash: `synthetic-token-${suffix}-${i}`,
        credentialVersion: 'synthetic-unusable',
        expiresAt: new Date(Date.now() + 300_000),
      } })
    }

    const password = randomUUID()
    await owner.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    roleCreated = true
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    for (const table of ['Client', 'Companion', 'Trip', 'Reservation', 'ReservationPassenger', 'SeatAssignment', 'TravelDocument']) {
      await owner.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON TABLE public."${table}" TO "${role}"`)
    }

    database.username = role
    database.password = password
    runtime = new PrismaService({ datasourceUrl: database.toString() })
    await runtime.$connect()
  })

  after(async () => {
    await runtime?.$disconnect()
    if (!connected) return
    try {
      if (roleCreated) {
        await owner.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
      await owner.companyClientPortalSession.deleteMany({ where: { id: { in: portalSessions } } })
      await owner.travelDocument.deleteMany({ where: { id: { in: documents } } })
      await owner.seatAssignment.deleteMany({ where: { id: { in: seats } } })
      await owner.reservationPassenger.deleteMany({ where: { id: { in: passengers } } })
      await owner.companion.deleteMany({ where: { id: { in: companions } } })
      await owner.reservation.deleteMany({ where: { id: { in: reservations } } })
      await owner.client.deleteMany({ where: { id: { in: clients } } })
      await owner.trip.deleteMany({ where: { id: { in: trips } } })
      await owner.authSession.deleteMany({ where: { id: { in: sessions } } })
      await owner.companyMembership.deleteMany({ where: { companyId: { in: companies } } })
      await owner.company.deleteMany({ where: { id: { in: companies } } })
      await owner.user.deleteMany({ where: { id: { in: [ownerId, ...users] } } })
    } finally {
      await owner.$disconnect()
    }
  })

  async function scoped<T>(companyId: string | null, userId: string | null, sessionId: string | null,
    callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    assert.ok(runtime)
    return runtime.$transaction(async tx => {
      if (companyId !== null) await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`
      if (userId !== null) await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`
      if (sessionId !== null) await tx.$queryRaw`SELECT set_config('app.session_id', ${sessionId}, true)`
      return callback(tx)
    })
  }

  async function visibleIds(tx: Prisma.TransactionClient) {
    const [clientRows, tripRows, reservationRows, companionRows, passengerRows, seatRows] = await Promise.all([
      tx.client.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      tx.trip.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      tx.reservation.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      tx.companion.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      tx.reservationPassenger.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      tx.seatAssignment.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    ])
    return [clientRows, tripRows, reservationRows, companionRows, passengerRows, seatRows]
      .map(rows => rows.map(row => row.id))
  }

  it('returns no tenant rows without a complete valid persisted session context', async () => {
    for (const context of [
      [null, null, null],
      [companies[0], null, null],
      [companies[0], users[0], null],
      [companies[1], users[0], sessions[0]],
      [companies[0], users[1], sessions[0]],
    ] as const) {
      const ids = await scoped(context[0], context[1], context[2], visibleIds)
      assert.deepEqual(ids, [[], [], [], [], [], []])
    }
  })

  it('shows only the authenticated company across central and derived tables', async () => {
    for (let i = 0; i < 2; i++) {
      const ids = await scoped(companies[i], users[i], sessions[i], visibleIds)
      assert.deepEqual(ids, [[clients[i]], [trips[i]], [reservations[i]],
        [companions[i]], [passengers[i]], [seats[i]]])
    }
  })

  it('denies cross-tenant writes even if the attacker changes app.company_id', async () => {
    await assert.rejects(scoped(companies[1], users[0], sessions[0], tx =>
      tx.client.create({ data: { companyId: companies[1], fullName: 'Forged tenant client' } })),
    /row-level security|P2004|P2010/i)

    await scoped(companies[0], users[0], sessions[0], async tx => {
      assert.equal((await tx.client.updateMany({ where: { id: clients[1] },
        data: { fullName: 'Forbidden foreign update' } })).count, 0)
    })
    assert.equal((await owner.client.findUniqueOrThrow({ where: { id: clients[1] } })).fullName,
      'Synthetic client 1')
  })

  it('isolates travel documents and derived passenger/seat writes with the restricted login', async () => {
    for (let i = 0; i < 2; i++) {
      await scoped(companies[i], users[i], sessions[i], async tx => {
        assert.deepEqual((await tx.travelDocument.findMany({ select: { id: true } }))
          .map(item => item.id), [documents[i]])
        assert.equal(await tx.travelDocument.findUnique({ where: { id: documents[1 - i] } }), null)
        assert.equal((await tx.travelDocument.updateMany({ where: { id: documents[1 - i] },
          data: { snapshot: { modified: true } } })).count, 0)
        assert.equal((await tx.reservationPassenger.updateMany({ where: { id: passengers[1 - i] },
          data: { fullName: 'Cross-tenant modification denied' } })).count, 0)
        assert.equal((await tx.seatAssignment.updateMany({ where: { id: seats[1 - i] },
          data: { seatNumber: 30 } })).count, 0)
      })
    }
    await assert.rejects(scoped(companies[0], users[0], sessions[0], tx =>
      tx.travelDocument.create({ data: {
        reservationId: reservations[1], type: 'TRAVEL_VOUCHER',
        version: 2, documentNumber: `denied-doc-${suffix}`,
        verificationCode: `denied-verification-${suffix}`,
        snapshot: { denied: true },
      } })), /row-level security|P2004|P2010/i)
    assert.equal((await owner.travelDocument.findUniqueOrThrow({ where: { id: documents[1] } }))
      .snapshot && true, true)
    assert.equal((await owner.reservationPassenger.findUniqueOrThrow({ where: { id: passengers[1] } }))
      .fullName, 'Synthetic passenger 1')
    assert.equal((await owner.seatAssignment.findUniqueOrThrow({ where: { id: seats[1] } }))
      .seatNumber, 2)
  })

  it('does not grant the operational SQL login direct access to private portal sessions', async () => {
    // Portal sessions are intentionally not among the operational tenant grants:
    // this table holds hashed bearer tokens and must not be readable by SQL tenants.
    await assert.rejects(scoped(companies[0], users[0], sessions[0], tx =>
      tx.companyClientPortalSession.findMany({ select: { id: true, tokenHash: true } })),
    /permission denied|P2010|P2004/i)
    assert.equal(await owner.companyClientPortalSession.count({ where: { id: { in: portalSessions } } }), 2)
  })

  it('revocation or expiry hides all documents and other derived records', async () => {
    for (const kind of ['revoked', 'expired'] as const) {
      await owner.authSession.update({ where: { id: sessions[0] },
        data: kind === 'revoked' ? { revokedAt: new Date() } : { expiresAt: new Date(0) } })
      try {
        await scoped(companies[0], users[0], sessions[0], async tx => {
          assert.deepEqual(await tx.travelDocument.findMany({ select: { id: true } }), [])
          assert.deepEqual(await tx.reservationPassenger.findMany({ select: { id: true } }), [])
          assert.deepEqual(await tx.seatAssignment.findMany({ select: { id: true } }), [])
        })
      } finally {
        await owner.authSession.update({ where: { id: sessions[0] },
          data: { revokedAt: null, expiresAt: new Date(Date.now() + 300_000) } })
      }
      assert.deepEqual((await scoped(companies[1], users[1], sessions[1], tx =>
        tx.travelDocument.findMany({ select: { id: true } })).map(doc => doc.id)), [documents[1]])
    }
  })

  it('revoking membership invalidates the database policy immediately', async () => {
    await owner.companyMembership.updateMany({ where: { companyId: companies[0], userId: users[0] },
      data: { isActive: false } })
    try {
      const ids = await scoped(companies[0], users[0], sessions[0], visibleIds)
      assert.deepEqual(ids, [[], [], [], [], [], []])
      await assert.rejects(scoped(companies[0], users[0], sessions[0], tx =>
        tx.trip.create({ data: { companyId: companies[0], title: 'Denied after revoke',
          origin: 'X', destination: 'Y', departureDate: new Date('2027-05-01') } })),
      /row-level security|P2004|P2010/i)
    } finally {
      await owner.companyMembership.updateMany({ where: { companyId: companies[0], userId: users[0] },
        data: { isActive: true } })
    }
  })

  it('revoked and expired sessions fail closed without changing policy definitions', async () => {
    await owner.authSession.update({ where: { id: sessions[0] }, data: { revokedAt: new Date() } })
    try {
      assert.deepEqual(await scoped(companies[0], users[0], sessions[0], visibleIds),
        [[], [], [], [], [], []])
    } finally {
      await owner.authSession.update({ where: { id: sessions[0] }, data: { revokedAt: null } })
    }

    await owner.authSession.update({ where: { id: sessions[0] },
      data: { expiresAt: new Date(Date.now() - 1_000) } })
    try {
      assert.deepEqual(await scoped(companies[0], users[0], sessions[0], visibleIds),
        [[], [], [], [], [], []])
    } finally {
      await owner.authSession.update({ where: { id: sessions[0] },
        data: { expiresAt: new Date(Date.now() + 300_000) } })
    }
  })
})
