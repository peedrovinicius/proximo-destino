import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

// Database-layer tenant proof with disposable synthetic fixtures only.
// Policies are created for a temporary LOGIN role in a local test database.
// Nothing here enables companies or installs policies into production.
// Trip has no RLS in current migrations: this role intentionally has no Trip grants.
// A production-ready Trip policy and app-scoped runtime remain separate release gates.
describe('tenant A/B RLS proof with a restricted PostgreSQL login', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
  const role = `tenant_probe_${suffix}`
  const policy = `tenant_probe_policy_${suffix}`
  const owner = new PrismaService()
  let runtime: PrismaService | undefined
  let connected = false
  let roleCreated = false
  const actor = `tenant-owner-${suffix}`
  const companies = [`tenant-company-a-${suffix}`, `tenant-company-b-${suffix}`]
  const clients = [`tenant-client-a-${suffix}`, `tenant-client-b-${suffix}`]
  const trips = [`tenant-trip-a-${suffix}`, `tenant-trip-b-${suffix}`]
  const reservations = [`tenant-reservation-a-${suffix}`, `tenant-reservation-b-${suffix}`]
  const tables = ['Client', 'Reservation'] as const

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname),
      'Never run tenant RLS proof against a production database')
    await owner.$connect()
    connected = true
    await owner.user.create({ data: {
      id: actor, email: `${actor}@example.invalid`, role: 'CREATOR', passwordHash: 'synthetic-unusable',
    } })
    for (let i = 0; i < 2; i++) {
      await owner.company.create({ data: {
        id: companies[i], slug: companies[i], tradeName: `Synthetic ${i}`,
        contactEmail: 'contact@example.invalid', responsibleName: 'Synthetic',
        responsibleEmail: 'responsible@example.invalid', status: 'ACTIVE', createdById: actor,
      } })
      await owner.client.create({ data: {
        id: clients[i], companyId: companies[i], fullName: `Synthetic client ${i}`,
      } })
      await owner.trip.create({ data: {
        id: trips[i], companyId: companies[i], title: `Synthetic trip ${i}`,
        origin: 'Fortaleza', destination: 'Recife', departureDate: new Date('2027-02-01'),
      } })
      await owner.reservation.create({ data: {
        id: reservations[i], companyId: companies[i], clientId: clients[i], tripId: trips[i],
      } })
    }
    const temporaryPassword = randomUUID()
    await owner.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${temporaryPassword}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    roleCreated = true
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    for (const table of tables) {
      await owner.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON TABLE public."${table}" TO "${role}"`)
      const check = `"companyId" IS NOT NULL
        AND "companyId" = NULLIF(current_setting('app.company_id', true), '')`
      await owner.$executeRawUnsafe(
        `CREATE POLICY "${policy}" ON public."${table}" FOR ALL TO "${role}"
          USING (${check}) WITH CHECK (${check})`)
    }
    database.username = role
    database.password = temporaryPassword
    runtime = new PrismaService({ datasourceUrl: database.toString() })
    await runtime.$connect()
    const [identity] = await runtime.$queryRaw<Array<{ current: string; session: string }>>`
      SELECT current_user AS current, session_user AS session
    `
    assert.equal(identity.current, role)
    assert.equal(identity.session, role)
  })

  after(async () => {
    await runtime?.$disconnect()
    if (!connected) return
    try {
      if (roleCreated) {
        for (const table of tables) {
          await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS "${policy}" ON public."${table}"`)
        }
        await owner.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
      await owner.reservation.deleteMany({ where: { id: { in: reservations } } })
      await owner.client.deleteMany({ where: { id: { in: clients } } })
      await owner.trip.deleteMany({ where: { id: { in: trips } } })
      await owner.company.deleteMany({ where: { id: { in: companies } } })
      await owner.user.deleteMany({ where: { id: actor } })
    } finally {
      await owner.$disconnect()
    }
  })

  async function asCompany<T>(companyId: string | null,
    callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    assert.ok(runtime)
    return runtime.$transaction(async tx => {
      if (companyId !== null) {
        // In production this context must only be established from a verified session.
        await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`
      }
      return callback(tx)
    })
  }

  it('has no visible client or reservation without a tenant context', async () => {
    await asCompany(null, async tx => {
      assert.deepEqual(await tx.client.findMany({ select: { id: true } }), [])
      assert.deepEqual(await tx.reservation.findMany({ select: { id: true } }), [])
    })
  })

  it('denies direct Trip access until a scoped production RLS policy exists', async () => {
    await assert.rejects(asCompany(companies[0], tx => tx.trip.findMany()),
      /permission denied|P1010|P2010/i)
  })

  it('isolates read access in both directions without relying on API filters', async () => {
    for (let i = 0; i < 2; i++) {
      await asCompany(companies[i], async tx => {
        assert.deepEqual((await tx.client.findMany({ select: { id: true } })).map(x => x.id), [clients[i]])
        assert.deepEqual((await tx.reservation.findMany({ select: { id: true } })).map(x => x.id),
          [reservations[i]])
        assert.equal(await tx.client.findUnique({ where: { id: clients[1 - i] } }), null)
        assert.equal(await tx.reservation.findUnique({ where: { id: reservations[1 - i] } }), null)
      })
    }
  })

  it('denies an insert for another tenant, and allows a same-tenant insert only inside rollback', async () => {
    await assert.rejects(asCompany(companies[0], async tx => {
      await tx.client.create({ data: {
        fullName: 'Must never enter tenant B', companyId: companies[1],
      } })
    }), /row-level security|P2004|P2010/i)
    await assert.rejects(asCompany(companies[0], async tx => {
      const own = await tx.client.create({ data: {
        fullName: 'Synthetic rollback', companyId: companies[0],
      } })
      assert.equal(own.companyId, companies[0])
      throw new Error('ROLLBACK_EXPECTED')
    }), /ROLLBACK_EXPECTED/)
    assert.equal(await owner.client.count({ where: { companyId: companies[0] } }), 1)
    assert.equal(await owner.client.count({ where: { companyId: companies[1] } }), 1)
  })

  it('cannot mutate a hidden foreign client or forge a reservation with foreign parents', async () => {
    await asCompany(companies[0], async tx => {
      const mutated = await tx.client.updateMany({
        where: { id: clients[1] }, data: { fullName: 'Forbidden mutation',
        },
      })
      assert.equal(mutated.count, 0)
    })
    await assert.rejects(asCompany(companies[0], async tx => {
      await tx.reservation.create({ data: {
        companyId: companies[1], clientId: clients[1], tripId: trips[1],
      } })
    }), /row-level security|P2004|P2010/i)
    assert.equal((await owner.client.findUniqueOrThrow({ where: { id: clients[1] } })).fullName,
      'Synthetic client 1')
  })
})
