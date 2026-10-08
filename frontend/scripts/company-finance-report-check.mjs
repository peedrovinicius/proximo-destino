// Synthetic company-finance reporting UI. No live tenant or financial writes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const root = resolve('dist')
const output = resolve('mobile-check-results')
await mkdir(output, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + '/')) return response.writeHead(403).end()
    const data = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(data)
  } catch { response.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const authToken = `test.${Buffer.from(JSON.stringify({ role: 'ADMIN', sub: 'synthetic-admin' })).toString('base64url')}.test`
const summary = { summaryOnly: true, coverage: 'ONLINE_AND_MANUAL_PAYMENTS',
  summary: { totalOrders: 2, paidOrders: 1, pendingOrders: 1, refundedOrders: 0,
    cancelledOrders: 0, expiredOrders: 0, paidCents: 12500, pendingCents: 12000,
    refundedCents: 0, manualReceivedCount: 1, manualReceivedCents: 4000,
    manualReversedCount: 0, manualReversedCents: 0 }, orders: [], manualPayments: [] }
const item1 = { reservationId: 'synthetic-booking-alpha',
  issues: ['PROVIDER_REFERENCE_MISSING', 'MIXED_PAYMENT_CHANNELS_REVIEW'],
  online: { status: 'PAID', totalCents: 12500, refundedCents: 0 },
  manual: { receivedCount: 1, receivedCents: 4000, reversedCents: 0 } }
const item2 = { reservationId: 'synthetic-booking-beta',
  issues: ['ORDER_AMOUNT_MISMATCH'],
  online: { status: 'PENDING_PAYMENT', totalCents: 12000, refundedCents: 0 },
  manual: { receivedCount: 0, receivedCents: 0, reversedCents: 0 } }
const item3 = { reservationId: 'synthetic-booking-gamma',
  issues: ['PASSENGER_COUNT_MISMATCH'],
  online: null, manual: { receivedCount: 0, receivedCents: 0, reversedCents: 0 } }
const common = { reportOnly: true, pageScoped: true, providerContacted: false,
  dataModified: false, paymentsEnabled: false, pageSize: 50 }
const first = { ...common, scannedReservations: 50, flaggedReservations: 2,
  issueCount: 3, nextCursor: 'synthetic-page-after-50', divergences: [item1, item2] }
const second = { ...common, scannedReservations: 2, flaggedReservations: 1,
  issueCount: 1, nextCursor: null, divergences: [item3] }

let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = [], unexpected = [], reportRequests = []
    let forceError = false
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== base) return route.abort()
      if (!url.pathname.startsWith('/api/v1/')) return route.continue()
      const path = url.pathname.slice('/api/v1'.length)
      const respond = (status, body) => route.fulfill({
        status, contentType: 'application/json', body: JSON.stringify(body),
      })
      if (path === '/auth/refresh') return respond(200, {
        status: 'authenticated', accessToken: authToken,
        user: { id: 'synthetic-admin', email: 'synthetic@example.invalid', role: 'ADMIN' } })
      if (path === '/admin/dashboard') return respond(200, {
        metrics: { clients: 0, pendingReservations: 0, activeTrips: 0, confirmedReservations: 0 },
        birthdays: [] })
      if (path === '/admin/notifications') return respond(200, { unreadCount: 0, items: [] })
      if (['/admin/clients', '/admin/trips', '/admin/reservations'].includes(path)) return respond(200, [])
      if (path === '/admin/payments/orders') return respond(200, summary)
      if (path === '/admin/payments/reconciliation/report') {
        assert.equal(req.method(), 'GET')
        assert.equal(req.headers().authorization, `Bearer ${authToken}`)
        assert.equal(url.searchParams.size <= 1, true)
        reportRequests.push(url.toString())
        if (forceError) { forceError = false; return respond(503, { message: 'Falha fictícia de relatório' }) }
        if (url.searchParams.get('after') === 'synthetic-page-after-50') return respond(200, second)
        assert.equal(url.searchParams.has('after'), false)
        return respond(200, first)
      }
      unexpected.push(`${req.method()} ${path}`)
      return respond(503, { message: 'API não permitida neste ensaio' })
    })
    try {
      await page.goto(`${base}/?screen=admin&tab=payments`)
      const section = page.getByRole('region', { name: 'Divergências para revisão' })
      await section.waitFor()
      await section.getByText('2 com alertas (3 ocorrências)', { exact: false }).waitFor()
      assert.equal(await section.getByRole('button', { name: 'Página anterior' }).isDisabled(), true)
      assert.equal(await section.getByRole('button', { name: 'Próxima página' }).isEnabled(), true)
      assert.equal(await section.getByRole('list', { name: 'Reservas com divergências nesta página' }).locator(':scope > li').count(), 2)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      assert.equal((await section.locator('input').first().evaluate(el => getComputedStyle(el).fontSize)), '16px')
      const headings = await section.locator('h3, h4').evaluateAll(nodes => nodes.map(node => ({
        size: parseFloat(getComputedStyle(node).fontSize), text: node.textContent.trim().slice(0, 50) })))
      assert.ok(headings.every(node => node.size >= 16), JSON.stringify(headings))
      const actions = await section.getByRole('button').evaluateAll(nodes => nodes.map(el => ({
        name: el.textContent.trim(), height: el.getBoundingClientRect().height })))
      assert.ok(actions.every(a => a.height >= 43.9), JSON.stringify(actions))
      await section.getByRole('combobox', { name: 'Tipo de divergência nesta página' })
        .selectOption('MIXED_PAYMENT_CHANNELS_REVIEW')
      assert.equal(await section.getByText('Reserva synthetic-booking-alpha').count(), 1)
      assert.equal(await section.getByText('Reserva synthetic-booking-beta').count(), 0)
      await section.getByRole('combobox', { name: 'Tipo de divergência nesta página' })
        .selectOption('ALL')
      await section.getByRole('searchbox', { name: 'Buscar código de reserva nesta página' }).fill('beta')
      assert.equal(await section.getByText('Reserva synthetic-booking-beta').count(), 1)
      assert.equal(await section.getByText('Reserva synthetic-booking-alpha').count(), 0)
      await section.getByRole('searchbox', { name: 'Buscar código de reserva nesta página' }).fill('')
      await section.getByRole('button', { name: 'Próxima página' }).click()
      await section.getByText('Página 2: 2 reservas examinadas', { exact: false }).waitFor()
      assert.equal(await section.getByRole('button', { name: 'Próxima página' }).isDisabled(), true)
      assert.equal(await section.getByText('Reserva synthetic-booking-gamma').count(), 1)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await section.getByRole('button', { name: 'Página anterior' }).click()
      await section.getByText('Página 1: 50 reservas examinadas', { exact: false }).waitFor()
      await page.screenshot({ path: resolve(output, `company-finance-report-${width}.png`), fullPage: true })
      forceError = true
      await section.getByRole('button', { name: 'Atualizar relatório' }).click()
      await section.getByRole('alert').getByText('Falha fictícia de relatório', { exact: false }).waitFor()
      assert.equal(await section.getByRole('list', { name: 'Reservas com divergências nesta página' }).count(), 0)
      await section.getByRole('button', { name: 'Tentar novamente' }).click()
      await section.getByText('Página 1: 50 reservas examinadas', { exact: false }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      assert.equal(await page.getByText('secret-provider-reference', { exact: false }).count(), 0)
      assert.ok(reportRequests.some(uri => uri.includes('after=synthetic-page-after-50')))
      assert.ok(reportRequests.every(uri => !uri.includes(authToken)))
      assert.deepEqual(unexpected, [])
      assert.deepEqual(errors, [])
      console.log(`PASS company finance read-only report ${width}px`)
    } finally { await context.close() }
  }
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
