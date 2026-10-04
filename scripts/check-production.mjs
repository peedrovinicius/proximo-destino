// Read-only checks: no credentials, reservations, payments or database writes.
const api = 'https://proximo-destino-api-production.up.railway.app/api/v1'
const web = 'https://proximo-destino-web-production.up.railway.app/'
let failures = 0
async function check(name, url, validate) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' })
    await validate(response)
    console.log(`PASS ${name}`)
  } catch {
    failures++
    console.error(`FAIL ${name}`)
  }
}
function assert(condition) {
  if (!condition) throw new Error('Check failed')
}
await check('API and database readiness', `${api}/readiness`, async (response) => {
  assert(response.status === 200)
  const body = await response.json()
  assert(body.status === 'ready' && body.database === 'ok')
})
await check('Frontend and security headers', web, async (response) => {
  assert(response.status === 200)
  assert(response.headers.get('content-type')?.includes('text/html'))
  assert(response.headers.get('x-content-type-options') === 'nosniff')
  assert(response.headers.get('x-frame-options') === 'DENY')
  assert(/max-age=[1-9][0-9]*/i.test(response.headers.get('strict-transport-security') ?? ''))
  assert(/frame-ancestors\s+'none'/i.test(response.headers.get('content-security-policy') ?? ''))
  assert((await response.text()).includes('id="root"'))
})
for (const path of ['/admin/clients', '/admin/reservations', '/admin/documents/reservation/readiness-probe', '/admin/system/integrity']) {
  await check(`Anonymous access denied: ${path}`, `${api}${path}`, async (response) => {
    assert(response.status === 401)
  })
}
console.log(`${6 - failures}/6 checks passed`)
process.exitCode = failures ? 1 : 0
