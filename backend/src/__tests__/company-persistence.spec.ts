import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CompaniesService } from '../companies/companies.service'
import { CompanyScopeService } from '../tenancy/company-scope.service'
import argon2 from 'argon2'

describe('company additive migration in isolated PostgreSQL', () => {
  const prisma = new PrismaService()
  const service = new CompaniesService(prisma)
  const scope = new CompanyScopeService(prisma)
  const suffix = randomUUID()
  const creatorId = `creator-${suffix}`
  let creatorSessionId: string
  const adminId = `company-admin-${suffix}`
  const ids: string[] = []
  const pendingIds: string[] = []
  let connected = false
  const fields = { tradeName: 'Synthetic company', slug: `synthetic-${suffix}`, contactEmail: 'contact@example.invalid',
    responsibleName: 'Synthetic responsible', responsibleEmail: 'responsible@example.invalid' }
  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test', 'Requires isolated test environment')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    await prisma.$connect(); connected = true
    await prisma.user.createMany({ data: [
      { id: creatorId, email: `${creatorId}@example.invalid`, passwordHash: 'synthetic-unusable', role: 'CREATOR', mfaEnabled: true, mfaEnrolledAt: new Date(Date.now() - 60_000) },
      { id: adminId, email: `${adminId}@example.invalid`, passwordHash: 'synthetic-unusable', role: 'ADMIN' },
    ] })
    creatorSessionId = (await prisma.authSession.create({ data: { userId: creatorId,
      refreshTokenHash: 'synthetic-unusable', expiresAt: new Date(Date.now() + 3600_000) } })).id
  })
  after(async () => {
    if (!connected) return
    try {
      await prisma.authSession.deleteMany({ where: { userId: { in: [creatorId, adminId] } } })
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: ids } } })
      await prisma.company.deleteMany({ where: { createdById: creatorId } })
      await prisma.user.deleteMany({ where: { id: { in: [creatorId, adminId, ...pendingIds] } } })
    } finally { await prisma.$disconnect() }
  })
  it('persists only a draft and leaves responsible account unprovisioned', async () => {
    const company = await service.create(creatorId, creatorSessionId, fields); ids.push(company.id)
    assert.equal(company.status, 'DRAFT')
    assert.equal(await prisma.companyMembership.count({ where: { companyId: company.id } }), 0)
    assert.equal(await prisma.user.findUnique({ where: { email: fields.responsibleEmail } }), null)
  })
  it('enforces unique slug and preserves creator on edit', async () => {
    await assert.rejects(service.create(creatorId, creatorSessionId, fields), { status: 409 })
    await service.updateDraft(creatorId, creatorSessionId, ids[0], { ...fields, tradeName: 'Synthetic revised' })
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: ids[0] } })).createdById, creatorId)
  })
  it('binds company membership through unique and foreign key constraints', async () => {
    await prisma.companyMembership.create({ data: { companyId: ids[0], userId: adminId, role: 'ADMIN' } })
    await assert.rejects(prisma.companyMembership.create({ data: { companyId: ids[0], userId: adminId, role: 'AGENT' } }), { code: 'P2002' })
    await assert.rejects(prisma.companyMembership.create({ data: { companyId: `missing-${suffix}`, userId: adminId, role: 'ADMIN' } }), { code: 'P2003' })
  })
  it('creates an inactive managed administrator with hashed password and no session', async () => {
    const password = 'synthetic-pending-password-123'
    const result = await service.createPendingAdmin(creatorId, creatorSessionId, ids[0], { displayName: 'Synthetic admin',
      email: ` PENDING-${suffix}@example.invalid `, password })
    pendingIds.push(result.user.id)
    assert.equal(result.isActive, false); assert.equal(result.user.isActive, false)
    assert.equal(result.user.email, `pending-${suffix}@example.invalid`)
    assert.equal(JSON.stringify(result).includes(password), false)
    assert.equal('passwordHash' in result.user, false)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } })
    assert.equal(user.companyManaged, true); assert.equal(user.role, 'ADMIN'); assert.equal(user.mfaEnabled, false)
    assert.ok(user.passwordHash.startsWith('$argon2id$')); assert.ok(await argon2.verify(user.passwordHash, password))
    assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 0)
    const listed = await service.admins(ids[0])
    assert.ok(listed.some(row => row.user.id === user.id))
    assert.equal(JSON.stringify(listed).includes('passwordHash'), false)
  })
  it('refuses duplicate email and never promotes an existing creator', async () => {
    const count = await prisma.companyMembership.count({ where: { companyId: ids[0] } })
    for (const email of [`${creatorId}@example.invalid`, `PENDING-${suffix}@example.invalid`]) {
      await assert.rejects(service.createPendingAdmin(creatorId, creatorSessionId, ids[0], { displayName: 'Synthetic', email,
        password: 'synthetic-pending-password-123' }), { status: 409 })
    }
    assert.equal(await prisma.companyMembership.count({ where: { companyId: ids[0] } }), count)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: creatorId } })).role, 'CREATOR')
  })
  it('rolls back account creation when membership creation fails', async () => {
    const email = `rollback-${suffix}@example.invalid`
    const failing = new CompaniesService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), user: tx.user,
        companyMembership: { create: async () => { throw new Error('synthetic rollback') } } }))
    } as unknown as PrismaService)
    await assert.rejects(failing.createPendingAdmin(creatorId, creatorSessionId, ids[0], { displayName: 'Synthetic', email,
      password: 'synthetic-pending-password-123' }), /synthetic rollback/)
    assert.equal(await prisma.user.findUnique({ where: { email } }), null)
  })
  it('audits creator writes without recording personal values or credentials', async () => {
    const events = await prisma.authAuditEvent.findMany({ where: { userId: creatorId } })
    for (const type of ['PLATFORM_COMPANY_CREATED', 'PLATFORM_COMPANY_UPDATED', 'PLATFORM_COMPANY_ADMIN_CREATED']) {
      assert.ok(events.some(event => event.eventType === type))
    }
    const serialized = JSON.stringify(events.map(event => event.metadata))
    for (const secret of [fields.contactEmail, fields.responsibleName, 'synthetic-pending-password-123', 'passwordHash']) {
      assert.equal(serialized.includes(secret), false)
    }
  })
  it('rolls back draft creation, editing and pending administrator when audit fails', async () => {
    const failing = new CompaniesService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), user: tx.user, company: tx.company,
        companyMembership: tx.companyMembership, authAuditEvent: { create: async () => { throw new Error('synthetic audit failure') } } }))
    } as unknown as PrismaService)
    const slug = `audit-rollback-${suffix}`
    await assert.rejects(failing.create(creatorId, creatorSessionId, { ...fields, slug }), /synthetic audit failure/)
    assert.equal(await prisma.company.findUnique({ where: { slug } }), null)
    const original = await prisma.company.findUniqueOrThrow({ where: { id: ids[0] } })
    await assert.rejects(failing.updateDraft(creatorId, creatorSessionId, ids[0], { ...fields, tradeName: 'Must rollback' }), /synthetic audit failure/)
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: ids[0] } })).tradeName, original.tradeName)
    const email = `audit-rollback-${suffix}@example.invalid`
    await assert.rejects(failing.createPendingAdmin(creatorId, creatorSessionId, ids[0], { displayName: 'Synthetic', email,
      password: 'synthetic-pending-password-123' }), /synthetic audit failure/)
    assert.equal(await prisma.user.findUnique({ where: { email } }), null)
  })
  it('rechecks creator authorization in every write transaction', async () => {
    const assertDenied = async () => {
      await assert.rejects(service.create(creatorId, creatorSessionId, { ...fields, slug: `denied-${suffix}` }), { status: 403 })
      await assert.rejects(service.updateDraft(creatorId, creatorSessionId, ids[0], fields), { status: 403 })
      await assert.rejects(service.createPendingAdmin(creatorId, creatorSessionId, ids[0], { displayName: 'Synthetic',
        email: `denied-${suffix}@example.invalid`, password: 'synthetic-pending-password-123' }), { status: 403 })
    }
    const session = await prisma.authSession.findUniqueOrThrow({ where: { id: creatorSessionId } })
    try {
      await prisma.authSession.update({ where: { id: creatorSessionId }, data: { revokedAt: new Date() } }); await assertDenied()
      await prisma.authSession.update({ where: { id: creatorSessionId }, data: { revokedAt: null, expiresAt: new Date(0) } }); await assertDenied()
      await prisma.authSession.update({ where: { id: creatorSessionId }, data: { expiresAt: session.expiresAt } })
      for (const data of [{ role: 'ADMIN' as const }, { isActive: false }, { mfaEnabled: false }, { mfaEnrolledAt: new Date(Date.now() + 60_000) }]) {
        await prisma.user.update({ where: { id: creatorId }, data }); await assertDenied()
        await prisma.user.update({ where: { id: creatorId }, data: { role: 'CREATOR', isActive: true, mfaEnabled: true,
          mfaEnrolledAt: new Date(session.createdAt.getTime() - 60_000) } })
      }
    } finally {
      await prisma.authSession.update({ where: { id: creatorSessionId }, data: { revokedAt: null, expiresAt: session.expiresAt } })
      await prisma.user.update({ where: { id: creatorId }, data: { role: 'CREATOR', isActive: true, mfaEnabled: true,
        mfaEnrolledAt: new Date(session.createdAt.getTime() - 60_000) } })
    }
    assert.equal(await prisma.company.findUnique({ where: { slug: `denied-${suffix}` } }), null)
    assert.equal(await prisma.user.findUnique({ where: { email: `denied-${suffix}@example.invalid` } }), null)
  })
  it('cannot edit or provision active companies through draft endpoints', async () => {
    // Synthetic database fixture only; no API activation route exists.
    await prisma.company.update({ where: { id: ids[0] }, data: { status: 'ACTIVE' } })
    await assert.rejects(service.updateDraft(creatorId, creatorSessionId, ids[0], fields), { status: 404 })
    const email = `active-refused-${suffix}@example.invalid`
    await assert.rejects(service.createPendingAdmin(creatorId, creatorSessionId, ids[0], { displayName: 'Synthetic', email,
      password: 'synthetic-pending-password-123' }), { status: 404 })
    assert.equal(await prisma.user.findUnique({ where: { email } }), null)
  })
  it('resolves persisted session company and denies another company or another user', async () => {
    const other = await service.create(creatorId, creatorSessionId, { ...fields, slug: `second-${suffix}` }); ids.push(other.id)
    await prisma.company.update({ where: { id: other.id }, data: { status: 'ACTIVE' } })
    const session = await prisma.authSession.create({ data: {
      userId: adminId, companyId: ids[0], refreshTokenHash: 'synthetic-unusable',
      expiresAt: new Date(Date.now() + 60_000),
    } })
    assert.equal((await scope.resolveSession(adminId, session.id)).companyId, ids[0])
    await assert.rejects(scope.resolveSession(creatorId, session.id), { status: 403 })
    await prisma.authSession.update({ where: { id: session.id }, data: { companyId: other.id } })
    await assert.rejects(scope.resolveSession(adminId, session.id), { status: 403 })
    await prisma.authSession.update({ where: { id: session.id }, data: { companyId: ids[0] } })
    await prisma.companyMembership.updateMany({ where: { companyId: ids[0], userId: adminId }, data: { isActive: false } })
    await assert.rejects(scope.resolveSession(adminId, session.id), { status: 403 })
    await prisma.companyMembership.updateMany({ where: { companyId: ids[0], userId: adminId }, data: { isActive: true } })
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    await assert.rejects(scope.resolveSession(adminId, session.id), { status: 403 })
  })
  it('denies expired sessions, suspended companies and role changes', async () => {
    const session = await prisma.authSession.create({ data: {
      userId: adminId, companyId: ids[0], refreshTokenHash: 'synthetic-unusable',
      expiresAt: new Date(Date.now() - 60_000),
    } })
    await assert.rejects(scope.resolveSession(adminId, session.id), { status: 403 })
    await prisma.authSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } })
    await prisma.company.update({ where: { id: ids[0] }, data: { status: 'SUSPENDED' } })
    await assert.rejects(scope.resolveSession(adminId, session.id), { status: 403 })
    await prisma.company.update({ where: { id: ids[0] }, data: { status: 'ACTIVE' } })
    await prisma.companyMembership.updateMany({ where: { companyId: ids[0], userId: adminId }, data: { role: 'AGENT' } })
    await assert.rejects(scope.resolveSession(adminId, session.id), { status: 403 })
  })
})
