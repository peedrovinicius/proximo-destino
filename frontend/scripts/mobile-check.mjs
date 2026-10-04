// Isolated browser checks. All API responses are fictitious; no live accounts or writes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const root = resolve('dist')
const output = resolve('mobile-check-results')
await mkdir(output, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!path.startsWith(root + '/')) { response.writeHead(403).end(); return }
    const body = await readFile(path)
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body)
  } catch { response.writeHead(404).end() }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const trip = {
  id: 'synthetic-mobile-trip', title: 'Viagem de teste para São Miguel dos Milagres',
  origin: 'Fortaleza — Ceará', destination: 'São Miguel dos Milagres — Alagoas',
  departureDate: '2027-01-15T12:00:00Z', returnDate: '2027-01-18T12:00:00Z',
  capacity: 48, busTemplate: null, seatLayout: 'TWO_BY_TWO', priceCents: 125000,
  summary: 'Viagem fictícia para conferir o layout em telas pequenas.',
  imageUrl: null, hasUploadedImage: false, imageUpdatedAt: null, status: 'ACTIVE',
}
let browser
let checks = 0
let failures = 0

async function fit(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
  assert(dimensions.scroll <= dimensions.width + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`)
  const tinyText = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((element) => !element.closest('svg, [aria-hidden="true"]') &&
      [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) &&
      element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 &&
      getComputedStyle(element).visibility !== 'hidden')
    .map((element) => ({ label: element.textContent.trim().slice(0, 55), size: parseFloat(getComputedStyle(element).fontSize) }))
    .filter((item) => item.size < 11.9))
  assert.deepEqual(tinyText, [], `${label}: no text below 12 px`)
  const titles = await page.locator('h1').evaluateAll((elements) =>
    elements.map((element) => parseFloat(getComputedStyle(element).fontSize)))
  for (const size of titles) assert(size >= 24 && size <= 64.1, `${label}: balanced main title ${size}px`)
  const fields = await page.locator('input:not([type="checkbox"]):not([type="radio"]), select, textarea').evaluateAll((elements) =>
    elements.filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => parseFloat(getComputedStyle(element).fontSize)))
  for (const size of fields) assert(size >= 15.9, `${label}: readable form field ${size}px`)
}
async function checkFooter(page, width) {
  const footer = page.getByRole('contentinfo', { name: 'Rodapé da Próximo Destino' })
  await footer.scrollIntoViewIfNeeded()
  await fit(page, 'footer')
  for (const name of ['Empresa', 'Sua viagem', 'Políticas e compromissos']) {
    assert.equal(await footer.getByRole('navigation', { name, exact: true }).count(), 1)
  }
  const controls = footer.locator('a, button')
  assert.equal(await controls.count(), 19, 'Preserve all 15 institutional pages, social channels and admin access')
  const bounds = await controls.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { label: element.textContent || element.getAttribute('aria-label'),
      left: box.left, right: box.right, height: box.height, width: innerWidth }
  }))
  for (const box of bounds) {
    assert(box.height >= 43.9, `Footer touch target: ${box.label}`)
    assert(box.left >= 0 && box.right <= box.width, `Footer control clipped: ${box.label}`)
  }
  await page.screenshot({ path: `${output}/footer-${width}.png`, fullPage: false })
  await footer.getByRole('button', { name: 'Privacidade', exact: true }).click()
  await page.getByRole('heading', { name: 'Política de Privacidade', exact: true }).waitFor()
  await fit(page, 'institutional page')
  await page.goto(base)
}
async function test(name, viewport, execute) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  const unexpected = []
  let map = {
    enabled: true, capacity: 48, busTemplate: null, busLabel: 'Ônibus de teste',
    seatLayout: 'TWO_BY_TWO', deckCount: 1, lowerDeckCapacity: null,
    vehicleFeatures: [], blockedSeats: [2], occupiedSeats: [3], availableCount: 46,
  }
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    // No third-party request is sent, even for background images/maps/fonts.
    if (url.origin !== base) { await route.fulfill({ status: 200, body: '' }); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    let body
    let status = 200
    if (url.pathname.endsWith('/public/trips')) body = [trip]
    else if (url.pathname.endsWith(`/public/trips/${trip.id}`)) body = trip
    else if (url.pathname.endsWith('/seats')) body = map
    else if (url.pathname.endsWith('/public/payments/config')) body = { configured: false, provider: 'MERCADO_PAGO', methods: { PIX: false, CARD: false, BOLETO: false, TRANSFER: false } }
    else { unexpected.push(`${request.method()} ${url.pathname}`); status = 503; body = { message: 'Request not allowed by isolated browser test' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  try {
    await execute(page, (next) => { map = { ...map, ...next } })
    assert.deepEqual(errors, [], 'JavaScript runtime errors')
    assert.deepEqual(unexpected, [], 'Unexpected API calls')
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${name}: ${error.message}`)
    await page.screenshot({ path: `${output}/${name}-failed.png`, fullPage: true }).catch(() => {})
  } finally { checks++; await context.close() }
}

