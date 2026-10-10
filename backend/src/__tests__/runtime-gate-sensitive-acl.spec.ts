import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { PrismaService } from '../prisma/prisma.service'

// RED regression proof for GitHub CI's disposable postgres:18 service ONLY.
// Never run against managed, staging, or production PostgreSQL.
// This spec tests unsafe ACL grants without writing any sensitive table rows.
describe('sensitive PostgreSQL ACLs: unrelated synthetic LOGIN', () => {
  const owner = new PrismaService()
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
  const runtimeRole = `acl_runtime_${suffix}`
  const strangerRole = `acl_stranger_${suffix}`
  let connected = false
  let rolesCreated = false
  let publicExecuteRevoked = false
  let runtimeUrl: URL
  const functions = [
    'public.company_tenant_authorized(text)',
    'public.company_write_authorized(text,text,text,text)',
  ] as const
  const sensitiveTables = [
    'CompanyClientPortalSession',
    'EmailOAuthState',
    'PaymentOAuthState',
    'EmailProviderConnection',
    'PaymentProviderConnection',
    'PaymentPlatformConfig',
  ] as const
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const

  const runGate = () => spawnSync('psql', [runtimeUrl.toString(), '-X',
    '--set=ON_ERROR_STOP=1', '--file=scripts/security/assert-runtime.sql'],
  { encoding: 'utf8', timeout: 10_000 })

  before(async () => {
    const dbUrl = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(dbUrl.hostname),
      'Only disposable local/CI PostgreSQL is allowed')
    // Require the dedicated CI database name, never a generic local database.
    assert.equal(dbUrl.pathname, '/proximo_destino')
    await owner.$connect()
    connected = true
    const runtimePassword = randomUUID()
    const strangerPassword = randomUUID()
    await owner.$executeRawUnsafe(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    rolesCreated = true
    await owner.$executeRawUnsafe(`CREATE ROLE "${strangerRole}" LOGIN PASSWORD '${strangerPassword}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}", "${strangerRole}"`)
    await owner.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE
      ON TABLE public."Client", public."Trip", public."Reservation" TO "${runtimeRole}"`)
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION
      ${functions.join(', ')} TO "${runtimeRole}"`)
    await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION
      ${functions.join(', ')} FROM PUBLIC`)
    publicExecuteRevoked = true
    dbUrl.username = runtimeRole
    dbUrl.password = runtimePassword
    dbUrl.searchParams.delete('schema')
    runtimeUrl = dbUrl
  })

  after(async () => {
    if (!connected) return
    try {
      if (publicExecuteRevoked) {
        await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION
          ${functions.join(', ')} TO PUBLIC`)
      }
      if (rolesCreated) {
        await owner.$executeRawUnsafe(`DROP OWNED BY "${strangerRole}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${strangerRole}"`)
        await owner.$executeRawUnsafe(`DROP OWNED BY "${runtimeRole}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${runtimeRole}"`)
      }
    } finally {
      await owner.$disconnect()
    }
  })

  it('rejects each unexpected effective ACL on six secret and token tables', async () => {
    const baseline = runGate()
    assert.equal(baseline.status, 0, baseline.stderr)
    for (const table of sensitiveTables) {
      for (const privilege of privileges) {
        const name = `public."${table}"`
        const before = await owner.$queryRawUnsafe<Array<{ allowed: boolean }>>(
          'SELECT has_table_privilege($1, $2, $3) AS allowed',
          strangerRole, name, privilege)
        assert.equal(before[0].allowed, false,
          `Synthetic stranger must start without ${privilege} on ${table}`)

        await owner.$executeRawUnsafe(
          `GRANT ${privilege} ON TABLE ${name} TO "${strangerRole}"`)
        try {
          const effective = await owner.$queryRawUnsafe<Array<{ allowed: boolean }>>(
            'SELECT has_table_privilege($1, $2, $3) AS allowed',
            strangerRole, name, privilege)
          assert.equal(effective[0].allowed, true,
            `PostgreSQL did not apply synthetic ${privilege} grant on ${table}`)
          const rejected = runGate()
          assert.notEqual(rejected.status, 0,
            `Unsafe ${table} ${privilege} grant escaped runtime attestation`)
          assert.match(rejected.stderr, /GATE_RUNTIME:/)
        } finally {
          await owner.$executeRawUnsafe(
            `REVOKE ${privilege} ON TABLE ${name} FROM "${strangerRole}"`)
        }
        const restored = runGate()
        assert.equal(restored.status, 0, restored.stderr)
      }
    }
  })
})
