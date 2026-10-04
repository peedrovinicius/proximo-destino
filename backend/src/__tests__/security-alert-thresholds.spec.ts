import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { securityAlertSeed } from '../notifications/security-alerts'

describe('limiares dos alertas internos de autenticação', () => {
  const start = Date.UTC(2026, 9, 4, 12)
  it('não alerta abaixo dos limiares ou em eventos normais', () => {
    assert.equal(securityAlertSeed(start, []), null)
    assert.equal(securityAlertSeed(start, [
      { eventType: 'LOGIN_FAILED', count: 9 }, { eventType: 'MFA_FAILED', count: 7 },
      { eventType: 'LOGIN_ROLE_DENIED', count: 4 }, { eventType: 'LOGIN_SUCCESS', count: 100 },
    ]), null)
  })
  it('alerta em cada limiar sem incluir identificadores ou hashes', () => {
    for (const [eventType, count] of [['LOGIN_FAILED', 10], ['LOGIN_LOCKED', 1], ['MFA_FAILED', 8], ['LOGIN_ROLE_DENIED', 5]] as const) {
      const seed = securityAlertSeed(start, [{ eventType, count }])
      assert.ok(seed)
      assert.equal(seed.actionTab, 'audit')
      assert.equal(seed.sourceKey, `security-auth:${start}`)
      assert.equal(Object.keys(seed).length, 5)
      assert.ok(!/email|ipHash|userId|token|password/i.test(seed.message))
    }
  })
})
