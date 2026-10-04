import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UserRole } from '@prisma/client'
import { AdminCommercialController } from '../commercial/commercial.controller'
import { ROLES_KEY } from '../auth/roles.decorator'

function rolesFor(
  method: keyof AdminCommercialController,
): UserRole[] {
  const handler = AdminCommercialController.prototype[method]
  return Reflect.getMetadata(ROLES_KEY, handler) ?? []
}

describe('permissoes das rotas comerciais', () => {
  it('mantem cotacoes e servicos restritos ao operacional', () => {
    const quoteRoles = rolesFor('listQuotes')
    const serviceRoles = rolesFor('listServices')

    assert.equal(new Set<UserRole>(quoteRoles).has(UserRole.FINANCE), false)
    assert.equal(new Set<UserRole>(serviceRoles).has(UserRole.FINANCE), false)
    assert.deepEqual(quoteRoles, [UserRole.ADMIN, UserRole.AGENT])
    assert.deepEqual(serviceRoles, [UserRole.ADMIN, UserRole.AGENT])
  })

  it('mantem planos financeiros restritos a admin e financeiro', () => {
    const roles = rolesFor('listFinancePlans')

    assert.equal(new Set<UserRole>(roles).has(UserRole.AGENT), false)
    assert.deepEqual(roles, [UserRole.ADMIN, UserRole.FINANCE])
  })
})
