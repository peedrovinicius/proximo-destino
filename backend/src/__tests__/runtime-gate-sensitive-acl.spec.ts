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
  it('rejects PUBLIC grants across the sensitive ACL matrix', async () => {
    assert.equal(runGate().status, 0)
    for (const table of sensitiveTables) {
      for (const privilege of privileges) {
        const name = `public."${table}"`
        await owner.$executeRawUnsafe(`GRANT ${privilege} ON TABLE ${name} TO PUBLIC`)
        try {
          const gate = runGate()
          assert.notEqual(gate.status, 0, `PUBLIC ${privilege} on ${table} was accepted`)
          assert.match(gate.stderr, /GATE_RUNTIME: ACL sensivel concedida a papel nao autorizado/)
        } finally {
          await owner.$executeRawUnsafe(`REVOKE ${privilege} ON TABLE ${name} FROM PUBLIC`)
        }
        assert.equal(runGate().status, 0)
      }
    }
  })

  it('preserves explicitly authorized runtime grants on sensitive tables', async () => {
    assert.equal(runGate().status, 0)
    for (const table of sensitiveTables) {
      for (const privilege of privileges) {
        const name = `public."${table}"`
        await owner.$executeRawUnsafe(
          `GRANT ${privilege} ON TABLE ${name} TO "${runtimeRole}"`)
        try {
          const effective = await owner.$queryRawUnsafe<Array<{ allowed: boolean }>>(
            'SELECT has_table_privilege($1, $2, $3) AS allowed',
            runtimeRole, name, privilege)
          assert.equal(effective[0].allowed, true)
          const gate = runGate()
          assert.equal(gate.status, 0,
            `Runtime ${privilege} on ${table} was unexpectedly denied: ${gate.stderr}`)
        } finally {
          await owner.$executeRawUnsafe(
            `REVOKE ${privilege} ON TABLE ${name} FROM "${runtimeRole}"`)
        }
        assert.equal(runGate().status, 0)
      }
    }
  })

  it('rejects each missing sensitive credential or session table', async () => {
    assert.equal(runGate().status, 0)
    for (const table of sensitiveTables) {
      const hidden = `synthetic_hidden_${table}`
      await owner.$executeRawUnsafe(`ALTER TABLE public."${table}" RENAME TO "${hidden}"`)
      try {
        const gate = runGate()
        assert.notEqual(gate.status, 0, `Missing sensitive ${table} table escaped attestation`)
        assert.match(gate.stderr, /GATE_RUNTIME:/)
      } finally {
        await owner.$executeRawUnsafe(`ALTER TABLE public."${hidden}" RENAME TO "${table}"`)
      }
      assert.equal(runGate().status, 0)
    }
  })

  it('rejects disabled RLS on portal sessions', async () => {
    assert.equal(runGate().status, 0)
    await owner.$executeRawUnsafe('ALTER TABLE public."CompanyClientPortalSession" DISABLE ROW LEVEL SECURITY')
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0, 'Disabled portal RLS must fail closed')
      assert.match(gate.stderr, /GATE_RUNTIME:/)
    } finally {
      await owner.$executeRawUnsafe('ALTER TABLE public."CompanyClientPortalSession" ENABLE ROW LEVEL SECURITY')
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects an additional permissive portal policy while default deny remains', async () => {
    assert.equal(runGate().status, 0)
    await owner.$executeRawUnsafe(`GRANT SELECT ON TABLE public."CompanyClientPortalSession" TO "${runtimeRole}"`)
    await owner.$executeRawUnsafe(`CREATE POLICY synthetic_portal_leak ON public."CompanyClientPortalSession"
      FOR SELECT TO "${runtimeRole}" USING ("id" IS NOT NULL)`)
    try {
      const effective = await owner.$queryRawUnsafe<Array<{ allowed: boolean }>>(
        'SELECT has_table_privilege($1, $2, $3) AS allowed',
        runtimeRole, 'public."CompanyClientPortalSession"', 'SELECT')
      assert.equal(effective[0].allowed, true)
      const gate = runGate()
      assert.notEqual(gate.status, 0, 'Additional permissive portal policy escaped attestation')
      assert.match(gate.stderr, /GATE_RUNTIME:/)
    } finally {
      await owner.$executeRawUnsafe('DROP POLICY synthetic_portal_leak ON public."CompanyClientPortalSession"')
      await owner.$executeRawUnsafe(`REVOKE SELECT ON TABLE public."CompanyClientPortalSession" FROM "${runtimeRole}"`)
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects foreign role inherited ACL grants', async () => {
    const parent = `acl_group_${suffix}`
    await owner.$executeRawUnsafe(`CREATE ROLE "${parent}" NOLOGIN`)
    try {
      await owner.$executeRawUnsafe(`GRANT "${parent}" TO "${strangerRole}" WITH INHERIT TRUE`)
      await owner.$executeRawUnsafe(`GRANT SELECT ON TABLE public."CompanyClientPortalSession" TO "${parent}"`)
      try {
        const effective = await owner.$queryRawUnsafe<Array<{ allowed: boolean }>>(
          'SELECT has_table_privilege($1, $2, $3) AS allowed',
          strangerRole, 'public."CompanyClientPortalSession"', 'SELECT')
        assert.equal(effective[0].allowed, true)
        const gate = runGate()
        assert.notEqual(gate.status, 0, 'Inherited foreign role grant must fail closed')
        assert.match(gate.stderr, /GATE_RUNTIME:/)
      } finally {
        await owner.$executeRawUnsafe(`REVOKE SELECT ON TABLE public."CompanyClientPortalSession" FROM "${parent}"`)
        await owner.$executeRawUnsafe(`REVOKE "${parent}" FROM "${strangerRole}"`)
      }
    } finally {
      await owner.$executeRawUnsafe(`DROP ROLE "${parent}"`)
    }
    assert.equal(runGate().status, 0)
  })

  it('documents owner/superuser RLS bypass versus restricted runtime', async () => {
    const ownerStatus = await owner.$queryRawUnsafe<Array<{ active: boolean }>>(
      'SELECT row_security_active($1::regclass) AS active',
      'public."CompanyClientPortalSession"')
    assert.equal(ownerStatus[0].active, false,
      'Migration owner/superuser should bypass RLS without FORCE')
    const runtime = spawnSync('psql', [runtimeUrl.toString(), '-X', '-At',
      '--set=ON_ERROR_STOP=1', '-c',
      'SELECT row_security_active(\'public."CompanyClientPortalSession"\'::regclass)'],
    { encoding: 'utf8', timeout: 10_000 })
    assert.equal(runtime.status, 0, runtime.stderr)
    assert.equal(runtime.stdout.trim(), 't',
      'Restricted runtime must be covered by portal RLS')
    assert.equal(runGate().status, 0)
  })

  it('accepts least-privilege runtime ACL without DELETE on portal and payment config', async () => {
    const protectedNames = ['CompanyClientPortalSession', 'PaymentPlatformConfig'] as const
    for (const table of protectedNames) {
      const name = `public."${table}"`
      await owner.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON TABLE ${name} TO "${runtimeRole}"`)
      try {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE'] as const) {
          const rows = await owner.$queryRawUnsafe<Array<{ allowed: boolean }>>(
            'SELECT has_table_privilege($1, $2, $3) AS allowed',
            runtimeRole, name, privilege)
          assert.equal(rows[0].allowed, true, `${table} must permit ${privilege}`)
        }
        const deleteRows = await owner.$queryRawUnsafe<Array<{ allowed: boolean }>>(
          'SELECT has_table_privilege($1, $2, $3) AS allowed',
          runtimeRole, name, 'DELETE')
        assert.equal(deleteRows[0].allowed, false,
          `${table} must deny DELETE`)
        const gate = runGate()
        assert.equal(gate.status, 0, gate.stderr)
      } finally {
        await owner.$executeRawUnsafe(
          `REVOKE SELECT, INSERT, UPDATE ON TABLE ${name} FROM "${runtimeRole}"`)
      }
      assert.equal(runGate().status, 0)
    }
  })

  it('runs synthetic payment configuration DML without DELETE privilege', async () => {
    const table = 'public."PaymentPlatformConfig"'
    const provider = 'SYNTHETIC_' + suffix
    await owner.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE ON TABLE ' + table + ' TO "' + runtimeRole + '"')
    const query = (sql: string) => spawnSync('psql', [runtimeUrl.toString(), '-X',
      '--set=ON_ERROR_STOP=1', '-At', '-c', sql], { encoding: 'utf8', timeout: 10_000 })
    try {
      const created = query(`INSERT INTO ${table} ("id","provider","clientId","clientSecretEncrypted","webhookSecretEncrypted","configuredAt","updatedAt")
        VALUES ('${provider}','${provider}','initial','synthetic-a','synthetic-b',now(),now())`)
      assert.equal(created.status, 0, created.stderr)
      const changed = query(`UPDATE ${table} SET "clientId"='updated' WHERE "provider"='${provider}'`)
      assert.equal(changed.status, 0, changed.stderr)
      const read = query(`SELECT "clientId" FROM ${table} WHERE "provider"='${provider}'`)
      assert.equal(read.status, 0, read.stderr)
      assert.equal(read.stdout.trim(), 'updated')
      const forbidden = query(`DELETE FROM ${table} WHERE "provider"='${provider}'`)
      assert.notEqual(forbidden.status, 0)
      assert.match(forbidden.stderr, /permission denied/i)
      assert.equal(runGate().status, 0)
    } finally {
      await owner.paymentPlatformConfig.deleteMany({ where: { provider } })
      await owner.$executeRawUnsafe('REVOKE SELECT, INSERT, UPDATE ON TABLE ' + table + ' FROM "' + runtimeRole + '"')
    }
  })

  it('proves default deny portal RLS blocks runtime from reading synthetic sessions', async () => {
    const table = 'public."CompanyClientPortalSession"'
    await owner.$executeRawUnsafe('GRANT SELECT ON TABLE ' + table + ' TO "' + runtimeRole + '"')
    try {
      const result = spawnSync('psql', [runtimeUrl.toString(), '-X',
        '--set=ON_ERROR_STOP=1', '-At', '-c',
        'SELECT count(*) FROM public."CompanyClientPortalSession"'],
      { encoding: 'utf8', timeout: 10_000 })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), '0')
      assert.equal(runGate().status, 0)
    } finally {
      await owner.$executeRawUnsafe('REVOKE SELECT ON TABLE ' + table + ' FROM "' + runtimeRole + '"')
    }
  })

  it('documents blocked portal login with an entirely synthetic company and reservation', async () => {
    const id = 'fixture_' + suffix
    const companyId = 'co_' + suffix
    const clientId = 'cl_' + suffix
    const tripId = 'tr_' + suffix
    const reservationId = 'rs_' + suffix
    const userId = 'usr_' + suffix
    await owner.user.create({ data: { id: userId, email: id + '@example.invalid',
      passwordHash: 'synthetic-unusable', role: 'CREATOR' } })
    try {
      await owner.company.create({ data: { id: companyId, slug: 'fixture-' + suffix,
        tradeName: 'Synthetic', contactEmail: id + '@example.invalid',
        responsibleName: 'Synthetic', responsibleEmail: id + '@example.invalid',
        status: 'ACTIVE', createdById: userId } })
      await owner.client.create({ data: { id: clientId, companyId, fullName: 'Synthetic Client',
        email: 'client-' + suffix + '@example.invalid' } })
      await owner.trip.create({ data: { id: tripId, companyId, title: 'Synthetic',
        origin: 'Test', destination: 'Test', departureDate: new Date(Date.now() + 86400000),
        status: 'ACTIVE' } })
      await owner.reservation.create({ data: { id: reservationId, companyId, clientId, tripId,
        accessCodeHash: 'synthetic-hash', companyPortalCodeExpiresAt: new Date(Date.now()+3600000) } })
      await owner.$executeRawUnsafe(
        'GRANT SELECT, INSERT, UPDATE ON TABLE public."CompanyClientPortalSession" TO "' + runtimeRole + '"')
      try {
        const sql = `INSERT INTO public."CompanyClientPortalSession"
          ("id","tokenHash","companyId","clientId","reservationId","credentialVersion","expiresAt")
          VALUES ('${id}','${'b'.repeat(64)}','${companyId}','${clientId}',
            '${reservationId}','synthetic-version',NOW()+INTERVAL '30 minutes')`
        const attempt = spawnSync('psql', [runtimeUrl.toString(), '-X',
          '--set=ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', timeout: 10000 })
        assert.notEqual(attempt.status, 0, 'Default-deny RLS must block portal session creation')
        assert.match(attempt.stderr, /row-level security|violates row-level security policy/i)
        const count = await owner.companyClientPortalSession.count({ where: { reservationId } })
        assert.equal(count, 0, 'Denied login must not persist a session')
        assert.equal(runGate().status, 0)
      } finally {
        await owner.$executeRawUnsafe(
          'REVOKE SELECT, INSERT, UPDATE ON TABLE public."CompanyClientPortalSession" FROM "' + runtimeRole + '"')
      }
    } finally {
      await owner.companyClientPortalSession.deleteMany({ where: { reservationId } })
      await owner.reservation.deleteMany({ where: { id: reservationId } })
      await owner.trip.deleteMany({ where: { id: tripId } })
      await owner.client.deleteMany({ where: { id: clientId } })
      await owner.company.deleteMany({ where: { id: companyId } })
      await owner.user.deleteMany({ where: { id: userId } })
    }
  })

})
