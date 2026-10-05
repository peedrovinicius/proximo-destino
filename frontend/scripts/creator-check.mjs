// Fictitious API + isolated built frontend. Never contacts production.
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
    if (!path.startsWith(root + '/')) { response.writeHead(403).end(); return }
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(await readFile(path))
  } catch { response.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
let browser
let checks = 0
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } })
    const errors = []; const unexpected = []; const drafts = []; const writes = []; const admins = []
    let authenticated = false
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin !== base) { await route.abort(); return }
      if (!url.pathname.startsWith('/api/v1/')) { await route.continue(); return }
      const request = route.request()
      const respond = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (url.pathname === '/api/v1/auth/refresh') return authenticated
        ? respond(200, { status: 'authenticated', accessToken: 'synthetic-creator-token', user: { id: 'synthetic-creator', role: 'CREATOR', email: 'creator@example.invalid' } })
        : respond(401, { message: 'Sessão ausente' })
      if (url.pathname === '/api/v1/auth/creator/login') return respond(200, { status: 'mfa_required', challengeToken: 'synthetic-challenge' })
      if (url.pathname === '/api/v1/auth/mfa/verify') {
        authenticated = true
        return respond(200, { status: 'authenticated', accessToken: 'synthetic-creator-token', user: { id: 'synthetic-creator', role: 'CREATOR', email: 'creator@example.invalid' } })
      }
      if (url.pathname === '/api/v1/auth/logout') { authenticated = false; return route.fulfill({ status: 204, body: '' }) }
      if (url.pathname.startsWith('/api/v1/platform/companies')) {
        assert.equal(request.headers().authorization, 'Bearer synthetic-creator-token')
        if (url.pathname.endsWith('/admins')) {
          if (request.method() === 'GET') return respond(200, admins)
          assert.equal(request.method(), 'POST')
          const payload = request.postDataJSON()
          assert.deepEqual(Object.keys(payload).sort(), ['displayName', 'email', 'password'])
          assert.ok(payload.password.length >= 16)
          const admin = { id: 'synthetic-membership', isActive: false,
            user: { id: 'synthetic-admin', displayName: payload.displayName, email: payload.email, isActive: false } }
          admins.push(admin)
          return respond(201, admin)
        }
        if (request.method() === 'GET') return respond(200, drafts)
        const payload = request.postDataJSON(); writes.push(payload)
        assert.equal('status' in payload, false); assert.equal('createdById' in payload, false)
        const company = { ...payload, id: 'synthetic-company', status: 'DRAFT' }
        drafts.splice(0, drafts.length, company)
        return respond(request.method() === 'POST' ? 201 : 200, company)
      }
      unexpected.push(`${request.method()} ${url.pathname}`)
      return respond(500, { message: 'Unexpected synthetic API route' })
    })
    await page.goto(`${base}/?screen=creator`)
    await page.getByRole('heading', { name: 'Área exclusiva do Criador' }).waitFor()
    await page.getByLabel('E-mail corporativo').fill('creator@example.invalid')
    await page.getByLabel('Senha', { exact: true }).fill('Synthetic-password-only-for-test')
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await page.getByRole('heading', { name: 'Confirme sua identidade' }).waitFor()
    await page.locator('input').fill('123456')
    await page.getByRole('button', { name: 'Verificar e entrar', exact: true }).click()
    await page.getByRole('heading', { name: 'Empresas da plataforma' }).waitFor()
    await page.getByText('Nenhuma empresa cadastrada.').waitFor()
    for (const [label, value] of [
      ['Nome da empresa', 'Agência sintética'], ['Identificador da empresa', 'agencia-sintetica'],
      ['E-mail de contato', 'contato@example.invalid'], ['Nome do responsável', 'Responsável sintético'],
      ['E-mail do responsável', 'responsavel@example.invalid'],
    ]) await page.getByLabel(label, { exact: false }).fill(value)
    await page.getByRole('button', { name: 'Salvar rascunho' }).click()
    await page.getByRole('status').filter({ hasText: 'Empresa salva em rascunho' }).waitFor()
    await page.getByRole('button', { name: 'Editar rascunho de Agência sintética' }).click()
    await page.getByLabel('Nome da empresa', { exact: false }).fill('Agência sintética revisada')
    await page.getByRole('button', { name: 'Salvar rascunho' }).click()
    await page.getByRole('heading', { name: 'Agência sintética revisada', exact: true }).waitFor()
    assert.equal(writes.length, 2)
    await page.getByRole('button', { name: 'Administradores de Agência sintética revisada' }).click()
    await page.getByText('Nenhum administrador cadastrado.').waitFor()
    await page.getByLabel('Nome do administrador', { exact: true }).fill('Administrador sintético')
    await page.getByLabel('E-mail de acesso', { exact: true }).fill('admin@example.invalid')
    await page.getByLabel('Senha inicial', { exact: true }).fill('Synthetic-password-only-for-test')
    await page.getByRole('button', { name: 'Cadastrar administrador pendente' }).click()
    await page.getByRole('status').filter({ hasText: 'Administrador cadastrado, com acesso inativo' }).waitFor()
    assert.equal(await page.getByLabel('Senha inicial', { exact: true }).inputValue(), '')
    await page.getByText('Acesso inativo', { exact: true }).waitFor()
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    assert.equal(storage.includes('Synthetic-password-only-for-test'), false)
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(dimensions.scroll <= dimensions.width + 1, `Creator overflow: ${JSON.stringify(dimensions)}`)
    assert.equal(await page.getByRole('button', { name: /Ativar empresa|Enviar convite/ }).count(), 0)
    await page.screenshot({ path: resolve(output, `creator-${width}.png`), fullPage: true })
    await page.reload()
    await page.getByRole('heading', { name: 'Agência sintética revisada', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await page.getByRole('heading', { name: 'Área exclusiva do Criador' }).waitFor()
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
    await page.close(); checks++
  }
  console.log(`Creator: ${checks} responsive flows passed (login + MFA, draft create/edit, pending administrator, cleared password, session restore, logout).`)
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
