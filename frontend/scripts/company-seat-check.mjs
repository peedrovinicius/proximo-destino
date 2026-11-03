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
    for (const company of ['a', 'b']) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const errors = []; const unexpected = []; const writes = []
      const client = { id: `client-${company}`, fullName: `Synthetic passenger ${company}`, email: 'private@example.invalid', phone: 'private-phone' }
      const trip = { id: `trip-${company}`, title: `Synthetic draft ${company}`, origin: 'Fortaleza', destination: 'Recife',
        departureDate: '2027-01-01T12:00:00Z', returnDate: null, status: 'DRAFT', priceCents: 10000,
        capacity: 4, busTemplate: 'CUSTOM', seatLayout: 'TWO_BY_TWO', deckCount: 1, lowerDeckCapacity: null,
        blockedSeats: [4], vehicleFeatures: [], imageUrl: null, hasUploadedImage: false, imageUpdatedAt: null, _count: { reservations: 1 } }
      let assignments = []
      let assignmentFailure = true; let releaseFailure = true
      let financialRequests = 0
      const map = () => ({ ...trip, enabled: true, preparatory: true, trip, busLabel: 'Synthetic bus',
        occupiedSeats: assignments.map(row => row.seatNumber), assignments, availableCount: 3 - assignments.length })
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', async route => {
        const request = route.request(); const url = new URL(request.url())
        if (url.origin !== base) return route.abort()
        if (!url.pathname.startsWith('/api/v1/')) return route.continue()
        const respond = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
        const path = url.pathname.slice('/api/v1'.length)
        if (path === '/auth/refresh') return respond(200, { status: 'authenticated',
          accessToken: `test.${Buffer.from(JSON.stringify({ role: 'ADMIN', sub: `admin-${company}` })).toString('base64url')}.test`,
          user: { id: `admin-${company}`, email: 'admin@example.invalid', role: 'ADMIN' } })
        if (path === '/admin/dashboard') return respond(200, { metrics: { clients: 1, pendingReservations: 1, activeTrips: 0, confirmedReservations: 0 }, birthdays: [] })
        if (path === '/admin/notifications') return respond(200, { unreadCount: 0, items: [] })
        if (path === '/admin/trips') return respond(200, [trip])
        if (path === '/admin/clients') return respond(200, [client])
        if (path === '/admin/reservations') return respond(200, [])
        if (path === '/admin/payments/orders') {
          financialRequests++
          if (financialRequests === 2) return respond(409, { message: 'Synthetic financial inconsistency' })
          return respond(200, { summaryOnly: true, coverage: 'ONLINE_AND_MANUAL_PAYMENTS',
          summary: { totalOrders: 206, paidOrders: 202, pendingOrders: 1, refundedOrders: 1, cancelledOrders: 1, expiredOrders: 1,
            paidCents: 30900, pendingCents: 500, refundedCents: 550, manualReceivedCount: 1, manualReceivedCents: 10000,
            manualReversedCount: 1, manualReversedCents: 50 }, orders: [], manualPayments: [] })
        }
        if (path === '/admin/payments/reconciliation/report' && request.method() === 'GET') {
          assert.equal(url.searchParams.has('after'), false)
          return respond(200, { reportOnly: true, pageScoped: true, providerContacted: false,
            dataModified: false, paymentsEnabled: false, pageSize: 50,
            scannedReservations: 1, flaggedReservations: 0, issueCount: 0,
            nextCursor: null, divergences: [] })
        }
        if (path === '/admin/trips/bus-templates') return respond(200, [])
        if (path === `/admin/trips/${trip.id}/audit`) return respond(200, { trip, preparatory: true, limit: 100, hasMore: true,
          events: [{ id: `event-${company}`, eventType: 'OPS_COMPANY_DRAFT_SEAT_MOVE', createdAt: '2026-10-05T12:00:00Z',
            metadata: { seatNumber: 1, targetSeat: 2 }, user: null }] })
        if (path === `/admin/trips/${trip.id}/seats` && request.method() === 'GET') return respond(200, map())
        const match = path.match(new RegExp(`^/admin/trips/${trip.id}/seats/(\\d+)/assignment$`))
        if (match) {
          const seat = Number(match[1]); const method = request.method(); const payload = request.postDataJSON()
          writes.push({ method, seat, payload })
          if (method === 'POST') {
            assert.deepEqual(payload, { clientId: client.id })
            if (assignmentFailure) { assignmentFailure = false; return respond(409, { message: 'Synthetic occupancy conflict' }) }
            assignments = [{ seatNumber: seat, source: 'ADMIN_RESERVATION',
              passenger: { id: `passenger-${company}`, sequence: 1, fullName: client.fullName, document: 'private-document' },
              reservation: { id: `reservation-${company}`, status: 'PENDING', passengerCount: 1, client } }]
            return respond(201, map())
          }
          if (method === 'PATCH') {
            assert.equal(seat, 1); assert.deepEqual(payload, { toSeatNumber: 2 })
            assignments = assignments.map(row => ({ ...row, seatNumber: 2 }))
            return respond(200, map())
          }
          if (method === 'DELETE') {
            assert.equal(seat, 2)
            if (releaseFailure) { releaseFailure = false; return respond(409, { message: 'Synthetic release refused' }) }
            assignments = []; return respond(200, map())
          }
        }
        unexpected.push(`${request.method()} ${path}`)
        return respond(503, { message: 'Request outside isolated story' })
      })
      try {
        await page.goto(`${base}/?screen=admin&tab=trips`)
        await page.getByRole('button', { name: 'Gerenciar assentos', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await page.getByText('Mapa preparatório:', { exact: false }).waitFor()
        const seat = n => page.getByRole('button', { name: new RegExp(`^Assento ${n},`) })
        await seat(1).click()
        await page.getByRole('button', { name: 'Atribuir cliente', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: 'Novo cliente', exact: true }).count(), 0)
        const choice = page.getByRole('button', { name: client.fullName, exact: true })
        await choice.click()
        assert.equal((await page.locator('.admin-seat-client-panel').innerText()).includes(client.email), false)
        await page.getByRole('button', { name: 'Confirmar nesta poltrona', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Synthetic occupancy conflict' }).waitFor()
        assert.equal(assignments.length, 0)
        await page.getByRole('button', { name: 'Confirmar nesta poltrona', exact: true }).click()
        await page.getByRole('button', { name: /^Assento 1, ocupado/ }).waitFor()
        assert.equal(await page.locator('.admin-seat-client-panel').count(), 0)
        for (const privateValue of [client.email, client.phone, 'private-document', `Synthetic passenger ${company === 'a' ? 'b' : 'a'}`]) {
          assert.equal((await dialog.innerText()).includes(privateValue), false)
        }
        await page.getByRole('button', { name: 'Mover passageiro', exact: true }).click()
        await seat(4).click()
        assert.equal(writes.filter(row => row.method === 'PATCH').length, 0)
        assert.equal(await page.getByRole('button', { name: 'Confirmar troca', exact: true }).isDisabled(), true)
        await seat(2).click()
        await page.getByRole('button', { name: 'Confirmar troca', exact: true }).click()
        await page.getByRole('button', { name: /^Assento 2, ocupado/ }).waitFor()
        await seat(2).click()
        await page.getByRole('button', { name: 'Liberar poltrona preparatória', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Synthetic release refused' }).waitFor()
        assert.deepEqual(assignments.map(row => row.seatNumber), [2])
        await page.getByRole('button', { name: 'Liberar poltrona preparatória', exact: true }).click()
        await page.getByRole('button', { name: /^Assento 2, disponível\. Clique/ }).waitFor()
        assert.equal(assignments.length, 0)
        await page.reload()
        await page.getByRole('button', { name: 'Gerenciar assentos', exact: true }).click()
        await page.getByText('Mapa preparatório:', { exact: false }).waitFor()
        assert.equal(await page.getByRole('button', { name: /ocupado\. Ver passageiro/ }).count(), 0)
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Auditoria', exact: true }).last().click()
        await page.getByText('Histórico preparatório da empresa', { exact: true }).waitFor()
        await page.getByText('Poltrona preparatória alterada', { exact: true }).waitFor()
        await page.getByText('Poltrona 1 → Poltrona 2', { exact: true }).waitFor()
        await page.getByRole('status').filter({ hasText: 'há registros anteriores não exibidos' }).waitFor()
        assert.equal((await page.getByRole('dialog').innerText()).includes('admin@example.invalid'), false)
        await page.goto(`${base}/?screen=admin&tab=payments`)
        await page.getByText('Resumo somente leitura dos pedidos online e recebimentos manuais da própria empresa.', { exact: false }).waitFor()
        assert.equal(await page.getByPlaceholder('Cliente, viagem, reserva ou pedido').count(), 0)
        assert.equal(await page.locator('.admin-payment-filters').count(), 0)
        await page.getByText(/309,00/).waitFor()
        assert.equal((await page.locator('.admin-payments-workspace').innerText()).includes('1 manual(is)'), true)
        await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Synthetic financial inconsistency' }).waitFor()
        await page.getByRole('status').filter({ hasText: 'último resumo carregado e não foram atualizados' }).waitFor()
        assert.equal((await page.locator('.admin-payments-workspace').innerText()).includes('309,00'), true)
        await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Synthetic financial inconsistency' }).waitFor({ state: 'hidden' })
        assert.equal(await page.getByRole('status').filter({ hasText: 'último resumo carregado' }).count(), 0)
        assert.equal(financialRequests, 3)
        assert.deepEqual(writes.map(row => row.method), ['POST', 'POST', 'PATCH', 'DELETE', 'DELETE'])
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
        await page.screenshot({ path: `${output}/company-seats-${company}-${width}.png`, fullPage: true })
        console.log(`PASS company-seats-${company}-${width}: seats, audit, online/manual summary, stale-value warning and refresh recovery`)
      } catch (error) {
        await page.screenshot({ path: `${output}/company-seats-${company}-${width}-failed.png`, fullPage: true }).catch(() => {})
        throw error
      } finally { await context.close() }
    }
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
