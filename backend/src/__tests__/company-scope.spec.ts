import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CompanyScopeService } from '../tenancy/company-scope.service'
import type { PrismaService } from '../prisma/prisma.service'

const baseline = () => ({ id: 'session-a', userId: 'user-a', companyId: 'company-a',
  user: { role: 'ADMIN', isActive: true }, company: {
    id: 'company-a', status: 'ACTIVE', memberships: [{ role: 'ADMIN' }],
  } })

describe('server resolved company scope (not yet enabled on operations)', () => {
  type ScopeQuery = { where: { id: string; userId: string; revokedAt: null; expiresAt: { gt: Date } };
    select: { company: { select: { memberships: { where: { userId: string; isActive: boolean } } } } } }
  function service(record: unknown, onQuery?: (query: ScopeQuery) => void) {
    return new CompanyScopeService({ authSession: { findFirst: async (query: unknown) => {
      onQuery?.(query as ScopeQuery); return record
    } } } as unknown as PrismaService)
  }
  it('uses persisted company, current user and active membership, returning immutable scope', async () => {
    const scope = await service(baseline(), query => {
      assert.equal(query.where.id, 'session-a'); assert.equal(query.where.userId, 'user-a')
      assert.equal(query.where.revokedAt, null); assert.ok(query.where.expiresAt.gt instanceof Date)
      assert.deepEqual(query.select.company.select.memberships.where, { userId: 'user-a', isActive: true })
    }).resolveSession('user-a', 'session-a')
    assert.deepEqual(scope, { companyId: 'company-a', userId: 'user-a', sessionId: 'session-a', role: 'ADMIN' })
    assert.equal(Object.isFrozen(scope), true)
  })
  it('rejects absent identifiers before any database read', async () => {
    const scoped = service(baseline(), () => assert.fail('must not read'))
    await assert.rejects(scoped.resolveSession('', 'session-a'), { status: 403 })
    await assert.rejects(scoped.resolveSession('user-a', ' '), { status: 403 })
  })
  it('rejects expired, revoked, foreign or missing sessions and unassigned legacy sessions', async () => {
    await assert.rejects(service(null).resolveSession('user-a', 'session-a'), { status: 403 })
    await assert.rejects(service({ ...baseline(), companyId: null, company: null }).resolveSession('user-a', 'session-a'), { status: 403 })
  })
  for (const status of ['DRAFT', 'SUSPENDED']) {
    it(`rejects ${status} companies`, async () => {
      const record = baseline(); record.company.status = status
      await assert.rejects(service(record).resolveSession('user-a', 'session-a'), { status: 403 })
    })
  }
  it('rejects inactive users and revoked or ambiguous memberships', async () => {
    const inactive = baseline(); inactive.user.isActive = false
    await assert.rejects(service(inactive).resolveSession('user-a', 'session-a'), { status: 403 })
    for (const memberships of [[], [{ role: 'ADMIN' }, { role: 'ADMIN' }]]) {
      const record = baseline(); record.company.memberships = memberships
      await assert.rejects(service(record).resolveSession('user-a', 'session-a'), { status: 403 })
    }
  })
  for (const role of ['CREATOR', 'CLIENT']) {
    it(`never turns ${role} into a company operator`, async () => {
      const record = baseline(); record.user.role = role; record.company.memberships = [{ role }]
      await assert.rejects(service(record).resolveSession('user-a', 'session-a'), { status: 403 })
    })
  }
  it('rejects mismatched role and inconsistent company references', async () => {
    const record = baseline(); record.company.memberships[0].role = 'AGENT'
    await assert.rejects(service(record).resolveSession('user-a', 'session-a'), { status: 403 })
    const cross = baseline(); cross.company.id = 'company-b'
    await assert.rejects(service(cross).resolveSession('user-a', 'session-a'), { status: 403 })
  })
  for (const role of ['ADMIN', 'AGENT', 'FINANCE']) {
    it(`preserves ${role} without privilege escalation`, async () => {
      const record = baseline(); record.user.role = role; record.company.memberships[0].role = role
      assert.equal((await service(record).resolveSession('user-a', 'session-a')).role, role)
    })
  }
})
