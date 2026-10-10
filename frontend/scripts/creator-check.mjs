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
    const body = await readFile(path)
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body)
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
    let adminFails = true, passwordCalls = 0
    let readinessFails = true, readinessCalls = 0
    let inviteActive = false
    let accepted = 0
    const inviteCode = 's'.repeat(43)
    const onboardingCode = 'o'.repeat(43)
    const manualKey = 'JBSWY3DPEHPK3PXP'
    let mfaConfirmed = false
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
      if (url.pathname === '/api/v1/auth/password/change') {
        assert.equal(request.method(), 'POST'); assert.equal(request.headers().authorization, 'Bearer synthetic-creator-token')
        passwordCalls++
        const payload = request.postDataJSON()
        assert.deepEqual(Object.keys(payload).sort(), ['currentPassword', 'newPassword'])
        if (payload.currentPassword === 'Synthetic-wrong-password') return respond(401, { message: 'Confira a senha atual.' })
        assert.equal(payload.currentPassword, 'Synthetic-password-only-for-test')
        assert.equal(payload.newPassword, 'Synthetic-new-password-for-test')
        authenticated = false; return respond(200, { passwordChanged: true, allSessionsRevoked: true })
      }
      if (url.pathname === '/api/v1/company-invitations/accept') {
        assert.equal(request.method(), 'POST')
        assert.ok(inviteActive)
        const payload = request.postDataJSON()
        assert.deepEqual(Object.keys(payload).sort(), ['password', 'token'])
        assert.equal(payload.token, inviteCode)
        assert.equal(payload.password, 'Synthetic-invite-password-for-test')
        inviteActive = false; accepted++
        return respond(201, { passwordSet: true, onboardingToken: onboardingCode, activationAllowed: false })
      }
      if (url.pathname === '/api/v1/company-invitations/resume') {
        const payload = request.postDataJSON()
        assert.equal(payload.email, 'admin@example.invalid'); assert.equal(payload.password, 'Synthetic-invite-password-for-test')
        return respond(201, { onboardingToken: onboardingCode, activationAllowed: false })
      }
      if (url.pathname === '/api/v1/company-invitations/mfa/setup') {
        assert.equal(request.postDataJSON().onboardingToken, onboardingCode)
        return respond(201, { manualKey, qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', activationAllowed: false })
      }
      if (url.pathname === '/api/v1/company-invitations/mfa/confirm') {
        assert.deepEqual(request.postDataJSON(), { onboardingToken: onboardingCode, code: '123456' })
        mfaConfirmed = true
        return respond(201, { mfaConfigured: true, activationAllowed: false,
          recoveryCodes: Array.from({ length: 10 }, (_, n) => `ABCD-EFGH-${String(n).padStart(4, '0')}`) })
      }
      if (url.pathname.startsWith('/api/v1/platform/companies')) {
        assert.equal(request.headers().authorization, 'Bearer synthetic-creator-token')
        if (url.pathname.endsWith('/readiness')) {
          assert.equal(request.method(), 'GET')
          readinessCalls++
          if (readinessFails) { readinessFails = false; return respond(503, { message: 'Diagnostic unavailable' }) }
          return respond(200, { companyId: 'synthetic-company', status: 'DRAFT', activationAllowed: false,
            administrators: { total: admins.length, preparedWithMfa: 0, activeWithMfa: 0 },
            blockers: ['TENANT_ISOLATION_INCOMPLETE', 'SECURE_ADMIN_ONBOARDING_REQUIRED', 'PRODUCTION_BACKFILL_AND_ACCEPTANCE_REQUIRED'] })
        }
        if (url.pathname.endsWith('/invitation/revoke')) {
          assert.equal(request.method(), 'POST'); inviteActive = false
          if (admins.length) admins[0].inviteUsedAt = null
          return respond(201, { revoked: true, activationAllowed: false })
        }
        if (url.pathname.endsWith('/invitation')) {
          assert.equal(request.method(), 'POST'); inviteActive = true
          return respond(201, { token: inviteCode, expiresAt: '2026-10-06T15:00:00Z', activationAllowed: false })
        }
        if (url.pathname.endsWith('/admins')) {
          if (request.method() === 'GET') return respond(200, admins)
          assert.equal(request.method(), 'POST')
          const payload = request.postDataJSON()
          assert.deepEqual(Object.keys(payload).sort(), ['displayName', 'email'])
          if (adminFails) { adminFails = false; return respond(503, { message: 'Falha sintética. Tente novamente.' }) }
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
    await page.getByRole('button', { name: 'Salvar empresa e continuar' }).click()
    await page.getByRole('status').filter({ hasText: 'Empresa salva em rascunho' }).waitFor()
    await page.getByRole('heading', { name: 'Cadastrar administrador de Agência sintética' }).waitFor()
    assert.equal(await page.getByLabel('Nome do administrador', { exact: true }).inputValue(), 'Responsável sintético')
    assert.equal(await page.getByLabel('E-mail de acesso', { exact: true }).inputValue(), 'responsavel@example.invalid')
    assert.equal(await page.locator('#company-admin-title').evaluate(el => document.activeElement === el), true)
    assert.equal(await page.getByLabel('Senha inicial', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Cadastrar administrador pendente' }).click()
    await page.getByRole('alert').filter({ hasText: 'Falha sintética' }).waitFor()
    assert.equal(await page.getByLabel('Senha inicial', { exact: true }).count(), 0)
    assert.equal(writes.length, 1); assert.equal(admins.length, 0)
    await page.getByLabel('Nome do administrador', { exact: true }).fill('Administrador sintético')
    await page.getByLabel('E-mail de acesso', { exact: true }).fill('admin@example.invalid')
    assert.equal(await page.getByLabel('Senha inicial', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Cadastrar administrador pendente' }).click()
    await page.getByRole('heading', { name: 'Preparar convite de Agência sintética' }).waitFor()
    assert.equal(admins.length, 1); assert.equal(writes.length, 1)
    assert.equal(await page.getByLabel('Senha inicial', { exact: true }).count(), 0)
    assert.equal(inviteActive, false)
    await page.screenshot({ path: resolve(output, `creator-guided-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Concluir preparação' }).click()
    await page.getByRole('button', { name: 'Editar rascunho de Agência sintética' }).click()
    await page.getByLabel('Nome da empresa', { exact: false }).fill('Agência sintética revisada')
    await page.getByRole('button', { name: 'Salvar rascunho' }).click()
    await page.getByRole('heading', { name: 'Agência sintética revisada', exact: true }).waitFor()
    assert.equal(writes.length, 2)
    await page.getByRole('button', { name: 'Ver pendências de ativação de Agência sintética revisada' }).click()
    await page.getByRole('alert').filter({ hasText: 'Não foi possível consultar as pendências' }).waitFor()
    await page.getByRole('button', { name: 'Ver pendências de ativação de Agência sintética revisada' }).click()
    const readiness = page.getByRole('region', { name: 'Prontidão de Agência sintética revisada' })
    await readiness.getByText('Ativação indisponível', { exact: true }).waitFor()
    assert.equal(await readiness.locator('li').count(), 3)
    assert.equal(await readiness.getByText('Administradores cadastrados: 1. Com MFA preparado: 0.').count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Ativar empresa' }).count(), 0)
    assert.equal(readinessCalls, 2)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: resolve(output, `creator-readiness-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Administradores de Agência sintética revisada' }).click()
    await page.getByText('Administrador sintético', { exact: true }).waitFor()
    await page.getByText('Acesso inativo', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Gerar novo convite para Administrador sintético' }).click()
    await page.getByLabel('Código exibido somente nesta emissão').waitFor()
    assert.equal(await page.getByLabel('Código exibido somente nesta emissão').inputValue(), inviteCode)
    assert.equal(page.url().includes(inviteCode), false)
    await page.getByRole('button', { name: 'Revogar convite de Administrador sintético' }).click()
    await page.getByRole('status').filter({ hasText: 'Convite revogado' }).waitFor()
    assert.equal(await page.getByLabel('Código exibido somente nesta emissão').count(), 0)
    await page.getByRole('button', { name: 'Gerar novo convite para Administrador sintético' }).click()
    await page.getByLabel('Código exibido somente nesta emissão').waitFor()
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    assert.equal(storage.includes('Synthetic-password-only-for-test'), false)
    assert.equal(storage.includes(inviteCode), false)
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(dimensions.scroll <= dimensions.width + 1, `Creator overflow: ${JSON.stringify(dimensions)}`)
    assert.equal(await page.getByRole('button', { name: /Ativar empresa|Enviar convite/ }).count(), 0)
    await page.screenshot({ path: resolve(output, `creator-${width}.png`), fullPage: true })
    // Another browser has accepted the invitation but has not finished MFA.
    // The creator must be able to revoke it and reissue without reloading the page.
    admins[0].inviteUsedAt = '2026-10-08T12:00:00Z'
    inviteActive = false
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await page.getByRole('button', { name: 'Administradores de Agência sintética revisada' }).click()
    await page.getByRole('button', { name: 'Revogar preparação de Administrador sintético' }).click()
    await page.getByRole('status').filter({ hasText: 'Convite revogado' }).waitFor()
    await page.getByRole('button', { name: 'Gerar novo convite para Administrador sintético' }).waitFor()
    assert.equal(admins[0].inviteUsedAt, null)
    assert.equal(inviteActive, false)
    await page.getByRole('button', { name: 'Gerar novo convite para Administrador sintético' }).click()
    await page.getByLabel('Código exibido somente nesta emissão').waitFor()
    assert.equal(inviteActive, true)
    await page.getByRole('link', { name: 'Definir senha da empresa' }).click()
    await page.getByRole('heading', { name: 'Preparar acesso da empresa' }).waitFor()
    await page.getByLabel('Código do convite').fill(inviteCode)
    await page.getByLabel('Nova senha', { exact: true }).fill('Synthetic-invite-password-for-test')
    await page.getByLabel('Confirmar nova senha').fill('Synthetic-other-password-for-test')
    await page.getByRole('button', { name: 'Definir minha senha' }).click()
    await page.getByRole('alert').filter({ hasText: 'As senhas devem ser iguais' }).waitFor()
    assert.equal(accepted, 0)
    await page.getByLabel('Confirmar nova senha').fill('Synthetic-invite-password-for-test')
    await page.getByRole('button', { name: 'Definir minha senha' }).click()
    await page.getByRole('status').filter({ hasText: 'Seu acesso continua inativo' }).waitFor()
    assert.equal(accepted, 1)
    assert.equal(page.url().includes(inviteCode), false)
    assert.equal(await page.locator('input[type="password"]').count(), 0)
    const afterStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    assert.equal(afterStorage.includes(inviteCode), false)
    assert.equal(afterStorage.includes('Synthetic-invite-password-for-test'), false)
    const inviteDimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(inviteDimensions.scroll <= inviteDimensions.width + 1)
    await page.getByRole('button', { name: 'Retomar com minha senha' }).click()
    await page.getByLabel('E-mail de acesso', { exact: true }).fill('admin@example.invalid')
    await page.getByLabel('Senha definida', { exact: true }).fill('Synthetic-invite-password-for-test')
    await page.getByRole('button', { name: 'Retomar preparação' }).click()
    await page.getByRole('button', { name: 'Configurar autenticador' }).click()
    await page.getByLabel('Chave manual').waitFor()
    assert.equal(await page.getByLabel('Chave manual').inputValue(), manualKey)
    assert.equal(page.url().includes(onboardingCode), false)
    await page.getByLabel('Código do autenticador').fill('123456')
    await page.getByRole('button', { name: 'Confirmar autenticador' }).click()
    await page.getByRole('status').filter({ hasText: 'MFA configurado. Seu acesso continua inativo' }).waitFor()
    assert.equal(mfaConfirmed, true)
    await page.getByRole('heading', { name: 'Guarde os códigos de recuperação' }).waitFor()
    assert.equal(await page.locator('li code').count(), 10)
    const mfaStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    for (const secret of [onboardingCode, manualKey, 'ABCD-EFGH-0000']) assert.equal(mfaStorage.includes(secret), false)
    await page.getByRole('button', { name: 'Já guardei; ocultar códigos' }).click()
    assert.equal(await page.locator('li code').count(), 0)
    await page.screenshot({ path: resolve(output, `company-invite-${width}.png`), fullPage: true })
    await page.goto(`${base}/?screen=creator`)
    await page.reload()
    await page.getByRole('heading', { name: 'Agência sintética revisada', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Alterar minha senha', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Alterar minha senha' })
    await dialog.waitFor()
    await dialog.getByLabel('Senha atual', { exact: true }).fill('Synthetic-password-only-for-test')
    await dialog.getByLabel('Nova senha', { exact: true }).fill('Synthetic-new-password-for-test')
    await dialog.getByLabel('Confirmar nova senha', { exact: true }).fill('Synthetic-different-password-for-test')
    await dialog.getByRole('button', { name: 'Alterar senha e encerrar sessões' }).click()
    await dialog.getByRole('alert').filter({ hasText: 'devem ser iguais' }).waitFor(); assert.equal(passwordCalls, 0)
    await dialog.getByLabel('Senha atual', { exact: true }).fill('Synthetic-wrong-password')
    await dialog.getByLabel('Confirmar nova senha', { exact: true }).fill('Synthetic-new-password-for-test')
    await dialog.getByRole('button', { name: 'Alterar senha e encerrar sessões' }).click()
    await dialog.getByRole('alert').filter({ hasText: 'Confira a senha atual' }).waitFor()
    assert.equal(await dialog.getByLabel('Senha atual', { exact: true }).inputValue(), '')
    await dialog.getByLabel('Senha atual', { exact: true }).fill('Synthetic-password-only-for-test')
    await dialog.getByLabel('Nova senha', { exact: true }).fill('Synthetic-new-password-for-test')
    await dialog.getByLabel('Confirmar nova senha', { exact: true }).fill('Synthetic-new-password-for-test')
    await dialog.getByRole('button', { name: 'Alterar senha e encerrar sessões' }).click()
    await dialog.getByRole('status').filter({ hasText: 'Senha alterada' }).waitFor()
    assert.equal(passwordCalls, 2); assert.equal(await dialog.locator('input').count(), 0)
    const passwordStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    for (const secret of ['Synthetic-password-only-for-test', 'Synthetic-new-password-for-test']) {
      assert.equal(passwordStorage.includes(secret), false); assert.equal(page.url().includes(secret), false)
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.getByRole('button', { name: 'Entrar novamente', exact: true }).click()
    await page.getByRole('heading', { name: 'Área exclusiva do Criador' }).waitFor()
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
    await page.close(); checks++
  }
  console.log(`Creator: ${checks} responsive flows passed (guided company/admin preparation with failure recovery, login + MFA, draft edit, invite issue/revoke, password definition + MFA enrollment, self-service password change, no activation or stored secrets, session restore).`)
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
