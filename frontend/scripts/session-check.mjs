// Real preview proxy + browser cookie storage, with a synthetic upstream only.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const user = { id: 'synthetic-admin', email: 'admin@example.invalid', role: 'ADMIN' }
let refreshes = 0
const upstream = createServer((request, response) => {
  const send = (status, body) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  const path = request.url
  if (path === '/api/v1/auth/admin/login') {
    response.setHeader('Set-Cookie', 'pd_refresh=synthetic-refresh; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=600')
    return send(200, { status: 'authenticated', accessToken: 'synthetic-access', user })
  }
  if (path === '/api/v1/auth/refresh') {
    refreshes++
    return send(request.headers.cookie?.includes('pd_refresh=synthetic-refresh') ? 200 : 401,
      request.headers.cookie?.includes('pd_refresh=synthetic-refresh') ? { status: 'authenticated', accessToken: 'synthetic-access', user } : { message: 'Sessão ausente' })
  }
  if (path === '/api/v1/auth/logout') {
    response.setHeader('Set-Cookie', 'pd_refresh=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0')
    return response.writeHead(204).end()
  }
  send(404, { message: 'Unexpected upstream path' })
})
await new Promise(done => upstream.listen(0, '127.0.0.1', done))
const portServer = createServer()
await new Promise(done => portServer.listen(0, '127.0.0.1', done))
const port = portServer.address().port
await new Promise(done => portServer.close(done))
const base = `http://127.0.0.1:${port}`
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, AUTH_API_ORIGIN: `http://127.0.0.1:${upstream.address().port}` }, stdio: 'pipe',
})
let browser
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break
    if (preview.exitCode !== null) throw new Error('Preview exited before startup')
    await new Promise(done => setTimeout(done, 100))
  }
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== base) return route.abort()
    if (!url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/api/v1/auth/')) return route.continue()
    const body = url.pathname.endsWith('/dashboard') ? { metrics: { clients: 0, pendingReservations: 0, activeTrips: 0, confirmedReservations: 0 }, birthdays: [] }
      : url.pathname.endsWith('/me') ? user : url.pathname.endsWith('/notifications') ? { unreadCount: 0, items: [] } : []
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(`${base}/?screen=admin-login`)
  await page.getByLabel('E-mail corporativo').fill(user.email)
  await page.getByLabel('Senha', { exact: true }).fill('synthetic-password-123')
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.locator('.admin-shell').waitFor()
  const cookies = await page.context().cookies()
  assert.ok(cookies.some(cookie => cookie.name === 'pd_refresh' && cookie.httpOnly && cookie.sameSite === 'Strict'))
  for (let reload = 0; reload < 3; reload++) {
    await page.reload(); await page.locator('.admin-shell').waitFor()
    assert.ok(page.url().includes('screen=admin'))
  }
  assert.ok(refreshes >= 3)
  assert.equal(await page.evaluate(() => document.cookie.includes('pd_refresh')), false)
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('synthetic-access')), false)
  await page.getByTitle('Minha conta', { exact: true }).click()
  const loggedOut = page.waitForResponse(response => response.url().endsWith('/auth/logout'))
  await page.getByRole('menuitem', { name: 'Sair da conta', exact: true }).click()
  await loggedOut
  await page.goto(`${base}/?screen=admin`)
  await page.getByLabel('E-mail corporativo').waitFor()
  assert.equal(await page.locator('.admin-shell').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Session proxy: first-party HttpOnly cookie, three reloads, no token storage and logout passed.')
} finally {
  await browser?.close(); preview.kill('SIGTERM')
  await new Promise(done => upstream.close(done))
}
