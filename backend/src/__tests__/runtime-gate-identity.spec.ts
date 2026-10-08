import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { PrismaService } from '../prisma/prisma.service'

// Entirely synthetic: the role exists only on CI's disposable local PostgreSQL.
// Never connect to a managed or production database for this proof.
describe('runtime production gate: synthetic restricted LOGIN', () => {
  const owner = new PrismaService()
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
  const role = `runtime_gate_${suffix}`
  let connected = false
  let roleCreated = false
  let runtimeUrl: URL

  const runGate = () => spawnSync('psql', [runtimeUrl.toString(), '-X',
    '--set=ON_ERROR_STOP=1', '--file=scripts/security/assert-runtime.sql'],
  { encoding: 'utf8', timeout: 10_000 })

  before(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(url.hostname),
      'This proof must use a disposable local PostgreSQL instance')
    await owner.$connect()
    connected = true
    const password = randomUUID()
    await owner.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    roleCreated = true
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await owner.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE
      ON TABLE public."Client", public."Trip", public."Reservation" TO "${role}"`)
    url.username = role
    url.password = password
    url.searchParams.delete('schema')
    runtimeUrl = url
  })

  after(async () => {
    if (!connected) return
    try {
      if (roleCreated) {
        await owner.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
    } finally {
      await owner.$disconnect()
    }
  })

  it('approves only a direct LOGIN with actual RLS and no direct identity mutations', () => {
    const gate = runGate()
    assert.equal(gate.status, 0, gate.stderr)
    // Demonstrate this is not a SET ROLE/owner bypass: log in as the real
    // ephemeral role with no persisted app.company_id/user_id/session_id.
    const probe = spawnSync('psql', [runtimeUrl.toString(), '-X', '-A', '-t',
      '--set=ON_ERROR_STOP=1', '--command=SELECT current_user, session_user, (SELECT count(*) FROM public."Client")'],
    { encoding: 'utf8', timeout: 10_000 })
    assert.equal(probe.status, 0, probe.stderr)
    assert.equal(probe.stdout.trim(), `${role}|${role}|0`)
  })

  it('fails closed on UPDATE/DELETE to tenant identity, even when normal tables remain scoped', async () => {
    for (const table of ['User', 'AuthSession', 'Company', 'CompanyMembership']) {
      for (const privilege of ['UPDATE', 'DELETE']) {
        await owner.$executeRawUnsafe(`GRANT ${privilege} ON TABLE public."${table}" TO "${role}"`)
        try {
          const gate = runGate()
          assert.notEqual(gate.status, 0, `Unexpected approval: ${table} ${privilege}`)
          assert.match(gate.stderr, /GATE_RUNTIME: escrita direta em identidade ou vinculos de tenant/)
        } finally {
          await owner.$executeRawUnsafe(`REVOKE ${privilege} ON TABLE public."${table}" FROM "${role}"`)
        }
        const recovered = runGate()
        assert.equal(recovered.status, 0, recovered.stderr)
      }
    }
  })

  it('rejects INSERT into tenant memberships regardless of RLS or apparent read-only access', async () => {
    await owner.$executeRawUnsafe(`GRANT INSERT ON TABLE public."CompanyMembership" TO "${role}"`)
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: escrita direta em identidade ou vinculos de tenant/)
    } finally {
      await owner.$executeRawUnsafe(`REVOKE INSERT ON TABLE public."CompanyMembership" FROM "${role}"`)
    }
    const recovered = runGate()
    assert.equal(recovered.status, 0, recovered.stderr)
  })
})
