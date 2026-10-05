import 'reflect-metadata'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { INestApplication } from '@nestjs/common'
import { ValidationPipe, UnauthorizedException } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { CompaniesModule } from '../companies/companies.module'
import { AuthService } from '../auth/auth.service'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'

describe('company foundation HTTP boundary (synthetic database adapter)', () => {
  let app: INestApplication
  let base: string
  let enabled = true
  let active = true
  let mfa = true
  let sessionValid = true
  let writes: Record<string, unknown>[] = []
  const data = { tradeName: 'Empresa fictícia', slug: 'empresa-teste', contactEmail: 'contato@example.invalid',
    responsibleName: 'Responsável fictício', responsibleEmail: 'responsavel@example.invalid' }
  const adminData = { displayName: 'Administrador fictício', email: 'ADMIN@example.invalid', password: 'synthetic-password-12345' }
  const database = {
    user: { findUnique: async () => ({ role: 'CREATOR', isActive: active, mfaEnabled: mfa, mfaEnrolledAt: mfa ? new Date('2026-01-01') : null }),
      findFirst: async () => null,
      create: async (query: { data: Record<string, unknown> }) => { writes.push(query.data); return {
        id: 'pending-user', displayName: query.data.displayName, email: query.data.email, isActive: query.data.isActive,
      } },
    },
    companyMembership: { findMany: async () => [], create: async (query: { data: Record<string, unknown> }) => {
      writes.push(query.data); return { id: 'pending-membership', isActive: query.data.isActive }
    } },
    $queryRaw: async () => [{ id: 'synthetic-company' }],
    $transaction: async (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => callback(database),
    authSession: { findFirst: async (query: { where: Record<string, unknown> }) => {
      assert.equal(query.where.revokedAt, null)
      assert.ok(query.where.createdAt); assert.ok(query.where.expiresAt)
      return sessionValid ? { id: 'synthetic-session' } : null
    } },
    company: {
      findUnique: async () => ({ id: 'synthetic-company' }),
      findMany: async () => [],
      create: async (query: { data: Record<string, unknown> }) => { writes.push(query.data); return { ...query.data, id: 'synthetic-company' } },
      update: async (query: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        assert.deepEqual(query.where, { id: 'synthetic-company', status: 'DRAFT' })
        writes.push(query.data); return { ...query.data, id: 'synthetic-company', status: 'DRAFT' }
      },
    },
  }

  before(async () => {
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true,
      load: [() => ({ COMPANY_FOUNDATION_ENABLED: 'true' })] }), PrismaModule, CompaniesModule] })
      .overrideProvider(PrismaService).useValue(database)
      .overrideProvider(AuthService).useValue({ verifyAccessToken: async (token: string) => {
        if (!['CREATOR', 'ADMIN', 'AGENT', 'FINANCE', 'CLIENT'].includes(token)) throw new UnauthorizedException()
        return { id: 'synthetic-user', role: token, sessionId: 'synthetic-session' }
      } }).compile()
    // Config can be toggled without changing process-global env.
    const { ConfigService } = await import('@nestjs/config')
    module.get(ConfigService).get = (() => enabled ? 'true' : 'false') as never
    app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = await app.getUrl()
  })
  after(async () => { await app?.close() })

  function call(token?: string, body?: object, path = '') {
    return fetch(`${base}/platform/companies${path}`, { method: body ? path && !path.endsWith('/admins') ? 'PUT' : 'POST' : 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) })
  }

  it('rejects anonymous and invalid sessions', async () => {
    assert.equal((await call()).status, 401)
    assert.equal((await call('invalid')).status, 401)
  })
  for (const role of ['ADMIN', 'AGENT', 'FINANCE', 'CLIENT']) {
    it(`rejects ${role} for company creation, reading and editing`, async () => {
      const count = writes.length
      for (const response of [await call(role), await call(role, data), await call(role, data, '/synthetic-company')]) assert.equal(response.status, 403)
      assert.equal((await call(role, adminData, '/synthetic-company/admins')).status, 403)
      assert.equal((await call(role, undefined, '/synthetic-company/admins')).status, 403)
      assert.equal(writes.length, count)
    })
  }
  it('fails closed when foundation is disabled', async () => {
    enabled = false
    try { assert.equal((await call('CREATOR', data)).status, 403) } finally { enabled = true }
  })
  it('rejects inactive creator, missing MFA and pre-enrollment/revoked session', async () => {
    active = false; assert.equal((await call('CREATOR')).status, 403); active = true
    mfa = false; assert.equal((await call('CREATOR')).status, 403); mfa = true
    sessionValid = false; assert.equal((await call('CREATOR')).status, 403); sessionValid = true
  })
  it('creates only a draft with creator derived from the session', async () => {
    const response = await call('CREATOR', { ...data, contactEmail: ' CONTACT@example.invalid ' })
    assert.equal(response.status, 201)
    const saved = await response.json() as Record<string, unknown>
    assert.equal(saved.status, 'DRAFT'); assert.equal(saved.createdById, 'synthetic-user')
    assert.equal(saved.contactEmail, 'contact@example.invalid')
    assert.equal('memberships' in writes.at(-1)!, false)
  })
  it('rejects injected activation, ownership and membership fields before writes', async () => {
    for (const extra of [{ status: 'ACTIVE' }, { createdById: 'other' }, { memberships: [] }]) {
      const count = writes.length
      assert.equal((await call('CREATOR', { ...data, ...extra })).status, 400)
      assert.equal(writes.length, count)
    }
  })
  it('validates missing names, invalid email and URL unsafe slug', async () => {
    for (const invalid of [{ tradeName: ' ' }, { contactEmail: 'not-an-email' }, { slug: '../other' }, { responsibleName: '' }]) {
      assert.equal((await call('CREATOR', { ...data, ...invalid })).status, 400)
    }
  })
  it('edits only draft records and returns bounded listing', async () => {
    assert.equal((await call('CREATOR', data, '/synthetic-company')).status, 200)
    const response = await call('CREATOR'); assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), [])
  })
  it('creates only an inactive ADMIN account and membership, with no secret response', async () => {
    const response = await call('CREATOR', adminData, '/synthetic-company/admins')
    assert.equal(response.status, 201)
    const result = await response.json() as { user: { isActive: boolean }; isActive: boolean }
    assert.equal(result.user.isActive, false); assert.equal(result.isActive, false)
    assert.equal(JSON.stringify(result).includes('password'), false)
    assert.equal(writes.at(-2)!.role, 'ADMIN'); assert.equal(writes.at(-2)!.companyManaged, true)
    assert.equal(writes.at(-1)!.companyId, 'synthetic-company')
  })
  it('rejects short passwords, missing name, invalid email and injected privilege fields', async () => {
    for (const extra of [{ password: 'short' }, { displayName: '' }, { email: 'invalid' },
      { role: 'CREATOR' }, { isActive: true }, { companyId: 'other' }, { companyManaged: false }]) {
      const count = writes.length
      assert.equal((await call('CREATOR', { ...adminData, ...extra }, '/synthetic-company/admins')).status, 400)
      assert.equal(writes.length, count)
    }
    enabled = false
    try { assert.equal((await call('CREATOR', adminData, '/synthetic-company/admins')).status, 403) } finally { enabled = true }
  })
})
