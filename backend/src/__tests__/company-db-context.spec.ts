import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService, type VerifiedCompanyScope } from '../tenancy/company-scope.service'
import { lockCompanyRead, lockCompanyWrite } from '../tenancy/company-write-lock'

describe('transaction-local company database context', () => {
  const prisma = new PrismaService()
  const scopes = new CompanyScopeService(prisma)
  const suffix = randomUUID()
  const ownerId = `ctx-owner-${suffix}`
  const userA = `ctx-user-a-${suffix}`
  const userB = `ctx-user-b-${suffix}`
  const companyA = `ctx-company-a-${suffix}`
  const companyB = `ctx-company-b-${suffix}`
  const sessionA = `ctx-session-a-${suffix}`
  const sessionB = `ctx-session-b-${suffix}`
  let connected = false

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname),
      'Requires isolated database')
    await prisma.$connect()
    connected = true
    await prisma.user.createMany({ data: [
      { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic', role: 'CREATOR' },
      { id: userA, email: `${userA}@example.invalid`, passwordHash: 'synthetic', role: 'ADMIN' },
      { id: userB, email: `${userB}@example.invalid`, passwordHash: 'synthetic', role: 'ADMIN' },
    ] })
    for (const [companyId, userId, sessionId] of [[companyA, userA, sessionA], [companyB, userB, sessionB]] as const) {
      await prisma.company.create({ data: { id: companyId, slug: companyId, tradeName: companyId,
        contactEmail: 'contact@example.invalid', responsibleName: 'Synthetic',
        responsibleEmail: 'responsible@example.invalid', status: 'ACTIVE', createdById: ownerId } })
      await prisma.companyMembership.create({ data: { companyId, userId, role: 'ADMIN' } })
      await prisma.authSession.create({ data: { id: sessionId, companyId, userId,
        refreshTokenHash: 'synthetic', expiresAt: new Date(Date.now() + 300_000) } })
    }
  })

  after(async () => {
    if (!connected) return
    try {
      await prisma.authSession.deleteMany({ where: { id: { in: [sessionA, sessionB] } } })
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: [companyA, companyB] } } })
      await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } })
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, userA, userB] } } })
    } finally {
      await prisma.$disconnect()
    }
  })

  const readContext = (tx: Prisma.TransactionClient) => tx.$queryRaw<Array<{
    companyId: string | null; userId: string | null; sessionId: string | null
  }>>`SELECT NULLIF(current_setting('app.company_id', true), '') AS "companyId",
      NULLIF(current_setting('app.user_id', true), '') AS "userId",
      NULLIF(current_setting('app.session_id', true), '') AS "sessionId"`

  it('installs company, user and session only after persisted scope revalidation', async () => {
    const scope = await scopes.resolveSession(userA, sessionA)
    await prisma.$transaction(async tx => {
      const [before] = await readContext(tx)
      assert.deepEqual(before, { companyId: null, userId: null, sessionId: null })
      await lockCompanyRead(tx, scope)
      const [afterRead] = await readContext(tx)
      assert.deepEqual(afterRead, { companyId: companyA, userId: userA, sessionId: sessionA })
    })
    await prisma.$transaction(async tx => {
      const [reset] = await readContext(tx)
      assert.deepEqual(reset, { companyId: null, userId: null, sessionId: null })
    })
  })

  it('rejects a forged company/session combination before setting database context', async () => {
    const valid = await scopes.resolveSession(userA, sessionA)
    const forged = Object.freeze({ ...valid, companyId: companyB }) as VerifiedCompanyScope
    await prisma.$transaction(async tx => {
      await assert.rejects(lockCompanyRead(tx, forged), { status: 403 })
      const [context] = await readContext(tx)
      assert.deepEqual(context, { companyId: null, userId: null, sessionId: null })
    })
  })

  it('write lock installs the same verified context and revocation fails closed', async () => {
    const scope = await scopes.resolveSession(userA, sessionA)
    await prisma.$transaction(async tx => {
      await lockCompanyWrite(tx, scope)
      const [context] = await readContext(tx)
      assert.deepEqual(context, { companyId: companyA, userId: userA, sessionId: sessionA })
    })
    await prisma.companyMembership.updateMany({ where: { companyId: companyA, userId: userA },
      data: { isActive: false } })
    try {
      await prisma.$transaction(async tx => {
        await assert.rejects(lockCompanyRead(tx, scope), { status: 403 })
        const [context] = await readContext(tx)
        assert.deepEqual(context, { companyId: null, userId: null, sessionId: null })
      })
    } finally {
      await prisma.companyMembership.updateMany({ where: { companyId: companyA, userId: userA },
        data: { isActive: true } })
    }
  })
})
