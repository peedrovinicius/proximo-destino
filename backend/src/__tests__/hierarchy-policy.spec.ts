import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hierarchyAllows, type HierarchyActor, type HierarchyAction } from '../tenancy/hierarchy-policy'

const creator: HierarchyActor = { level: 'CREATOR', userId: 'creator', active: true, mfaVerified: true }
const admin: HierarchyActor = { level: 'COMPANY', userId: 'admin-a', active: true,
  companyId: 'a', companyActive: true, membershipActive: true, role: 'ADMIN' }
const client: HierarchyActor = { level: 'CLIENT', userId: 'client-user-a', active: true,
  companyId: 'a', companyActive: true, clientId: 'client-a' }
const scope = { companyId: 'a', clientId: 'client-a' }

describe('three-level hierarchy foundation (not enabled in production)', () => {
  it('creator manages companies only with active account and verified MFA', () => {
    assert.equal(hierarchyAllows(creator, 'MANAGE_COMPANIES'), true)
    assert.equal(hierarchyAllows({ ...creator, mfaVerified: false }, 'MANAGE_COMPANIES'), false)
    assert.equal(hierarchyAllows({ ...creator, active: false }, 'MANAGE_COMPANIES'), false)
    assert.equal(hierarchyAllows(creator, 'MANAGE_FINANCE', scope), false)
    assert.equal(hierarchyAllows(creator, 'VIEW_OWN_RESERVATION', scope), false)
  })
  it('company admin manages only its own company and cannot create companies', () => {
    for (const action of ['MANAGE_TEAM', 'MANAGE_INTEGRATIONS', 'MANAGE_OPERATIONS', 'MANAGE_FINANCE'] as const) {
      assert.equal(hierarchyAllows(admin, action, scope), true)
      assert.equal(hierarchyAllows(admin, action, { companyId: 'b' }), false)
      assert.equal(hierarchyAllows(admin, action), false)
    }
    assert.equal(hierarchyAllows(admin, 'MANAGE_COMPANIES'), false)
  })
  it('revoked membership or suspended company denies access', () => {
    assert.equal(hierarchyAllows({ ...admin, membershipActive: false }, 'MANAGE_TEAM', scope), false)
    assert.equal(hierarchyAllows({ ...admin, companyActive: false }, 'MANAGE_TEAM', scope), false)
    assert.equal(hierarchyAllows({ ...client, companyActive: false }, 'VIEW_OWN_RESERVATION', scope), false)
  })
  it('employees preserve role separation within their company', () => {
    const agent = { ...admin, role: 'AGENT' } as const
    const finance = { ...admin, role: 'FINANCE' } as const
    assert.equal(hierarchyAllows(agent, 'MANAGE_OPERATIONS', scope), true)
    assert.equal(hierarchyAllows(agent, 'MANAGE_FINANCE', scope), false)
    assert.equal(hierarchyAllows(finance, 'MANAGE_FINANCE', scope), true)
    assert.equal(hierarchyAllows(finance, 'MANAGE_OPERATIONS', scope), false)
    for (const actor of [agent, finance]) {
      assert.equal(hierarchyAllows(actor, 'MANAGE_TEAM', scope), false)
      assert.equal(hierarchyAllows(actor, 'MANAGE_INTEGRATIONS', scope), false)
    }
  })
  it('client must match both company and client ownership', () => {
    for (const action of ['VIEW_OWN_RESERVATION', 'EDIT_OWN_PROFILE'] as const) {
      assert.equal(hierarchyAllows(client, action, scope), true)
      assert.equal(hierarchyAllows(client, action, { companyId: 'b', clientId: 'client-a' }), false)
      assert.equal(hierarchyAllows(client, action, { companyId: 'a', clientId: 'client-b' }), false)
      assert.equal(hierarchyAllows(client, action, { companyId: 'a' }), false)
    }
    assert.equal(hierarchyAllows(client, 'MANAGE_OPERATIONS', scope), false)
  })
  it('missing actors, identifiers and unknown actions deny by default', () => {
    assert.equal(hierarchyAllows(null, 'MANAGE_COMPANIES'), false)
    assert.equal(hierarchyAllows({ ...admin, companyId: '' }, 'MANAGE_TEAM', { companyId: '' }), false)
    assert.equal(hierarchyAllows({ ...client, clientId: '' }, 'VIEW_OWN_RESERVATION', { companyId: 'a', clientId: '' }), false)
    assert.equal(hierarchyAllows(admin, 'UNKNOWN' as HierarchyAction, scope), false)
  })
})
