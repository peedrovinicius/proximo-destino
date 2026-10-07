import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { readDatabaseSecurityState, restrictedAuditWriter } from '../security/database-privileges'

describe('papel runtime sem bypass em PostgreSQL isolado', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().replaceAll('-', '')
  const role = `runtime_${suffix}`
  const outsider = `outsider_${suffix}`
  const policy = `api_runtime_${createHash('md5').update(role).digest('hex')}`
  let connected = false
  const created: string[] = []
  let database: URL
  const run = (target: string) => execFileSync('psql', [database.toString(), '-X', '--set=ON_ERROR_STOP=1',
    `--set=runtime_role=${target}`, '--file=scripts/security/rehearse-runtime.sql'], { stdio: 'pipe' })

  before(async () => {
    database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    database.searchParams.delete('schema')
    await prisma.$connect()
    connected = true
    for (const name of [role, outsider]) {
      await prisma.$executeRawUnsafe(`CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`)
      created.push(name)
    }
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${outsider}"`)
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT ON "Client" TO "${outsider}"`)
    run(role)
  })

  after(async () => {
    if (!connected) return
    try {
      const policies = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname=${policy}
      `
      for (const row of policies) {
        // Table identifier originates from PostgreSQL; double quotes are escaped.
        await prisma.$executeRawUnsafe(`DROP POLICY "${policy}" ON public."${row.tablename.replaceAll('"', '""')}"`)
      }
      for (const name of created.reverse()) {
        await prisma.$executeRawUnsafe(`DROP OWNED BY "${name}"`)
        await prisma.$executeRawUnsafe(`DROP ROLE "${name}"`)
      }
    } finally { await prisma.$disconnect() }
  })

  it('permite clientes e auditoria sem ownership ou BYPASSRLS e mantém outro papel bloqueado', async () => {
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)
      assert.equal(restrictedAuditWriter(await readDatabaseSecurityState(tx)), true)
      const client = await tx.client.create({ data: { fullName: 'Synthetic runtime rehearsal' } })
      await tx.client.update({ where: { id: client.id }, data: { notes: 'synthetic' } })
      assert.equal((await tx.client.findUniqueOrThrow({ where: { id: client.id } })).notes, 'synthetic')
      await tx.authAuditEvent.create({ data: { eventType: 'SYNTHETIC_RUNTIME_REHEARSAL' } })
      throw new Error('ROLLBACK_SYNTHETIC_REHEARSAL')
    }), /ROLLBACK_SYNTHETIC_REHEARSAL/)
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${outsider}"`)
      assert.equal(await tx.client.count(), 0)
    })
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${outsider}"`)
      await tx.client.create({ data: { fullName: 'Denied synthetic client' } })
    }), /row-level security/)
  })

  it('nega edição da auditoria, exclusão de usuários, migrations, DDL e poderes de proprietário', async () => {
    for (const sql of [
      'UPDATE "AuthAuditEvent" SET "eventType" = \'ALTERED\' WHERE false',
      'DELETE FROM "AuthAuditEvent" WHERE false', 'TRUNCATE "AuthAuditEvent"',
      'DELETE FROM "User" WHERE false', 'SELECT * FROM "_prisma_migrations"',
      `CREATE TABLE public."runtime_probe_${suffix}" (id integer)`,
      'ALTER TABLE "Client" DISABLE ROW LEVEL SECURITY', 'DROP TABLE "Client"',
    ]) {
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)
        await tx.$executeRawUnsafe(sql)
      }), /permission denied|must be owner/)
    }
    const [state] = await prisma.$queryRaw<Array<{ allRls: boolean }>>`
      SELECT bool_and(c.relrowsecurity) AS "allRls" FROM pg_class c
      JOIN pg_policy p ON p.polrelid=c.oid WHERE p.polname=${policy}
    `
    assert.equal(state.allRls, true)
  })

  it('recusa o proprietário e papel com login, revertendo sem conceder acesso', async () => {
    const [owner] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_user AS name`
    assert.throws(() => run(owner.name))
    await prisma.$executeRawUnsafe(`ALTER ROLE "${outsider}" LOGIN`)
    assert.throws(() => run(outsider))
    const [privilege] = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
      SELECT has_table_privilege(${outsider}, 'public."User"', 'INSERT') AS allowed
    `
    assert.equal(privilege.allowed, false)
  })
  it('diagnóstico somente leitura distingue papel restrito e proprietário sem conceder permissões', async () => {
    const check = (target?: string) => execFileSync('psql', [database.toString(), '-X', '-A', '-t',
      '--set=ON_ERROR_STOP=1', ...(target ? [`--command=SET ROLE "${target}"`] : []),
      '--file=scripts/security/check-runtime.sql'], { encoding: 'utf8', stdio: 'pipe' })
    const restricted = check(role)
    assert.ok(restricted.split('\n').includes('t|f|t|t|t|t|t|t'), restricted)
    assert.ok(restricted.split('\n').includes('13'), restricted)
    const owner = check()
    assert.equal(owner.split('\n').includes('t|f|t|t|t|t|t|t'), false)
    const [access] = await prisma.$queryRaw<Array<{ forbidden: boolean }>>`
      SELECT has_table_privilege(${role}, 'public."AuthAuditEvent"', 'UPDATE') AS forbidden`
    assert.equal(access.forbidden, false)
  })
  const productionGate = () => spawnSync('psql',
    [database.toString(), '-X', '--set=ON_ERROR_STOP=1',
      `--command=SET ROLE "${role}"`, '--file=scripts/security/assert-runtime.sql'],
    { encoding: 'utf8' })

  it('bloqueia produção se Trip perder RLS mesmo após a migração', async () => {
    // Never alter production; this suite uses a disposable local test database.
    await prisma.$executeRawUnsafe('ALTER TABLE "Trip" DISABLE ROW LEVEL SECURITY')
    try {
      const gate = productionGate()
      assert.equal(gate.status, 3, gate.stderr)
      assert.match(gate.stderr, /GATE_RUNTIME: tabela sensivel sem RLS/)
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Trip" ENABLE ROW LEVEL SECURITY')
    }
  })

  it('rejeita políticas RLS permissivas do papel de ensaio', () => {
    const gate = productionGate()
    assert.equal(gate.status, 3, gate.stderr)
    assert.match(gate.stderr, /GATE_RUNTIME: politica RLS permissiva para tabela sensivel/)
  })
})
