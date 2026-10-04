import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { readDatabaseSecurityState, restrictedAuditWriter } from '../security/database-privileges'

describe('procedimento opt-in de proteção da auditoria em PostgreSQL isolado', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().replaceAll('-', '')
  const role = `audit_runtime_${suffix}`
  const id = `audit-permission-${suffix}`
  let connected = false
  let roleCreated = false
  let database: URL

  before(async () => {
    database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test', 'Requires isolated test environment')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    database.searchParams.delete('schema')
    await prisma.$connect()
    connected = true
    // All interpolated identifiers below are derived solely from randomUUID.
    await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`)
    roleCreated = true
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await prisma.$executeRawUnsafe(`GRANT ALL ON TABLE "AuthAuditEvent" TO "${role}"`)
  })

  after(async () => {
    if (!connected) return
    try {
      await prisma.authAuditEvent.deleteMany({ where: { id } })
      if (roleCreated) {
        await prisma.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        await prisma.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
    } finally { await prisma.$disconnect() }
  })

  it('script real permite registrar/consultar e nega UPDATE, DELETE e TRUNCATE', async () => {
    const ownerState = await readDatabaseSecurityState(prisma)
    assert.equal(ownerState.canAssumeAuditOwner, true)
    assert.equal(restrictedAuditWriter(ownerState), false)
    execFileSync('psql', [database.toString(), '-X', '--set=ON_ERROR_STOP=1',
      `--set=audit_runtime_role=${role}`, '--file=scripts/security/protect-audit.sql'], { stdio: 'pipe' })
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)
      const state = await readDatabaseSecurityState(tx)
      assert.equal(restrictedAuditWriter(state), true)
      assert.ok(Object.values(state).every(value => typeof value === 'boolean'))
      await tx.$executeRaw`INSERT INTO "AuthAuditEvent" ("id", "eventType") VALUES (${id}, 'TEST_AUDIT_PROTECTION')`
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AuthAuditEvent" WHERE "id" = ${id}`
      assert.equal(rows[0].id, id)
    })
    for (const sql of [
      `UPDATE "AuthAuditEvent" SET "eventType" = 'ALTERED' WHERE "id" = '${id}'`,
      `DELETE FROM "AuthAuditEvent" WHERE "id" = '${id}'`,
      'TRUNCATE TABLE "AuthAuditEvent"',
    ]) {
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)
        await tx.$executeRawUnsafe(sql)
      }), /permission denied/)
    }
    assert.equal((await prisma.authAuditEvent.findUniqueOrThrow({ where: { id } })).eventType, 'TEST_AUDIT_PROTECTION')
    await prisma.$executeRawUnsafe(`GRANT UPDATE ON TABLE "AuthAuditEvent" TO "${role}"`)
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)
      const state = await readDatabaseSecurityState(tx)
      assert.equal(state.canUpdateAudit, true)
      assert.equal(restrictedAuditWriter(state), false)
    })
    await prisma.$executeRawUnsafe(`REVOKE UPDATE ON TABLE "AuthAuditEvent" FROM "${role}"`)
  })

  it('recusa um proprietário e um papel inexistente antes de alterar permissões', async () => {
    const [owner] = await prisma.$queryRaw<Array<{ owner: string }>>`
      SELECT pg_get_userbyid(c.relowner) AS "owner" FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'AuthAuditEvent'
    `
    for (const target of [owner.owner, `missing_${suffix}`]) {
      assert.throws(() => execFileSync('psql', [database.toString(), '-X', '--set=ON_ERROR_STOP=1',
        `--set=audit_runtime_role=${target}`, '--file=scripts/security/protect-audit.sql'], { stdio: 'pipe' }))
    }
  })
})
