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

  it('rejects a role-scoped permissive RLS policy that exposes a foreign row without true literals', async () => {
    const client = await owner.client.create({ data: { fullName: `Synthetic RLS probe ${suffix}` } })
    try {
      const count = () => spawnSync('psql', [runtimeUrl.toString(), '-X', '-A', '-t',
        '--set=ON_ERROR_STOP=1',
        `--command=SELECT count(*) FROM public."Client" WHERE "id" = '${client.id}'`],
      { encoding: 'utf8', timeout: 10_000 })
      const before = count()
      assert.equal(before.status, 0, before.stderr)
      assert.equal(before.stdout.trim(), '0')
      await owner.$executeRawUnsafe(`CREATE POLICY "synthetic_rls_leak_${suffix}"
        ON public."Client" FOR SELECT TO "${role}"
        USING ("id" IS NOT NULL)`)
      try {
        // PostgreSQL OR-combines this new permissive policy with the
        // persisted-session policy; the row is now visible without any session.
        const exposed = count()
        assert.equal(exposed.status, 0, exposed.stderr)
        assert.equal(exposed.stdout.trim(), '1')
        const gate = runGate()
        assert.notEqual(gate.status, 0)
        assert.match(gate.stderr, /GATE_RUNTIME: politica RLS permissiva nao revisada ou enfraquecida/)
      } finally {
        await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS "synthetic_rls_leak_${suffix}" ON public."Client"`)
      }
      const safe = count()
      assert.equal(safe.status, 0, safe.stderr)
      assert.equal(safe.stdout.trim(), '0')
      assert.equal(runGate().status, 0)
    } finally {
      await owner.client.delete({ where: { id: client.id } })
    }
  })

  it('rejects additional PUBLIC permissive policies and permits harmless restrictive policies', async () => {
    await owner.$executeRawUnsafe(`CREATE POLICY "synthetic_public_leak_${suffix}"
      ON public."Trip" FOR SELECT TO PUBLIC USING (1 = 1)`)
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: politica RLS permissiva nao revisada ou enfraquecida/)
    } finally {
      await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS "synthetic_public_leak_${suffix}" ON public."Trip"`)
    }
    await owner.$executeRawUnsafe(`CREATE POLICY "synthetic_restrict_${suffix}"
      ON public."Trip" AS RESTRICTIVE FOR SELECT TO "${role}" USING (false)`)
    try {
      const gate = runGate()
      assert.equal(gate.status, 0, gate.stderr)
    } finally {
      await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS "synthetic_restrict_${suffix}" ON public."Trip"`)
    }
  })

  it('rejects a reviewed tenant policy if its persisted-session check is replaced', async () => {
    await owner.$executeRawUnsafe(`ALTER POLICY "tenant_session_client" ON public."Client"
      USING ("id" IS NOT NULL) WITH CHECK ("id" IS NOT NULL)`)
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: politica RLS permissiva nao revisada ou enfraquecida/)
    } finally {
      await owner.$executeRawUnsafe(`ALTER POLICY "tenant_session_client" ON public."Client"
        USING (public.company_tenant_authorized("companyId"))
        WITH CHECK (public.company_tenant_authorized("companyId"))`)
    }
    const recovered = runGate()
    assert.equal(recovered.status, 0, recovered.stderr)
  })

  it('checks coverage of all 15 reviewed tenant policy fingerprints', async () => {
    const baseline = await owner.$queryRaw<Array<{ tablename: string; fingerprint: string }>>`
      SELECT tablename, md5(coalesce(qual, '') || chr(31) || coalesce(with_check, '')) AS fingerprint
      FROM pg_policies
      WHERE schemaname = 'public' AND policyname LIKE 'tenant_session_%'
      ORDER BY tablename
    `
    assert.equal(baseline.length, 15)
    assert.ok(baseline.every(row => /^[a-f0-9]{32}$/.test(row.fingerprint)))
    assert.equal(runGate().status, 0)
  })

  it('rejects a malicious OR appended to an approved client policy while keeping tenant guard text', async () => {
    const before = await owner.$queryRaw<Array<{ qual: string; with_check: string }>>`
      SELECT qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='Client' AND policyname='tenant_session_client'
    `
    assert.equal(before.length, 1)
    const original = before[0]
    const own = await owner.client.create({ data: { fullName: `Synthetic canonical guard ${suffix}` } })
    try {
      const query = () => spawnSync('psql', [runtimeUrl.toString(), '-X', '-A', '-t',
        '--set=ON_ERROR_STOP=1',
        `--command=SELECT count(*) FROM public."Client" WHERE "id" = '${own.id}'`],
      { encoding: 'utf8', timeout: 10_000 })
      assert.equal(query().stdout.trim(), '0')
      for (const clause of ['USING', 'WITH CHECK'] as const) {
        const changedUsing = clause === 'USING'
          ? '(public.company_tenant_authorized("companyId") OR "id" IS NOT NULL)' : original.qual
        const changedWrite = clause === 'WITH CHECK'
          ? '(public.company_tenant_authorized("companyId") OR "id" IS NOT NULL)' : original.with_check
        await owner.$executeRawUnsafe(`ALTER POLICY "tenant_session_client" ON public."Client"
          USING (${changedUsing}) WITH CHECK (${changedWrite})`)
        try {
          if (clause === 'USING') {
            const exposed = query()
            assert.equal(exposed.status, 0, exposed.stderr)
            assert.equal(exposed.stdout.trim(), '1', 'An injected OR must expose the synthetic record before the gate blocks it')
          }
          const gate = runGate()
          assert.notEqual(gate.status, 0, `Malicious ${clause} unexpectedly approved`)
          assert.match(gate.stderr, /GATE_RUNTIME: expressao RLS aprovada foi alterada/)
        } finally {
          await owner.$executeRawUnsafe(`ALTER POLICY "tenant_session_client" ON public."Client"
            USING (${original.qual}) WITH CHECK (${original.with_check})`)
        }
      }
      assert.equal(query().stdout.trim(), '0')
    } finally {
      await owner.client.delete({ where: { id: own.id } })
    }
    const restored = runGate()
    assert.equal(restored.status, 0, restored.stderr)
  })

  it('rejects edited nested tenant policies even when they preserve the authorization function', async () => {
    const old = await owner.$queryRaw<Array<{ qual: string; with_check: string }>>`
      SELECT qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='ClientCreditTransaction'
        AND policyname='tenant_session_client_credit'
    `
    assert.equal(old.length, 1)
    const orig = old[0]
    await owner.$executeRawUnsafe(`ALTER POLICY "tenant_session_client_credit"
      ON public."ClientCreditTransaction"
      USING ((${orig.qual}) OR "id" IS NOT NULL)
      WITH CHECK (${orig.with_check})`)
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: expressao RLS aprovada foi alterada/)
    } finally {
      await owner.$executeRawUnsafe(`ALTER POLICY "tenant_session_client_credit"
        ON public."ClientCreditTransaction"
        USING (${orig.qual}) WITH CHECK (${orig.with_check})`)
    }
    const safe = runGate()
    assert.equal(safe.status, 0, safe.stderr)
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