try {
  browser = await chromium.launch()
  for (const width of [320, 390, 768]) {
    await test(`public-and-logins-${width}`, { width, height: 844 }, async (page) => {
      await page.goto(base)
      await page.getByRole('button', { name: 'Abrir viagem', exact: true }).waitFor()
      await fit(page, 'home')
      await checkFooter(page, width)
      await page.getByRole('button', { name: 'Abrir viagem', exact: true }).click()
      await page.getByRole('button', { name: 'Escolher assentos', exact: true }).waitFor()
      await fit(page, 'trip details')
      await page.getByRole('button', { name: 'Minha viagem', exact: true }).click()
      await page.getByLabel('Código da reserva', { exact: true }).waitFor()
      await fit(page, 'client login')
      await page.goto(`${base}/?screen=admin-login`)
      await page.getByLabel('Senha', { exact: true }).waitFor()
      await fit(page, 'admin login')
      assert.equal(await page.getByLabel('Senha', { exact: true }).getAttribute('type'), 'password')
    })
    for (const layout of ['TWO_BY_TWO', 'TWO_BY_ONE']) {
      await test(`seats-${layout}-${width}`, { width, height: 844 }, async (page, setMap) => {
        setMap({ seatLayout: layout, deckCount: 2, lowerDeckCapacity: 12,
          vehicleFeatures: [{ type: 'STAIRS', deck: 1, position: 'REAR', side: 'RIGHT' }] })
        await page.goto(base)
        await page.getByRole('button', { name: 'Abrir viagem', exact: true }).click()
        const trigger = page.getByRole('button', { name: 'Escolher assentos', exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await fit(page, 'seat modal')
        const dimensions = await dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return { left: bounds.left, right: bounds.right, width: innerWidth,
            content: element.scrollWidth, available: element.clientWidth }
        })
        assert(dimensions.left >= -1 && dimensions.right <= dimensions.width + 1,
          `Dialog must stay inside viewport: ${JSON.stringify(dimensions)}`)
        assert(dimensions.content <= dimensions.available + 1,
          `Dialog content must fit: ${JSON.stringify(dimensions)}`)
        const seat = page.getByRole('button', { name: 'Assento 1, disponível', exact: true })
        const bounds = await seat.boundingBox()
        assert(bounds.width >= 43.9 && bounds.height >= 43.9, 'Seat touch target must be at least 44 px')
        assert.equal(await page.getByRole('button', { name: 'Assento 2, bloqueado pela agência', exact: true }).isDisabled(), true)
        assert.equal(await page.getByRole('button', { name: 'Assento 3, ocupado', exact: true }).isDisabled(), true)
        assert.equal(await page.getByRole('button', { name: 'Confirmar', exact: true }).isDisabled(), true)
        await seat.click()
        await page.getByRole('button', { name: /Piso superior/ }).click()
        await page.getByRole('button', { name: 'Assento 13, disponível', exact: true }).waitFor()
        await page.getByRole('button', { name: /Piso inferior/ }).click()
        const confirm = page.getByRole('button', { name: 'Confirmar', exact: true })
        await confirm.focus()
        await page.keyboard.press('Tab')
        assert.equal(await page.getByRole('button', { name: 'Fechar escolha de assentos', exact: true }).evaluate((element) => element === document.activeElement), true)
        await page.keyboard.press('Shift+Tab')
        assert.equal(await confirm.evaluate((element) => element === document.activeElement), true)
        await page.screenshot({ path: `${output}/modal-${layout}-${width}.png` })
        await confirm.click()
        await dialog.waitFor({ state: 'hidden' })
        const selected = page.getByRole('button', { name: 'Assentos 1', exact: true })
        assert.equal(await selected.evaluate((element) => element === document.activeElement), true, 'Focus must return after confirmation')
        await selected.click()
        await dialog.waitFor()
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(await selected.evaluate((element) => element === document.activeElement), true, 'Focus must return after Escape')
      })
    }
  }
  await test('footer-desktop-1440', { width: 1440, height: 1000 }, async (page) => {
    await page.goto(base)
    await page.getByRole('button', { name: 'Abrir viagem', exact: true }).waitFor()
    await checkFooter(page, 1440)
  })
  console.log(`${checks - failures}/${checks} isolated mobile browser checks passed`)
  process.exitCode = failures ? 1 : 0
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
