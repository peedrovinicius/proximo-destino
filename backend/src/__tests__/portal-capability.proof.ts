import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException } from '@nestjs/common'
import * as argon2 from 'argon2'
import { ExperimentalPortalCapability } from '../portal/experimental-portal-capability'

// Explicit *.proof.js entry point: NOT included by the normal *.spec.js glob.
// No network providers, real identities or managed database may be used here.
describe('experimental signed portal capability: actual restricted PostgreSQL LOGIN', () => {
  const owner = new PrismaClient()
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
  const role = 'cap_runtime_' + suffix
  const key = randomBytes(32)
  const code = 'SYNTHETIC-PORTAL-ACCESS'
  const actorId = 'cap_actor_' + suffix
  const companies = ['a', 'b'].map(tenant => 'cap_company_' + suffix + tenant)
  const reservation = (tenant: string) => 'cap_reservation_' + suffix + tenant
  const slug = (tenant: string) => 'cap-' + suffix + '-' + tenant
  const email = (tenant: string) => 'cap-' + suffix + tenant + '@example.invalid'
  const input = (tenant: string) => ({ reservationId: reservation(tenant), email: email(tenant), code })
  const functions = 'public.company_tenant_authorized(text), public.company_write_authorized(text,text,text,text)'
  let runtime: PrismaClient
  let service: ExperimentalPortalCapability
  let runtimeUrl: URL
  let hash: string
  let roleCreated = false
  let fixtureCreated = false
  let publicRevoked = false
  const unauthorized = (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException)
    assert.equal(error.getStatus(), 401)
    return true
  }
  const signed = (fields: Record<string, unknown>) => {
    const payload = JSON.stringify({ v: 1, expires: Math.floor(Date.now() / 1000) + 20, ...fields })
    return { payload, signature: createHmac('sha256', key).update(payload).digest('hex') }
  }
  const lookup = async (request = signed({ op: 'lookup', nonce: randomBytes(32).toString('hex'),
    slug: slug('a'), reservationId: reservation('a'), email: email('a') })) => {
    const [row] = await runtime.$queryRaw<Array<{ result: { challenge: string; codeHash: string } | null }>>`
      SELECT synth_portal_boundary.lookup(${request.payload}, ${request.signature}) AS result`
    return row.result
  }
  const complete = async (request: { payload: string; signature: string }) => {
    const [row] = await runtime.$queryRaw<Array<{ result: unknown }>>`
      SELECT synth_portal_boundary.complete(${request.payload}, ${request.signature}) AS result`
    return row.result
  }
  const gate = () => spawnSync('psql', [runtimeUrl.toString(), '-X', '--set=ON_ERROR_STOP=1',
    '--file=scripts/security/assert-runtime.sql'], { encoding: 'utf8', timeout: 10_000 })

  before(async () => {
    assert.equal(process.env.NODE_ENV, 'test')
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(url.hostname))
    assert.equal(url.pathname, '/proximo_destino')
    url.searchParams.delete('schema')
    await owner.$connect()
    const password = randomUUID()
    await owner.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
    roleCreated = true
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${functions} TO "${role}"`)
    await owner.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION ${functions} FROM PUBLIC`)
    publicRevoked = true
    runtimeUrl = new URL(url)
    runtimeUrl.username = role
    runtimeUrl.password = password
    assert.equal(gate().status, 0, 'Runtime must pass the existing gate before the experiment')
    const setup = spawnSync('psql', [url.toString(), '-X', '--set=ON_ERROR_STOP=1',
      '--set=runtime_role=' + role, '--file=scripts/security/experimental/portal-capability-proof.sql'],
    { encoding: 'utf8', timeout: 30_000 })
    assert.equal(setup.status, 0, setup.stderr)
    fixtureCreated = true
    await owner.$executeRaw`INSERT INTO synth_portal_boundary.signing_key(singleton, key) VALUES (true, ${key})`
    hash = await argon2.hash(code, { type: argon2.argon2id })
    await owner.user.create({ data: { id: actorId, email: 'actor-' + email('a'),
      passwordHash: 'synthetic-unusable', role: 'CREATOR' } })
    for (const [index, tenant] of ['a', 'b'].entries()) {
      const companyId = companies[index]
      await owner.company.create({ data: { id: companyId, slug: slug(tenant), tradeName: 'Synthetic ' + tenant,
        contactEmail: email(tenant), responsibleName: 'Synthetic', responsibleEmail: email(tenant),
        status: 'ACTIVE', createdById: actorId } })
      await owner.client.create({ data: { id: 'client_' + reservation(tenant), companyId,
        fullName: 'Synthetic ' + tenant, email: email(tenant) } })
      await owner.trip.create({ data: { id: 'trip_' + reservation(tenant), companyId, title: 'Synthetic ' + tenant,
        origin: 'Test', destination: 'Test', departureDate: new Date(Date.now() + 86_400_000), capacity: 4, status: 'ACTIVE' } })
      await owner.reservation.create({ data: { id: reservation(tenant), companyId,
        clientId: 'client_' + reservation(tenant), tripId: 'trip_' + reservation(tenant), accessCodeHash: hash,
        companyPortalCodeExpiresAt: new Date(Date.now() + 3_600_000) } })
      await owner.seatAssignment.create({ data: { reservationId: reservation(tenant),
        tripId: 'trip_' + reservation(tenant), seatNumber: 1 } })
    }
    runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl.toString() } } })
    await runtime.$connect()
    service = new ExperimentalPortalCapability(runtime, key)
  })
  beforeEach(async () => {
    await owner.companyClientPortalSession.deleteMany({ where: { companyId: { in: companies } } })
    await owner.company.updateMany({ where: { id: { in: companies } }, data: { status: 'ACTIVE' } })
    await owner.reservation.updateMany({ where: { companyId: { in: companies } }, data: {
      accessCodeHash: hash, companyPortalFailedAttempts: 0, companyPortalLockedUntil: null,
      companyPortalCodeExpiresAt: new Date(Date.now() + 3_600_000), status: 'CONFIRMED',
    } })
  })
  after(async () => {
    await runtime?.$disconnect()
    try {
      await owner.companyClientPortalSession.deleteMany({ where: { companyId: { in: companies } } })
      await owner.seatAssignment.deleteMany({ where: { reservationId: { in: ['a', 'b'].map(reservation) } } })
      await owner.reservation.deleteMany({ where: { companyId: { in: companies } } })
      await owner.trip.deleteMany({ where: { companyId: { in: companies } } })
      await owner.client.deleteMany({ where: { companyId: { in: companies } } })
      await owner.company.deleteMany({ where: { id: { in: companies } } })
      await owner.user.deleteMany({ where: { id: actorId } })
      for (const companyId of companies) {
        await owner.authAuditEvent.deleteMany({ where: { eventType: { startsWith: 'SYNTHETIC_PORTAL_' },
          metadata: { path: ['companyId'], equals: companyId } } })
      }
      if (fixtureCreated) {
        await owner.$executeRawUnsafe('DROP SCHEMA synth_portal_boundary CASCADE')
        await owner.$executeRawUnsafe('DROP OWNED BY synth_portal_boundary')
        await owner.$executeRawUnsafe('DROP ROLE synth_portal_boundary')
      }
      if (publicRevoked) await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${functions} TO PUBLIC`)
      if (roleCreated) {
        await owner.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
    } finally { key.fill(0); await owner.$disconnect() }
  })

  it('uses a non-owner LOGIN without table access, membership or bypass', async () => {
    const [row] = await runtime.$queryRaw<Array<{ login: string; superuser: boolean; bypass: boolean; memberships: bigint }>>`
      SELECT current_user AS login, r.rolsuper AS superuser, r.rolbypassrls AS bypass,
        (SELECT count(*) FROM pg_auth_members WHERE member = r.oid) AS memberships
      FROM pg_roles r WHERE r.rolname = current_user`
    assert.equal(row.login, role); assert.equal(row.superuser, false); assert.equal(row.bypass, false)
    assert.equal(Number(row.memberships), 0)
    const [definer] = await runtime.$queryRaw<Array<{
      login: boolean; superuser: boolean; bypass: boolean; owns_tables: bigint; can_create: boolean
    }>>`SELECT r.rolcanlogin AS login, r.rolsuper AS superuser, r.rolbypassrls AS bypass,
      (SELECT count(*) FROM pg_class WHERE relowner = r.oid AND relkind IN ('r','p')) AS owns_tables,
      has_schema_privilege(r.oid, 'synth_portal_boundary', 'CREATE') AS can_create
      FROM pg_roles r WHERE r.rolname = 'synth_portal_boundary'`
    assert.equal(definer.login, false); assert.equal(definer.superuser, false)
    assert.equal(definer.bypass, false); assert.equal(Number(definer.owns_tables), 0)
    assert.equal(definer.can_create, false)
    const routines = await runtime.$queryRaw<Array<{ prosecdef: boolean; proconfig: string[]; source: string }>>`
      SELECT p.prosecdef, p.proconfig, p.prosrc AS source FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'synth_portal_boundary'`
    assert.equal(routines.filter(fn => fn.prosecdef).length, 3)
    for (const fn of routines) {
      assert.deepEqual(fn.proconfig, ['search_path=pg_catalog'])
      assert.equal(/EXECUTE\s/i.test(fn.source), false, 'No dynamic SQL')
    }
    const policies = await runtime.$queryRaw<Array<{ roles: string[]; qual: string | null; with_check: string | null }>>`
      SELECT roles, qual, with_check FROM pg_policies WHERE policyname LIKE 'synth_portal_%'`
    assert.equal(policies.length, 7)
    for (const policy of policies) {
      assert.deepEqual(policy.roles, ['synth_portal_boundary'])
      assert.notEqual(policy.qual, 'true'); assert.notEqual(policy.with_check, 'true')
    }
    for (const table of ['Company', 'Reservation', 'Client', 'Trip', 'CompanyClientPortalSession']) {
      await assert.rejects(runtime.$queryRawUnsafe(`SELECT * FROM public."${table}" LIMIT 1`),
        (error: any) => error.code === 'P2010' && error.meta?.code === '42501')
    }
    await assert.rejects(runtime.$queryRaw`SELECT * FROM synth_portal_boundary.signing_key`)
    await assert.rejects(runtime.$queryRaw`SELECT * FROM synth_portal_boundary.challenge`)
    await assert.rejects(runtime.$executeRawUnsafe('SET ROLE synth_portal_boundary'))
    await assert.rejects(runtime.$queryRaw`SELECT synth_portal_boundary.scope(${slug('b')}, ${reservation('b')})`)
  })
  it('logs in both companies with real Argon2 verification and stores only token hashes', async () => {
    for (const tenant of ['a', 'b']) {
      const session = await service.login(slug(tenant), input(tenant))
      assert.match(session.accessToken, /^[A-Za-z0-9_-]{43}$/)
      const view = await service.portal(slug(tenant), session.accessToken)
      assert.equal(view.company.slug, slug(tenant)); assert.deepEqual(view.reservation.seats, [1])
      assert.equal(view.readOnly, true)
      assert.equal(JSON.stringify(view).includes('codeHash'), false)
      const stored = await owner.companyClientPortalSession.findFirstOrThrow({ where: { reservationId: reservation(tenant) } })
      assert.equal(stored.tokenHash, createHash('sha256').update(session.accessToken).digest('hex'))
      assert.notEqual(stored.tokenHash, session.accessToken)
      assert.ok(stored.expiresAt > new Date())
    }
  })
  it('rejects wrong code, email and cross-company reservation without creating sessions', async () => {
    await assert.rejects(service.login(slug('a'), { ...input('a'), code: 'WRONG' }), unauthorized)
    await assert.rejects(service.login(slug('a'), { ...input('a'), email: email('b') }), unauthorized)
    await assert.rejects(service.login(slug('b'), input('a')), unauthorized)
    assert.equal(await owner.companyClientPortalSession.count({ where: { companyId: { in: companies } } }), 0)
  })
  it('prevents token use and logout in another company and preserves its session', async () => {
    const a = await service.login(slug('a'), input('a')), b = await service.login(slug('b'), input('b'))
    await assert.rejects(service.portal(slug('b'), a.accessToken), unauthorized)
    await assert.rejects(service.logout(slug('b'), a.accessToken), unauthorized)
    assert.deepEqual(await service.logout(slug('a'), a.accessToken), { loggedOut: true })
    await assert.rejects(service.portal(slug('a'), a.accessToken), unauthorized)
    await assert.rejects(service.logout(slug('a'), a.accessToken), unauthorized)
    assert.equal((await service.portal(slug('b'), b.accessToken)).company.slug, slug('b'))
  })
  it('serializes concurrent logins and revokes the preceding token', async () => {
    const old = await service.login(slug('a'), input('a'))
    const sessions = await Promise.all([service.login(slug('a'), input('a')), service.login(slug('a'), input('a'))])
    assert.equal(await owner.companyClientPortalSession.count({ where: { reservationId: reservation('a'), revokedAt: null } }), 1)
    await assert.rejects(service.portal(slug('a'), old.accessToken), unauthorized)
    const results = await Promise.allSettled(sessions.map(s => service.portal(slug('a'), s.accessToken)))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    for (const result of results) if (result.status === 'rejected') unauthorized(result.reason)
  })
  it('rejects expired, revoked and credential-version-invalidated sessions', async () => {
    const first = await service.login(slug('a'), input('a'))
    await owner.companyClientPortalSession.updateMany({ where: { reservationId: reservation('a') },
      data: { expiresAt: new Date(Date.now() - 60_000) } })
    await assert.rejects(service.portal(slug('a'), first.accessToken), unauthorized)
    const second = await service.login(slug('a'), input('a'))
    await owner.reservation.update({ where: { id: reservation('a') }, data: { accessCodeHash: await argon2.hash(code) } })
    await assert.rejects(service.portal(slug('a'), second.accessToken), unauthorized)
    const third = await service.login(slug('a'), input('a'))
    await owner.companyClientPortalSession.updateMany({ where: { reservationId: reservation('a') }, data: { revokedAt: new Date() } })
    await assert.rejects(service.portal(slug('a'), third.accessToken), unauthorized)
  })
  it('honors company suspension, cancelled reservation and expired access code', async () => {
    const session = await service.login(slug('a'), input('a'))
    await owner.company.update({ where: { id: companies[0] }, data: { status: 'SUSPENDED' } })
    await assert.rejects(service.portal(slug('a'), session.accessToken), unauthorized)
    await assert.rejects(service.login(slug('a'), input('a')), unauthorized)
    await owner.company.update({ where: { id: companies[0] }, data: { status: 'ACTIVE' } })
    await owner.reservation.update({ where: { id: reservation('a') }, data: { status: 'CANCELLED' } })
    await assert.rejects(service.portal(slug('a'), session.accessToken), unauthorized)
    await owner.reservation.update({ where: { id: reservation('a') }, data: { status: 'CONFIRMED',
      companyPortalCodeExpiresAt: new Date(Date.now() - 60_000) } })
    await assert.rejects(service.login(slug('a'), input('a')), unauthorized)
  })
  it('persists lockout after five failures and denies even the correct code while locked', async () => {
    for (let i = 0; i < 5; i++) await assert.rejects(service.login(slug('a'), { ...input('a'), code: 'WRONG' }), unauthorized)
    const stored = await owner.reservation.findUniqueOrThrow({ where: { id: reservation('a') } })
    assert.equal(stored.companyPortalFailedAttempts, 5)
    assert.ok(stored.companyPortalLockedUntil! > new Date())
    await assert.rejects(service.login(slug('a'), input('a')), unauthorized)
    assert.equal(await owner.companyClientPortalSession.count({ where: { reservationId: reservation('a') } }), 0)
  })
  it('rejects forged, tampered, wrong-key and expired proofs', async () => {
    const request = signed({ op: 'lookup', nonce: randomBytes(32).toString('hex'), slug: slug('a'),
      reservationId: reservation('a'), email: email('a') })
    assert.equal(await lookup({ ...request, signature: '0'.repeat(64) }), null)
    assert.equal(await lookup({ ...request, payload: request.payload.replace(slug('a'), slug('b')) }), null)
    assert.equal(await lookup(signed({ op: 'lookup', nonce: randomBytes(32).toString('hex'), slug: slug('a'),
      reservationId: reservation('a'), email: email('a'), expires: 1 })), null)
    await assert.rejects(new ExperimentalPortalCapability(runtime, randomBytes(32)).login(slug('a'), input('a')), unauthorized)
    assert.equal(await complete(signed({ op: 'complete', challenge: randomBytes(32).toString('hex'), valid: true })), null)
  })
  it('consumes a signed challenge once and rejects changed credentials before completion', async () => {
    const challenge = (await lookup())!
    const request = signed({ op: 'complete', challenge: challenge.challenge, valid: true })
    const results = await Promise.all([complete(request), complete(request)])
    assert.equal(results.filter(Boolean).length, 1)
    const stale = (await lookup())!
    await owner.reservation.update({ where: { id: reservation('a') }, data: { accessCodeHash: await argon2.hash(code) } })
    assert.equal(await complete(signed({ op: 'complete', challenge: stale.challenge, valid: true })), null)
  })
  it('rejects an unsigned verdict, duplicate lookup and expired challenge', async () => {
    const request = signed({ op: 'lookup', nonce: randomBytes(32).toString('hex'), slug: slug('a'),
      reservationId: reservation('a'), email: email('a') })
    const challenge = (await lookup(request))!
    assert.ok(challenge)
    assert.equal(await complete(request), null, 'Lookup signature cannot authorize completion')
    assert.equal(await lookup(request), null, 'Lookup proof cannot be replayed')
    const verdict = signed({ op: 'complete', challenge: challenge.challenge, valid: true })
    assert.equal(await complete({ ...verdict, signature: '0'.repeat(64) }), null,
      'A caller boolean without the backend signature is not authentication')
    await owner.$executeRaw`UPDATE synth_portal_boundary.challenge SET expires_at = now() - interval '1 minute'
      WHERE id = ${challenge.challenge}`
    assert.equal(await complete(verdict), null)
    assert.equal(await owner.companyClientPortalSession.count({ where: { reservationId: reservation('a') } }), 0)
  })
  it('serializes logout against reads and rejects all later token reuse', async () => {
    const session = await service.login(slug('a'), input('a'))
    const results = await Promise.allSettled([
      service.portal(slug('a'), session.accessToken), service.logout(slug('a'), session.accessToken),
    ])
    assert.equal(results[1].status, 'fulfilled')
    if (results[0].status === 'rejected') unauthorized(results[0].reason)
    await assert.rejects(service.portal(slug('a'), session.accessToken), unauthorized)
  })
  it('rechecks credential expiry after waiting for a session row lock', async () => {
    const session = await service.login(slug('a'), input('a'))
    const expiresAt = new Date(Date.now() + 1500)
    await owner.reservation.update({ where: { id: reservation('a') }, data: { companyPortalCodeExpiresAt: expiresAt } })
    let release!: () => void
    let held!: () => void
    const locked = new Promise<void>(resolve => { held = resolve })
    const unlock = new Promise<void>(resolve => { release = resolve })
    const blocker = owner.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM public."CompanyClientPortalSession"
        WHERE "reservationId" = ${reservation('a')} AND "revokedAt" IS NULL FOR UPDATE`
      held()
      await unlock
    }, { timeout: 5000 })
    await locked
    const pending = service.portal(slug('a'), session.accessToken).then(
      value => ({ value, error: null }), error => ({ value: null, error }),
    )
    try {
      let waiting = false
      for (let attempt = 0; attempt < 20 && !waiting; attempt++) {
        const [row] = await owner.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename = ${role}
            AND wait_event_type = 'Lock' AND state = 'active') AS waiting`
        waiting = row.waiting
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.equal(waiting, true, 'The real runtime query must actually wait for the locked session')
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 50)))
    } finally { release(); await blocker }
    const result = await pending
    assert.equal(result.value, null)
    unauthorized(result.error)
  })
  it('ignores caller-forged tenant settings and keeps direct DML denied', async () => {
    const session = await service.login(slug('a'), input('a'))
    await runtime.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('synth_portal.company', ${companies[1]}, true),
        set_config('synth_portal.reservation', ${reservation('b')}, true), set_config('synth_portal.mode', 'rotate', true)`
      const [denied] = await tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT synth_portal_boundary.session(${slug('b')}, ${session.accessToken}, true) AS result`
      assert.equal(denied.result, null)
    })
    for (const statement of [
      'UPDATE public."CompanyClientPortalSession" SET "revokedAt" = now()',
      'DELETE FROM public."CompanyClientPortalSession"',
      'INSERT INTO public."CompanyClientPortalSession" ("id") VALUES (\'forged\')',
    ]) await assert.rejects(runtime.$executeRawUnsafe(statement),
      (error: any) => error.code === 'P2010' && error.meta?.code === '42501')
    assert.equal((await service.portal(slug('a'), session.accessToken)).company.slug, slug('a'))
  })
  it('keeps experimental definers unapproved by the existing release gate', () => {
    const rejected = gate()
    assert.notEqual(rejected.status, 0, 'Prototype must not self-approve new authority in the release gate')
    assert.match(rejected.stderr, /GATE_RUNTIME:/)
  })
  it('keeps tenant integrity enforced even with a shadow temporary Reservation table', async () => {
    await assert.rejects(owner.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "Reservation" ("id" text, "companyId" text, "clientId" text, "tripId" text) ON COMMIT DROP')
      await tx.$executeRawUnsafe('SET LOCAL search_path = pg_catalog')
      await tx.$executeRaw`UPDATE public."Reservation" SET "companyId" = ${companies[1]}
        WHERE "id" = ${reservation('a')}`
    }), (error: any) => error.code === 'P2010' && error.meta?.code === '23514')
    const stored = await owner.reservation.findUniqueOrThrow({ where: { id: reservation('a') } })
    assert.equal(stored.companyId, companies[0], 'Failed scope mutation must roll back')
  })
})
