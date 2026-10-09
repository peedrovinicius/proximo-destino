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
  let publicExecuteRevoked = false
  let runtimeUrl: URL
  const authorizers = [
    'public.company_tenant_authorized(text)',
    'public.company_write_authorized(text,text,text,text)',
  ] as const

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
    // Safe order: grant to the actual runtime LOGIN before removing the
    // migration's PostgreSQL-default PUBLIC grant. CI database only.
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION
      ${authorizers.join(', ')} TO "${role}"`)
    await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION
      ${authorizers.join(', ')} FROM PUBLIC`)
    publicExecuteRevoked = true
    url.username = role
    url.password = password
    url.searchParams.delete('schema')
    runtimeUrl = url
  })

  after(async () => {
    if (!connected) return
    try {
      // Restore the migration's original PUBLIC privileges ONLY inside the
      // disposable database; never touch a managed/runtime database.
      if (publicExecuteRevoked) {
        await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION
          ${authorizers.join(', ')} TO PUBLIC`)
      }
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

  it('proves PUBLIC EXECUTE exposure and rejects it without breaking explicit runtime access', async () => {
    const stranger = `untrusted_sql_${suffix}`
    const password = randomUUID()
    const strangerUrl = new URL(runtimeUrl)
    strangerUrl.username = stranger
    strangerUrl.password = password
    await owner.$executeRawUnsafe(`CREATE ROLE "${stranger}" LOGIN
      PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`)
    try {
      await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${stranger}"`)
      const calls = [
        { signature: authorizers[0],
          expression: "public.company_tenant_authorized('synthetic-nonexistent-company')" },
        { signature: authorizers[1],
          expression: "public.company_write_authorized('missing','missing','missing','ADMIN')" },
      ] as const
      const invoke = (url: URL, expression: string) =>
        spawnSync('psql', [url.toString(), '-X', '-A', '-t',
          '--set=ON_ERROR_STOP=1', `--command=SELECT ${expression}`],
        { encoding: 'utf8', timeout: 10_000 })
      for (const { signature, expression } of calls) {
        const denied = invoke(strangerUrl, expression)
        assert.notEqual(denied.status, 0, 'Unrelated login must not invoke SECURITY DEFINER')
        assert.match(denied.stderr, /permission denied for function/i)
        const authorized = invoke(runtimeUrl, expression)
        assert.equal(authorized.status, 0, authorized.stderr)
        assert.equal(authorized.stdout.trim(), 'f', 'No persisted tenant authorization exists')
        assert.equal(runGate().status, 0)

        // Re-create the unsafe PostgreSQL function-default grant.
        await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC`)
        try {
          const leaked = invoke(strangerUrl, expression)
          assert.equal(leaked.status, 0, leaked.stderr)
          assert.equal(leaked.stdout.trim(), 'f', 'The untrusted login can reach the definer')
          const unsafe = runGate()
          assert.notEqual(unsafe.status, 0, 'The runtime gate must reject PUBLIC execution')
          assert.match(unsafe.stderr, /GATE_RUNTIME: EXECUTE via PUBLIC em funcao SECURITY DEFINER/)
        } finally {
          await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`)
        }

        const restored = invoke(strangerUrl, expression)
        assert.notEqual(restored.status, 0)
        assert.match(restored.stderr, /permission denied for function/i)
        assert.equal(invoke(runtimeUrl, expression).status, 0)
        assert.equal(runGate().status, 0)
      }
    } finally {
      for (const signature of authorizers) {
        await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`)
      }
      await owner.$executeRawUnsafe(`DROP OWNED BY "${stranger}"`)
      await owner.$executeRawUnsafe(`DROP ROLE "${stranger}"`)
    }
  })


  it('rejects an unrelated LOGIN with direct EXECUTE on either reviewed definer', async () => {
    const stranger = `direct_exec_${suffix}`
    const password = randomUUID()
    const strangerUrl = new URL(runtimeUrl)
    strangerUrl.username = stranger
    strangerUrl.password = password
    await owner.$executeRawUnsafe(`CREATE ROLE "${stranger}" LOGIN PASSWORD '${password}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    try {
      await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${stranger}"`)
      for (const signature of authorizers) {
        assert.equal(runGate().status, 0)
        await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${signature} TO "${stranger}"`)
        try {
          const expression = signature === authorizers[0]
            ? "public.company_tenant_authorized('synthetic-missing-company')"
            : "public.company_write_authorized('missing','missing','missing','ADMIN')"
          const call = spawnSync('psql', [strangerUrl.toString(), '-X', '-A', '-t',
            '--set=ON_ERROR_STOP=1', `--command=SELECT ${expression}`],
          { encoding: 'utf8', timeout: 10_000 })
          assert.equal(call.status, 0, call.stderr)
          assert.equal(call.stdout.trim(), 'f', 'No persisted session authorizes this call')
          // Prior gate checked PUBLIC EXECUTE only and silently passed here.
          const gate = runGate()
          assert.notEqual(gate.status, 0)
          assert.match(gate.stderr,
            /GATE_RUNTIME: EXECUTE concedido a papel estranho em funcao SECURITY DEFINER/)
        } finally {
          await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION ${signature} FROM "${stranger}"`)
        }
        assert.equal(runGate().status, 0)
      }
    } finally {
      await owner.$executeRawUnsafe(`DROP OWNED BY "${stranger}"`)
      await owner.$executeRawUnsafe(`DROP ROLE "${stranger}"`)
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects a reachable non-public SECURITY DEFINER despite no schema CREATE grant', async () => {
    const schema = `synthetic_authority_${suffix}`
    const signature = `"${schema}".privileged_read()`
    const sql = (expression: string) => spawnSync('psql', [runtimeUrl.toString(),
      '-X', '-A', '-t', '--set=ON_ERROR_STOP=1', `--command=SELECT ${expression}`],
    { encoding: 'utf8', timeout: 10_000 })
    assert.equal(runGate().status, 0)
    await owner.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    try {
      await owner.$executeRawUnsafe(`CREATE FUNCTION ${signature}
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog AS
        'SELECT has_table_privilege(current_user, ''public."AuthSession"'', ''SELECT'')'`)
      await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
      const direct = sql(`has_table_privilege(current_user, 'public."AuthSession"', 'SELECT')`)
      assert.equal(direct.status, 0, direct.stderr)
      assert.equal(direct.stdout.trim(), 'f')
      const definer = sql(signature)
      assert.equal(definer.status, 0, definer.stderr)
      assert.equal(definer.stdout.trim(), 't', 'Unreviewed owner privileges were callable')
      let gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: funcao SECURITY DEFINER acessivel fora de public/)

      // The reachability test cannot depend on PUBLIC alone.
      await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${signature} TO "${role}"`)
      await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`)
      gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: funcao SECURITY DEFINER acessivel fora de public/)
    } finally {
      await owner.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects an unreviewed PUBLIC SECURITY DEFINER that runs with owner privileges', async () => {
    const helper = `unreviewed_authority_${suffix}`
    const signature = `public."${helper}"()`
    const sql = (expression: string) => spawnSync('psql', [runtimeUrl.toString(),
      '-X', '-A', '-t', '--set=ON_ERROR_STOP=1', `--command=SELECT ${expression}`],
    { encoding: 'utf8', timeout: 10_000 })

    // An unrelated restricted LOGIN cannot read persisted sessions directly.
    const direct = sql(`has_table_privilege(current_user, 'public."AuthSession"', 'SELECT')`)
    assert.equal(direct.status, 0, direct.stderr)
    assert.equal(direct.stdout.trim(), 'f')
    assert.equal(runGate().status, 0)

    await owner.$executeRawUnsafe(`CREATE FUNCTION ${signature}
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog AS
      'SELECT has_table_privilege(current_user, ''public."AuthSession"'', ''SELECT'')'`)
    try {
      // PostgreSQL grants EXECUTE to PUBLIC by default. A caller can now
      // borrow the function owner's privilege without a valid tenant context.
      const escalated = sql(signature)
      assert.equal(escalated.status, 0, escalated.stderr)
      assert.equal(escalated.stdout.trim(), 't')
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: funcao SECURITY DEFINER nao revisada/)

      // Even if that new definer is not publicly invocable, it must still
      // undergo explicit review rather than silently enter the inventory.
      await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`)
      const closed = runGate()
      assert.notEqual(closed.status, 0)
      assert.match(closed.stderr, /GATE_RUNTIME: funcao SECURITY DEFINER nao revisada/)
    } finally {
      await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${signature}`)
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects database-level CREATE granted to the otherwise restricted runtime', async () => {
    const [row] = await owner.$queryRaw<Array<{ databaseName: string }>>`
      SELECT current_database() AS "databaseName"
    `
    assert.ok(row.databaseName)
    const database = `"${row.databaseName.replaceAll('"', '""')}"`
    assert.equal(runGate().status, 0)
    await owner.$executeRawUnsafe(`GRANT CREATE ON DATABASE ${database} TO "${role}"`)
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: runtime possui DDL, ownership ou privilegios elevados/)
    } finally {
      await owner.$executeRawUnsafe(`REVOKE CREATE ON DATABASE ${database} FROM "${role}"`)
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects CREATE on a non-public application schema', async () => {
    const schema = `synthetic_runtime_schema_${suffix}`
    await owner.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    try {
      await owner.$executeRawUnsafe(`GRANT USAGE, CREATE ON SCHEMA "${schema}" TO "${role}"`)
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: runtime possui DDL, ownership ou privilegios elevados/)
    } finally {
      await owner.$executeRawUnsafe(`REVOKE USAGE, CREATE ON SCHEMA "${schema}" FROM "${role}"`)
      await owner.$executeRawUnsafe(`DROP SCHEMA "${schema}"`)
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects a tampered tenant SECURITY DEFINER function that exposes a synthetic row', async () => {
    const original = await owner.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_functiondef('public.company_tenant_authorized(text)'::regprocedure) AS definition
    `
    assert.equal(original.length, 1)
    const client = await owner.client.create({ data: { fullName: `Definer bypass synthetic ${suffix}` } })
    const count = () => spawnSync('psql', [runtimeUrl.toString(), '-X', '-A', '-t',
      '--set=ON_ERROR_STOP=1',
      `--command=SELECT count(*) FROM public."Client" WHERE "id" = '${client.id}'`],
    { encoding: 'utf8', timeout: 10_000 })
    try {
      const before = count()
      assert.equal(before.status, 0, before.stderr)
      assert.equal(before.stdout.trim(), '0')
      // Keep SECURITY DEFINER, STABLE and name, which satisfied the old gate.
      await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION public.company_tenant_authorized(target_company TEXT)
        RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog AS 'SELECT true'`)
      const exposed = count()
      assert.equal(exposed.status, 0, exposed.stderr)
      assert.equal(exposed.stdout.trim(), '1')
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: integridade de funcao SECURITY DEFINER/)
    } finally {
      await owner.$executeRawUnsafe(original[0].definition)
      await owner.client.delete({ where: { id: client.id } })
    }
    const restored = runGate()
    assert.equal(restored.status, 0, restored.stderr)
  })

  it('rejects replacement of authorization lock with an unconditional true response', async () => {
    const original = await owner.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_functiondef('public.company_write_authorized(text,text,text,text)'::regprocedure) AS definition
    `
    assert.equal(original.length, 1)
    try {
      await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION public.company_write_authorized(
        target_company TEXT, target_user TEXT, target_session TEXT, target_role TEXT)
        RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path = pg_catalog AS 'BEGIN RETURN true; END;'`)
      const tested = spawnSync('psql', [runtimeUrl.toString(), '-X', '-A', '-t',
        '--set=ON_ERROR_STOP=1',
        '--command=SELECT public.company_write_authorized(\'not-a-company\',\'not-a-user\',\'not-a-session\',\'ADMIN\')'],
      { encoding: 'utf8', timeout: 10_000 })
      assert.equal(tested.status, 0, tested.stderr)
      assert.equal(tested.stdout.trim(), 't')
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: integridade de funcao SECURITY DEFINER/)
    } finally {
      await owner.$executeRawUnsafe(original[0].definition)
    }
    assert.equal(runGate().status, 0)
  })

  it('denies unsafe search_path for a trusted SECURITY DEFINER function', async () => {
    try {
      await owner.$executeRawUnsafe(`ALTER FUNCTION public.company_tenant_authorized(text)
        SET search_path = public`)
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: integridade de funcao SECURITY DEFINER/)
    } finally {
      await owner.$executeRawUnsafe(`ALTER FUNCTION public.company_tenant_authorized(text)
        SET search_path = pg_catalog`)
    }
    assert.equal(runGate().status, 0)
  })

  it('captures canonical function bodies only from the disposable PostgreSQL test database', async () => {
    const rows = await owner.$queryRaw<Array<{ name: string; digest: string; path: string | null; owner: string }>>`
      SELECT p.proname AS name, md5(p.prosrc) AS digest,
        array_to_string(p.proconfig, ',') AS path,
        pg_get_userbyid(p.proowner) AS owner
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('company_tenant_authorized','company_write_authorized')
      ORDER BY p.proname
    `
    assert.equal(rows.length, 2)
    assert.ok(rows.every(row => /^[a-f0-9]{32}$/.test(row.digest) &&
      row.path === 'search_path=pg_catalog' && row.owner !== role))
    const expected = {
      company_tenant_authorized: '89c73cf7463057fb31dad559036b9d93',
      company_write_authorized: 'df80a956fd405ae0e9e109ef0c93e783',
    }
    assert.deepEqual(rows.map(row => ({ name: row.name, digest: row.digest })),
      Object.entries(expected).map(([name, digest]) => ({ name, digest })))
    assert.equal(runGate().status, 0)
  })

  it('rejects a shadowing overload even though the canonical function still exists', async () => {
    await owner.$executeRawUnsafe(`CREATE FUNCTION public.company_tenant_authorized(
      target_company TEXT, extra TEXT) RETURNS BOOLEAN
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog AS 'SELECT false'`)
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: integridade de funcao SECURITY DEFINER/)
    } finally {
      await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.company_tenant_authorized(text,text)`)
    }
    assert.equal(runGate().status, 0)
  })

  it('rejects a runtime connection that cannot execute the required authorization function', async () => {
    // The suite uses direct grants and denies PUBLIC by default. Revoke
    // only the explicit runtime grant to prove the existing EXECUTE guard.
    await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION
      public.company_tenant_authorized(text) FROM "${role}"`)
    try {
      const gate = runGate()
      assert.notEqual(gate.status, 0)
      assert.match(gate.stderr, /GATE_RUNTIME: integridade de funcao SECURITY DEFINER/)
    } finally {
      await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION
        public.company_tenant_authorized(text) TO "${role}"`)
    }
    assert.equal(runGate().status, 0)
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
