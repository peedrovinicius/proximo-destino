import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CompaniesService } from '../companies/companies.service'
import { CompanyScopeService } from '../tenancy/company-scope.service'
import argon2 from 'argon2'
import { ConfigService } from '@nestjs/config'
import { MfaService } from '../auth/mfa.service'
import { CompanyInvitationsService } from '../companies/company-invitations.service'

describe('company additive migration in isolated PostgreSQL', () => {
  const prisma = new PrismaService()
  const service = new CompaniesService(prisma)
  const mfa = new MfaService(prisma, new ConfigService({ MFA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64') }))
  const invites = new CompanyInvitationsService(prisma, mfa)
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
  async function pendingInvite() {
    const admin = await service.createPendingAdmin(creatorId, creatorSessionId, ids[0], {
      displayName: 'Synthetic invitee', email: `invite-${randomUUID()}@example.invalid`, password: 'synthetic-initial-password-123',
    })
    pendingIds.push(admin.user.id)
    return admin
  }
  it('issues only hashed expiring invites and consumes them exactly once under concurrency', async () => {
    const admin = await pendingInvite()
    const invite = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    assert.equal(invite.token.length, 43); assert.equal(invite.activationAllowed, false)
    const stored = await prisma.companyMembership.findUniqueOrThrow({ where: { id: admin.id } })
    assert.notEqual(stored.inviteTokenHash, invite.token); assert.equal(stored.inviteTokenHash?.length, 64)
    assert.ok(stored.inviteExpiresAt!.getTime() > Date.now())
    const password = 'synthetic-invite-password-123'
    const results = await Promise.allSettled([invites.accept(invite.token, password), invites.accept(invite.token, password)])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(results.filter(r => r.status === 'rejected').length, 1)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })
    assert.equal(user.isActive, false); assert.ok(await argon2.verify(user.passwordHash, password))
    const used = await prisma.companyMembership.findUniqueOrThrow({ where: { id: admin.id } })
    assert.ok(used.inviteUsedAt); assert.equal(used.inviteTokenHash, null); assert.equal(used.isActive, false)
    assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 0)
    await assert.rejects(invites.issue(creatorId, creatorSessionId, ids[0], admin.id), { status: 404 })
    await assert.rejects(invites.accept(invite.token, password), { status: 400 })
    const events = await prisma.authAuditEvent.findMany({ where: { eventType: { startsWith: 'PLATFORM_ADMIN_INVITE_' },
      metadata: { path: ['membershipId'], equals: admin.id } } })
    assert.equal(events.filter(e => e.eventType === 'PLATFORM_ADMIN_INVITE_ACCEPTED').length, 1)
    const metadata = JSON.stringify(events.map(e => e.metadata))
    for (const secret of [invite.token, stored.inviteTokenHash!, password, admin.user.email]) assert.equal(metadata.includes(secret), false)
  })
  it('rejects expired, replaced, revoked and foreign-company invites', async () => {
    const admin = await pendingInvite()
    const first = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    const second = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    await assert.rejects(invites.accept(first.token, 'synthetic-new-password-123'), { status: 400 })
    await prisma.companyMembership.update({ where: { id: admin.id }, data: { inviteExpiresAt: new Date(0) } })
    await assert.rejects(invites.accept(second.token, 'synthetic-new-password-123'), { status: 400 })
    const third = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    await invites.revoke(creatorId, creatorSessionId, ids[0], admin.id)
    await assert.rejects(invites.accept(third.token, 'synthetic-new-password-123'), { status: 400 })
    for (const method of ['issue', 'revoke'] as const) {
      await assert.rejects(invites[method](creatorId, creatorSessionId, 'foreign-company', admin.id), { status: 404 })
      await assert.rejects(invites[method](creatorId, 'revoked-session', ids[0], admin.id), { status: 403 })
    }
    await assert.rejects(invites.accept('invalid', 'synthetic-new-password-123'), { status: 400 })
    await assert.rejects(invites.accept('a'.repeat(43), 'short'), { status: 400 })
  })
  it('refuses invite acceptance when the company, account or membership is no longer pending', async () => {
    const admin = await pendingInvite()
    const invite = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    const password = 'synthetic-new-password-123'
    const original = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })
    try {
      await prisma.company.update({ where: { id: ids[0] }, data: { status: 'ACTIVE' } })
      await assert.rejects(invites.accept(invite.token, password), { status: 400 })
      await prisma.company.update({ where: { id: ids[0] }, data: { status: 'DRAFT' } })
      await prisma.companyMembership.update({ where: { id: admin.id }, data: { isActive: true } })
      await assert.rejects(invites.accept(invite.token, password), { status: 400 })
      await prisma.companyMembership.update({ where: { id: admin.id }, data: { isActive: false } })
      for (const data of [{ isActive: true }, { role: 'AGENT' as const }, { mfaEnabled: true }]) {
        await prisma.user.update({ where: { id: admin.user.id }, data })
        await assert.rejects(invites.accept(invite.token, password), { status: 400 })
        await prisma.user.update({ where: { id: admin.user.id }, data: { isActive: false, role: 'ADMIN', mfaEnabled: false } })
      }
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).passwordHash, original.passwordHash)
      assert.equal((await prisma.companyMembership.findUniqueOrThrow({ where: { id: admin.id } })).inviteUsedAt, null)
    } finally {
      await prisma.company.update({ where: { id: ids[0] }, data: { status: 'DRAFT' } })
      await prisma.companyMembership.update({ where: { id: admin.id }, data: { isActive: false } })
      await prisma.user.update({ where: { id: admin.user.id }, data: { isActive: false, role: 'ADMIN', mfaEnabled: false } })
    }
  })
  it('rolls back invite issue, revoke and acceptance when auditing fails', async () => {
    const admin = await pendingInvite()
    const failing = new CompanyInvitationsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), user: tx.user, companyMembership: tx.companyMembership,
        authAuditEvent: { create: async () => { throw new Error('synthetic invite audit failure') } } }))
    } as unknown as PrismaService, mfa)
    await assert.rejects(failing.issue(creatorId, creatorSessionId, ids[0], admin.id), /synthetic invite audit failure/)
    assert.equal((await prisma.companyMembership.findUniqueOrThrow({ where: { id: admin.id } })).inviteTokenHash, null)
    const invite = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    const before = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })
    await assert.rejects(failing.revoke(creatorId, creatorSessionId, ids[0], admin.id), /synthetic invite audit failure/)
    await assert.rejects(failing.accept(invite.token, 'synthetic-new-password-123'), /synthetic invite audit failure/)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).passwordHash, before.passwordHash)
    assert.equal((await prisma.companyMembership.findUniqueOrThrow({ where: { id: admin.id } })).inviteUsedAt, null)
    assert.equal((await invites.accept(invite.token, 'synthetic-new-password-123')).activationAllowed, false)
  })
  const totp = (secret: string, offset = 0) => (mfa as unknown as { totp(secret: string, counter: number): string })
    .totp(secret, Math.floor(Date.now() / 30_000) + offset)

  it('prepares MFA once with encrypted secrets and hashed recovery codes while keeping access inactive', async () => {
    const admin = await pendingInvite()
    const invite = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    const accepted = await invites.accept(invite.token, 'synthetic-new-password-123')
    const setup = await invites.beginMfa(accepted.onboardingToken)
    assert.ok(setup.qrDataUrl.startsWith('data:image/png;base64,'))
    assert.equal(setup.activationAllowed, false)
    const secretRow = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })
    assert.ok(secretRow.mfaPendingSecretEncrypted); assert.notEqual(secretRow.mfaPendingSecretEncrypted, setup.manualKey)
    const results = await Promise.allSettled([
      invites.confirmMfa(accepted.onboardingToken, totp(setup.manualKey)),
      invites.confirmMfa(accepted.onboardingToken, totp(setup.manualKey)),
    ])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    const success = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ recoveryCodes: string[]; activationAllowed: boolean }>
    assert.equal(success.value.activationAllowed, false); assert.equal(success.value.recoveryCodes.length, 10)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })
    assert.equal(user.mfaEnabled, true); assert.ok(user.mfaEnrolledAt); assert.equal(user.isActive, false)
    assert.equal(user.mfaPendingSecretEncrypted, null); assert.notEqual(user.mfaSecretEncrypted, setup.manualKey)
    const readiness = await service.readiness(ids[0])
    assert.ok(readiness.administrators.preparedWithMfa >= 1); assert.equal(readiness.activationAllowed, false)
    assert.equal(readiness.blockers.includes('SECURE_ADMIN_ONBOARDING_REQUIRED'), false)
    const membership = await prisma.companyMembership.findUniqueOrThrow({ where: { id: admin.id } })
    assert.equal(membership.isActive, false); assert.equal(membership.onboardingTokenHash, null)
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: ids[0] } })).status, 'DRAFT')
    assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 0)
    const recovery = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } })
    assert.equal(recovery.length, 10); assert.ok(recovery.every(row => row.codeHash.startsWith('$argon2')))
    await assert.rejects(invites.beginMfa(accepted.onboardingToken), { status: 400 })
    await assert.rejects(invites.confirmMfa(accepted.onboardingToken, totp(setup.manualKey)), { status: 400 })
    await assert.rejects(invites.resume(admin.user.email, 'synthetic-new-password-123'), { status: 401 })
    assert.equal(await mfa.verify(user.id, success.value.recoveryCodes[0]), true)
    assert.equal(await mfa.verify(user.id, success.value.recoveryCodes[0]), false)
    const events = await prisma.authAuditEvent.findMany({ where: { userId: user.id } })
    const serialized = JSON.stringify(events.map(event => event.metadata))
    for (const secret of [accepted.onboardingToken, setup.manualKey, ...success.value.recoveryCodes]) assert.equal(serialized.includes(secret), false)
  })
  it('expires and replaces onboarding tokens and limits password and TOTP attempts', async () => {
    const admin = await pendingInvite()
    const invite = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    const accepted = await invites.accept(invite.token, 'synthetic-new-password-123')
    await prisma.companyMembership.update({ where: { id: admin.id }, data: { onboardingExpiresAt: new Date(0) } })
    await assert.rejects(invites.beginMfa(accepted.onboardingToken), { status: 400 })
    const resumed = await invites.resume(admin.user.email.toUpperCase(), 'synthetic-new-password-123')
    await assert.rejects(invites.beginMfa(accepted.onboardingToken), { status: 400 })
    const setup = await invites.beginMfa(resumed.onboardingToken)
    const valid = [-1, 0, 1].map(offset => totp(setup.manualKey, offset))
    const bad = ['000000', '000001', '000002', '000003'].find(code => !valid.includes(code))!
    for (let n = 0; n < 5; n++) await assert.rejects(invites.confirmMfa(resumed.onboardingToken, bad), { status: 401 })
    await assert.rejects(invites.beginMfa(resumed.onboardingToken), { status: 400 })
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).mfaPendingSecretEncrypted, null)
    for (let n = 0; n < 5; n++) await assert.rejects(invites.resume(admin.user.email, 'synthetic-incorrect-password'), { status: 401 })
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })
    assert.ok(locked.lockedUntil!.getTime() > Date.now())
    await assert.rejects(invites.resume(admin.user.email, 'synthetic-new-password-123'), { status: 401 })
    await prisma.user.update({ where: { id: admin.user.id }, data: { lockedUntil: new Date(0) } })
    const fresh = await invites.resume(admin.user.email, 'synthetic-new-password-123')
    await invites.beginMfa(fresh.onboardingToken)
    await invites.revoke(creatorId, creatorSessionId, ids[0], admin.id)
    await assert.rejects(invites.beginMfa(fresh.onboardingToken), { status: 400 })
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).isActive, false)
  })
  it('rolls back MFA enrollment, recovery codes and token consumption when audit fails', async () => {
    const admin = await pendingInvite()
    const invite = await invites.issue(creatorId, creatorSessionId, ids[0], admin.id)
    const accepted = await invites.accept(invite.token, 'synthetic-new-password-123')
    const failing = new CompanyInvitationsService({ $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(tx => callback({ $queryRaw: tx.$queryRaw.bind(tx), user: tx.user,
        companyMembership: tx.companyMembership, mfaRecoveryCode: tx.mfaRecoveryCode,
        authAuditEvent: { create: async () => { throw new Error('synthetic onboarding audit failure') } } }))
    } as unknown as PrismaService, mfa)
    await assert.rejects(failing.beginMfa(accepted.onboardingToken), /synthetic onboarding audit failure/)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).mfaPendingSecretEncrypted, null)
    const setup = await invites.beginMfa(accepted.onboardingToken)
    await assert.rejects(failing.confirmMfa(accepted.onboardingToken, totp(setup.manualKey)), /synthetic onboarding audit failure/)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).mfaEnabled, false)
    assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: admin.user.id } }), 0)
    assert.equal((await invites.confirmMfa(accepted.onboardingToken, totp(setup.manualKey))).mfaConfigured, true)
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
