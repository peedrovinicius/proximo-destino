import assert from 'node:assert/strict'
import { it } from 'node:test'
import { HTTP_REHEARSAL_HOST, HTTP_REHEARSAL_EXPIRES, assertHttpRehearsalTarget } from '../security/http-rehearsal-target'

const valid = () => new URL(`postgresql://neondb_owner:synthetic@${HTTP_REHEARSAL_HOST}/validation_pr34_http_${'a'.repeat(24)}?sslmode=require`)
it('permits only the connector-verified temporary endpoint and synthetic database before expiration', () => {
  assert.doesNotThrow(() => assertHttpRehearsalTarget(valid(), HTTP_REHEARSAL_EXPIRES - 1))
  const standardNeon = valid(); standardNeon.searchParams.set('channel_binding', 'require')
  assert.doesNotThrow(() => assertHttpRehearsalTarget(standardNeon, HTTP_REHEARSAL_EXPIRES - 1))
  assert.throws(() => assertHttpRehearsalTarget(valid(), HTTP_REHEARSAL_EXPIRES))
  for (const change of [
    (u: URL) => { u.hostname = 'production.example.invalid' },
    (u: URL) => { u.pathname = '/neondb' },
    (u: URL) => { u.pathname = '/customer_database' },
    (u: URL) => { u.username = 'another_owner' },
    (u: URL) => { u.password = '' },
    (u: URL) => { u.searchParams.set('sslmode', 'disable') },
    (u: URL) => { u.searchParams.append('sslmode', 'disable') },
    (u: URL) => { u.searchParams.set('channel_binding', 'disable') },
    (u: URL) => { u.searchParams.set('options', '-c role=neon_superuser') },
    (u: URL) => { u.searchParams.set('host', 'production.example.invalid') },
    (u: URL) => { u.searchParams.set('schema', 'private') },
    (u: URL) => { u.port = '443' },
  ]) {
    const candidate = valid(); change(candidate)
    assert.throws(() => assertHttpRehearsalTarget(candidate, HTTP_REHEARSAL_EXPIRES - 1))
  }
})
