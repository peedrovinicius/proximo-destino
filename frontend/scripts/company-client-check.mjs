// Synthetic portal stories. No production traffic or real credentials.
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
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(await readFile(path))
  } catch { response.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [375, 768, 1440]) for (const company of ['a', 'b']) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), unexpected = [], errors = [], calls = []
    const slug = `company-${company}`, token = `synthetic-session-${company}`, credentials = {
      reservationId: `reservation-${company}`, email: `synthetic-${company}@example.invalid`, code: 'SYNTHETIC-CODE',
    }
    let mode = 'ok', logoutFails = true, loggedOut = false
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== base) { unexpected.push(url.origin); return route.abort() }
      if (!url.pathname.startsWith('/api/v1/')) return route.continue()
      const path = `/api/v1/public/companies/${slug}/client`
      const respond = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      calls.push({ method: req.method(), path: url.pathname, query: url.search })
      if (url.pathname === `${path}/login` && req.method() === 'POST') {
        assert.deepEqual(req.postDataJSON(), credentials)
        assert.equal(req.headers().authorization, undefined)
        if (mode === 'bad-login') return respond(401, {})
        if (mode === 'disabled') return respond(404, {})
        loggedOut = false
        return respond(201, { accessToken: token, expiresAt: new Date(Date.now() + (mode === 'expires' ? 3000 : 1800000)).toISOString(), readOnly: true })
      }
      if (url.pathname === `${path}/portal` && req.method() === 'GET') {
        assert.equal(req.headers().authorization, `Bearer ${token}`)
        if (mode === 'revoked' || loggedOut) return respond(401, {})
        if (mode === 'read-error') return respond(503, {})
        return respond(200, { company: { slug, tradeName: `Synthetic company ${company}` }, readOnly: true,
          reservation: { status: 'PENDING', passengerCount: 1, seats: [2], trip: { title: `Private journey ${company}`,
            origin: 'Fortaleza', destination: 'Recife', departureDate: '2027-01-01T12:00:00Z', returnDate: null } } })
      }
      if (url.pathname === `${path}/logout` && req.method() === 'POST') {
        assert.equal(req.headers().authorization, `Bearer ${token}`)
        if (logoutFails) { logoutFails = false; return respond(503, {}) }
        loggedOut = true; return respond(201, { loggedOut: true })
      }
      unexpected.push(`${req.method()} ${url.pathname}`); return respond(503, {})
    })
    const login = async () => {
      await page.getByLabel('Identificador da reserva', { exact: true }).fill(credentials.reservationId)
      await page.getByLabel('E-mail da reserva', { exact: true }).fill(credentials.email)
      await page.getByLabel('Código de acesso', { exact: true }).fill(credentials.code)
      await page.getByRole('button', { name: 'Consultar minha reserva', exact: true }).click()
    }
    const journey = () => page.getByRole('heading', { name: `Private journey ${company}`, exact: true })
    const noStoredSecrets = async () => {
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)
      for (const value of [token, credentials.code, credentials.email, credentials.reservationId]) assert.equal(page.url().includes(value), false)
    }
    try {
      await page.goto(`${base}/?screen=company-client&company=${slug}`)
      mode = 'bad-login'; await login()
      await page.getByRole('alert').filter({ hasText: 'Acesso inválido' }).waitFor()
      assert.equal(await page.getByLabel('Código de acesso').inputValue(), '')
      mode = 'ok'; await login(); await journey().waitFor()
      assert.equal(await page.locator('h1').evaluate(el => document.activeElement === el), true)
      assert.equal(await page.locator('input').count(), 0)
      assert.equal(await page.getByRole('button', { name: /pagar|cancelar|trocar|comprar/i }).count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await noStoredSecrets()
      await page.screenshot({ path: `${output}/company-client-${company}-${width}.png`, fullPage: true })
      mode = 'read-error'; await page.getByRole('button', { name: 'Atualizar reserva' }).click()
      await page.getByRole('alert').filter({ hasText: 'Não foi possível concluir' }).waitFor()
      assert.equal(await journey().count(), 0)
      mode = 'ok'; await page.getByRole('button', { name: 'Atualizar reserva' }).click(); await journey().waitFor()
      await page.getByRole('button', { name: 'Sair da reserva' }).click()
      await page.getByRole('alert').filter({ hasText: 'Não foi possível confirmar o encerramento' }).waitFor()
      assert.equal(await journey().count(), 0)
      await page.getByRole('button', { name: 'Sair da reserva' }).click()
      await page.getByRole('status').filter({ hasText: 'Sessão encerrada.' }).waitFor()
      assert.equal(await page.getByLabel('E-mail da reserva').inputValue(), '')
      await login(); await journey().waitFor()
      mode = 'revoked'; await page.getByRole('button', { name: 'Atualizar reserva' }).click()
      await page.getByRole('alert').filter({ hasText: 'Acesso inválido' }).waitFor()
      assert.equal(await journey().count(), 0)
      mode = 'expires'; await login(); await journey().waitFor()
      await page.getByRole('alert').filter({ hasText: 'Sua sessão expirou.' }).waitFor()
      assert.equal(await journey().count(), 0)
      mode = 'ok'; await login(); await journey().waitFor()
      const before = calls.length
      await page.reload(); await page.getByLabel('Código de acesso').waitFor()
      assert.equal(calls.length, before); assert.equal(await journey().count(), 0)
      mode = 'disabled'; await login(); await page.getByRole('alert').filter({ hasText: 'Acesso da empresa indisponível.' }).waitFor()
      await noStoredSecrets()
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
      assert.ok(calls.every(call => !call.query && call.path.startsWith(`/api/v1/public/companies/${slug}/client/`)))
      console.log(`PASS company-client-${company}-${width}: login/read, privacy, refresh failure/recovery, logout retry, revocation, expiry and reload`)
    } finally { await context.close() }
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
