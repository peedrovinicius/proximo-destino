// Synthetic browser story: denies external requests and every API write.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'
const root = resolve('dist'), output = resolve('mobile-check-results')
await mkdir(output, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }
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
  for (const width of [375, 768, 1440]) for (const name of ['a', 'b']) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), unexpected = [], errors = [], calls = []
    const slug = `company-${name}`, company = { slug, tradeName: `Synthetic company ${name}` }
    const trip = { id: `trip-${name}`, title: `Journey ${name}`, origin: 'Fortaleza', destination: 'Recife',
      departureDate: '2027-01-01T12:00:00Z', returnDate: null, priceCents: 10000, capacity: 4, summary: 'Synthetic trip summary', imageUrl: null }
    let mode = 'ok'
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== base) { unexpected.push(url.origin); return route.abort() }
      if (!url.pathname.startsWith('/api/v1/')) return route.continue()
      calls.push({ method: request.method(), path: url.pathname, query: url.search })
      const respond = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      const path = `/api/v1/public/companies/${slug}/trips`
      if (request.method() !== 'GET' || !url.pathname.startsWith(path)) { unexpected.push(url.pathname); return respond(503, {}) }
      if (mode === 'unavailable') return respond(404, {})
      if (url.pathname === path) return respond(200, { company, trips: url.searchParams.get('origin') === 'Empty' ? [] : [trip], limit: 100, hasMore: true, readOnly: true })
      if (url.pathname === `${path}/${trip.id}`) return respond(200, { company, trip, readOnly: true })
      if (url.pathname === `${path}/${trip.id}/seats`) {
        if (mode === 'seat-error') return respond(409, {})
        if (mode === 'disabled-map') return respond(200, { enabled: false, capacity: null, readOnly: true })
        return respond(200, { enabled: true, capacity: 4, occupiedSeats: [1], blockedSeats: [4], availableCount: 2, readOnly: true })
      }
      return respond(404, {})
    })
    try {
      await page.goto(`${base}/?screen=company&company=${slug}`)
      await page.getByRole('heading', { name: company.tradeName, exact: true }).waitFor()
      await page.getByRole('status').filter({ hasText: 'Exibindo até 100 viagens' }).waitFor()
      await page.getByRole('link', { name: `Ver detalhes de ${trip.title}` }).click()
      await page.getByLabel('Poltrona 1: Ocupada', { exact: true }).waitFor()
      await page.getByLabel('Poltrona 2: Livre', { exact: true }).waitFor()
      await page.getByLabel('Poltrona 4: Bloqueada', { exact: true }).waitFor()
      assert.equal(await page.locator('input').count(), 0)
      assert.equal(await page.getByRole('button', { name: /comprar|reservar|selecionar/i }).count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
      await page.reload(); await page.getByLabel('Poltrona 2: Livre', { exact: true }).waitFor()
      mode = 'seat-error'; await page.getByRole('button', { name: 'Atualizar consulta' }).click()
      await page.getByRole('alert').filter({ hasText: 'Disponibilidade não confirmada' }).waitFor()
      assert.equal(await page.locator('.company-catalog-seats').count(), 0)
      mode = 'disabled-map'; await page.getByRole('button', { name: 'Atualizar consulta' }).click()
      await page.getByText('Mapa não disponível para esta viagem.', { exact: true }).waitFor()
      mode = 'ok'; await page.getByRole('button', { name: 'Atualizar consulta' }).click()
      await page.getByLabel('Poltrona 2: Livre', { exact: true }).waitFor()
      await page.screenshot({ path: `${output}/company-public-${name}-${width}.png`, fullPage: true })
      await page.goBack(); await page.getByRole('link', { name: `Ver detalhes de ${trip.title}` }).waitFor()
      await page.getByLabel('Origem', { exact: true }).fill('Empty')
      await page.getByRole('button', { name: 'Buscar viagens' }).click()
      await page.getByRole('status').filter({ hasText: 'Nenhuma viagem disponível' }).waitFor()
      assert.ok(calls.some(call => call.query === '?origin=Empty'))
      mode = 'unavailable'; await page.getByRole('button', { name: 'Atualizar consulta' }).click()
      await page.getByRole('alert').filter({ hasText: 'Empresa ou viagem indisponível.' }).waitFor()
      assert.equal(await page.locator('.company-catalog-card').count(), 0)
      await page.goto(`${base}/?screen=company&company=INVALID!`)
      await page.getByRole('alert').filter({ hasText: 'Empresa indisponível.' }).waitFor()
      assert.ok(calls.every(call => call.method === 'GET' && call.path.startsWith(`/api/v1/public/companies/${slug}/trips`)))
      assert.deepEqual(unexpected, []); assert.deepEqual(errors, [])
      console.log(`PASS company-public-${name}-${width}: catalog, detail, reload/back, read-only availability, failure recovery and no fallback`)
    } finally { await context.close() }
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
