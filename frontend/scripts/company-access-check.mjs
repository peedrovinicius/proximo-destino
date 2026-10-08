// Built frontend with synthetic, company-scoped responses. Never contacts production.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const root = resolve('dist')
const output = resolve('mobile-check-results')
await mkdir(output, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!path.startsWith(root + '/')) return response.writeHead(403).end()
    const body = await readFile(path)
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body)
  } catch { response.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [375, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 950 } })
    const page = await context.newPage()
    const errors = [], unexpected = [], writes = []
    let role = 'ADMIN', marker = true, issueFailures = 1, revokeFailures = 1
    const code = 'A1'.repeat(24)
    const reservation = { id: 'synthetic-reservation', status: 'CONFIRMED', passengerCount: 1,
      seatAssignments: [], createdAt: '2026-10-07T12:00:00Z', purchaseOrder: null,
      client: { id: 'synthetic-client', fullName: 'Synthetic client', email: null, phone: null, bonusBalanceCents: 0 },
      trip: { id: 'synthetic-trip', title: 'Synthetic trip', origin: 'Fortaleza', destination: 'Recife', departureDate: '2027-01-01T12:00:00Z' } }
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== base) return route.abort()
      if (!url.pathname.startsWith('/api/v1/')) return route.continue()
      const respond = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      const path = url.pathname.slice('/api/v1'.length)
      if (path === '/auth/refresh') return respond(200, { status: 'authenticated',
        accessToken: `test.${Buffer.from(JSON.stringify({ role, sub: 'synthetic-admin' })).toString('base64url')}.test`,
        user: { id: 'synthetic-admin', email: 'admin@example.invalid', role } })
      if (path === '/admin/dashboard') return respond(200, { metrics: { clients: 0, pendingReservations: 0, activeTrips: 0, confirmedReservations: 1 }, birthdays: [] })
      if (path === '/admin/notifications') return respond(200, { unreadCount: 0, items: [] })
      if (path === '/admin/trips' || path === '/admin/clients') return respond(200, [])
      if (path === '/admin/reservations') return respond(200, [{ ...reservation, ...(marker ? { companyPortalAccess: { canIssue: true } } : {}) }])
      if (path === `/admin/reservations/${reservation.id}/company-portal-code`) {
        assert.equal(request.method(), 'POST'); assert.deepEqual(request.postDataJSON(), { confirmedPrivateDelivery: true })
        writes.push('issue')
        if (issueFailures-- > 0) return respond(409, { message: 'Synthetic issuance conflict' })
        return respond(201, { reservationId: reservation.id, code, expiresAt: new Date(Date.now() + 86400000).toISOString(), delivery: 'MANUAL_PRIVATE' })
      }
      if (path === `/admin/reservations/${reservation.id}/company-portal-code/revoke`) {
        assert.equal(request.method(), 'POST'); writes.push('revoke')
        if (revokeFailures-- > 0) return respond(503, { message: 'Synthetic revocation failure' })
        return respond(201, { revoked: true })
      }
      unexpected.push(`${request.method()} ${path}`)
      return respond(503, { message: 'Outside isolated story' })
    })
    try {
      await page.goto(`${base}/?screen=admin&tab=reservations`)
      const open = () => page.getByRole('button', { name: 'Acesso ao portal', exact: true }).click()
      await open()
      const dialog = page.getByRole('dialog')
      await page.getByRole('button', { name: 'Gerar novo código', exact: true }).click()
      assert.equal(writes.length, 0)
      await page.getByRole('checkbox', { name: 'Vou entregar o código em canal privado ao cliente correto.' }).check()
      await page.getByRole('button', { name: 'Gerar novo código', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Synthetic issuance conflict' }).waitFor()
      assert.equal(await page.getByLabel('Código de acesso', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Gerar novo código', exact: true }).click()
      await page.getByLabel('Código de acesso', { exact: true }).waitFor()
      assert.equal(await page.getByLabel('Código de acesso', { exact: true }).inputValue(), code)
      assert.equal(await page.getByLabel('Código de acesso', { exact: true }).evaluate(el => el === document.activeElement), true)
      assert.equal(page.url().includes(code), false)
      assert.equal(await page.evaluate(value => JSON.stringify([localStorage, sessionStorage]).includes(value), code), false)
      await page.screenshot({ path: resolve(output, `company-access-${width}.png`), fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await page.getByRole('checkbox', { name: 'Confirmo encerrar o código e todas as sessões desta reserva.' }).check()
      await page.getByRole('button', { name: 'Revogar acesso', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Synthetic revocation failure' }).waitFor()
      assert.equal(await page.getByLabel('Código de acesso', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Revogar acesso', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Acesso revogado' }).waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await open()
      assert.equal(await page.getByLabel('Código de acesso', { exact: true }).count(), 0)
      await page.getByRole('checkbox', { name: 'Vou entregar o código em canal privado ao cliente correto.' }).check()
      await page.getByRole('button', { name: 'Gerar novo código', exact: true }).click()
      await page.getByLabel('Código de acesso', { exact: true }).waitFor()
      await page.reload()
      await open()
      assert.equal(await page.getByLabel('Código de acesso', { exact: true }).count(), 0)
      await page.keyboard.press('Escape')
      role = 'AGENT'; await page.reload()
      await page.getByText('Synthetic client', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Acesso ao portal', exact: true }).count(), 0)
      role = 'ADMIN'; marker = false; await page.reload()
      await page.getByText('Synthetic client', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Acesso ao portal', exact: true }).count(), 0)
      assert.deepEqual(writes, ['issue', 'issue', 'revoke', 'revoke', 'issue'])
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
      console.log(`Company reservation access story passed at ${width}px`)
    } finally { await context.close() }
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
