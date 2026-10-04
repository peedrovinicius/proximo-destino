import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { TravelDocumentType, UserRole } from '@prisma/client'
import { AuthService } from '../auth/auth.service'
import { AuditService } from '../auth/audit.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { MfaService } from '../auth/mfa.service'
import { RolesGuard } from '../auth/roles.guard'
import { SessionService } from '../auth/session.service'
import { AdminDocumentsController } from '../documents/documents.controller'
import { DocumentsService } from '../documents/documents.service'
import { PrismaService } from '../prisma/prisma.service'
import { ClientPortalGuard } from '../portal/client-portal.guard'
import { PortalController } from '../portal/portal.controller'
import { PortalService } from '../portal/portal.service'
import { PaymentConnectionAdminController } from '../payments/payment-connection.controller'
import { PaymentConnectionService } from '../payments/payment-connection.service'
import { EmailAutomationController } from '../notifications/email-automation.controller'
import { EmailAutomationService } from '../notifications/email-automation.service'

// Exercises real HTTP routing, JWT verification, session checks and role filters.
// Persistence and external providers are simulated; this does not establish production behavior.
describe('autorização HTTP dos documentos e configurações de provedores', () => {
  let app: INestApplication
  let base: string
  const jwt = new JwtService()
  const secret = 'isolated-http-auth-test-secret'
  const config = new ConfigService({ JWT_ACCESS_SECRET: secret })
  const roles: Record<string, UserRole> = {
    admin: UserRole.ADMIN,
    agent: UserRole.AGENT,
    finance: UserRole.FINANCE,
    client: UserRole.CLIENT,
  }
  const revoked = new Set<string>()
  const providerCalls: string[] = []
  const providerMock = {
    status: () => { providerCalls.push('status'); return { configured: false } },
    begin: (actor: string) => { providerCalls.push(actor); return { testOnly: true } },
    beginOAuth: (actor: string) => { providerCalls.push(actor); return { testOnly: true } },
  }
  const documents = [
    { id: 'voucher', reservationId: 'reservation', type: TravelDocumentType.TRAVEL_VOUCHER },
    { id: 'receipt', reservationId: 'reservation', type: TravelDocumentType.PURCHASE_RECEIPT },
  ]
  type DocumentQuery = {
    where: {
      id?: string
      reservationId?: string
      type?: { in: TravelDocumentType[] }
      reservation?: { clientId: string }
    }
  }
  const matches = (query: DocumentQuery) => documents.filter((document) =>
    (!query.where.id || document.id === query.where.id) &&
    (!query.where.reservationId || document.reservationId === query.where.reservationId) &&
    (!query.where.type || query.where.type.in.includes(document.type)) &&
    (!query.where.reservation || query.where.reservation.clientId === 'client-a'),
  )
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        roles[where.id]
          ? { id: where.id, email: where.id + '@example.com', role: roles[where.id], isActive: true }
          : null,
    },
    authSession: {
      count: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === 'session-' + where.userId && !revoked.has(where.id) ? 1 : 0,
    },
    travelDocument: {
      findMany: async (query: DocumentQuery) => matches(query),
      findFirst: async (query: DocumentQuery) => matches(query)[0] ?? null,
    },
  } as unknown as PrismaService

  before(async () => {
    const auth = new AuthService(
      prisma, jwt, config, {} as MfaService,
      new SessionService(prisma, config), {} as AuditService,
    )
    const module = await Test.createTestingModule({
      controllers: [AdminDocumentsController, PortalController, PaymentConnectionAdminController, EmailAutomationController],
      providers: [
        JwtAuthGuard, RolesGuard,
        ClientPortalGuard,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        { provide: PortalService, useValue: {} },
        { provide: PaymentConnectionService, useValue: providerMock },
        { provide: EmailAutomationService, useValue: providerMock },
        { provide: AuthService, useValue: auth },
        { provide: DocumentsService, useValue: new DocumentsService(prisma, config) },
      ],
    }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    await app.listen(0, '127.0.0.1')
    base = await app.getUrl()
  })

  after(async () => { await app?.close() })

  const token = (user: string, overrides: Record<string, unknown> = {}) =>
    jwt.signAsync({
      sub: user, email: user + '@example.com', role: roles[user],
      sid: 'session-' + user, type: 'access', ...overrides,
    }, { secret, expiresIn: '1m' })

  async function request(path: string, accessToken?: string) {
    return fetch(base + '/api/v1/admin/documents/' + path, {
      headers: accessToken ? { Authorization: 'Bearer ' + accessToken } : {},
    })
  }

  it('nega leitura e alteração de provedores sem ADMIN, inclusive JWT com papel forjado', async () => {
    const routes = [
      ['GET', 'admin/payments/mercado-pago'],
      ['POST', 'admin/payments/mercado-pago/platform'],
      ['POST', 'admin/payments/mercado-pago/connect'],
      ['POST', 'admin/payments/mercado-pago/disconnect'],
      ['GET', 'admin/notifications/email/status'],
      ['POST', 'admin/notifications/email/oauth/connect'],
      ['POST', 'admin/notifications/email/connection'],
      ['DELETE', 'admin/notifications/email/connection'],
      ['PATCH', 'admin/notifications/email/connection/settings'],
      ['PATCH', 'admin/notifications/email/automation'],
      ['POST', 'admin/notifications/email/test'],
    ]
    const initialCalls = providerCalls.length
    for (const user of [null, 'agent', 'finance', 'client']) {
      const accessToken = user ? await token(user, { role: UserRole.ADMIN }) : null
      for (const [method, path] of routes) {
        const response = await fetch(base + '/api/v1/' + path, {
          method,
          headers: accessToken ? { Authorization: 'Bearer ' + accessToken } : {},
        })
        assert.equal(response.status, user ? 403 : 401, `${user}: ${method} ${path}`)
      }
    }
    assert.equal(providerCalls.length, initialCalls, 'Denied calls must not reach providers')
  })

  it('permite ADMIN consultar e iniciar conexão com o ator autenticado sem chamar provedores reais', async () => {
    const accessToken = await token('admin')
    const initialCalls = providerCalls.length
    for (const [method, path] of [
      ['GET', 'admin/payments/mercado-pago'],
      ['GET', 'admin/notifications/email/status'],
      ['POST', 'admin/payments/mercado-pago/connect'],
      ['POST', 'admin/notifications/email/oauth/connect'],
    ]) {
      const response = await fetch(base + '/api/v1/' + path, {
        method, headers: { Authorization: 'Bearer ' + accessToken },
      })
      assert.equal(response.status, method === 'POST' ? 201 : 200)
    }
    assert.deepEqual(providerCalls.slice(initialCalls), ['status', 'status', 'admin', 'admin'])
  })

  it('recusa token ausente, inválido e token de refresh', async () => {
    assert.equal((await request('reservation/reservation')).status, 401)
    assert.equal((await request('reservation/reservation', 'invalid')).status, 401)
    assert.equal((await request('reservation/reservation', await token('admin', { type: 'refresh' }))).status, 401)
  })

  for (const [user, expected] of [
    ['admin', ['receipt', 'voucher']],
    ['agent', ['voucher']],
    ['finance', ['receipt']],
  ] as const) {
    it('filtra a listagem HTTP para ' + user, async () => {
      const response = await request('reservation/reservation', await token(user))
      assert.equal(response.status, 200)
      const result = await response.json() as Array<{ id: string }>
      assert.deepEqual(result.map((item) => item.id).sort(), [...expected].sort())
    })
  }

  it('recusa CLIENT mesmo com JWT válido', async () => {
    assert.equal((await request('reservation/reservation', await token('client'))).status, 403)
  })

  it('nega CLIENT no serviço mesmo fora do controlador HTTP', async () => {
    const service = new DocumentsService(prisma, config)
    assert.deepEqual(await service.listByReservation('reservation', UserRole.CLIENT), [])
    await assert.rejects(
      () => service.renderAdminPdf('voucher', UserRole.CLIENT),
      (error: unknown) => error instanceof Error && 'getStatus' in error &&
        (error as { getStatus: () => number }).getStatus() === 404,
    )
  })

  it('recusa PDF fora do escopo de AGENT e FINANCE', async () => {
    assert.equal((await request('receipt/pdf', await token('agent'))).status, 404)
    assert.equal((await request('voucher/pdf', await token('finance'))).status, 404)
  })

  it('usa o papel atual do cadastro em vez do papel informado no JWT', async () => {
    const response = await request('reservation/reservation', await token('agent', { role: UserRole.ADMIN }))
    assert.equal(response.status, 200)
    const result = await response.json() as Array<{ id: string }>
    assert.deepEqual(result.map((item) => item.id), ['voucher'])
  })

  it('recusa sessão revogada e usuário inexistente', async () => {
    revoked.add('session-admin')
    try {
      assert.equal((await request('reservation/reservation', await token('admin'))).status, 401)
    } finally {
      revoked.delete('session-admin')
    }
    assert.equal((await request('reservation/reservation', await token('missing'))).status, 401)
  })

  async function clientPdf(clientId: string, reservationId: string, overrides: Record<string, unknown> = {}) {
    const accessToken = await jwt.signAsync({
      sub: clientId, rid: reservationId, type: 'client_portal', ...overrides,
    }, { secret, expiresIn: '1m' })
    return fetch(base + '/api/v1/client/documents/voucher/pdf', {
      headers: { Authorization: 'Bearer ' + accessToken },
    })
  }

  it('nega PDF pertencente a outro cliente', async () => {
    assert.equal((await clientPdf('client-b', 'reservation')).status, 404)
  })

  it('nega PDF de outra reserva mesmo para o mesmo cliente', async () => {
    assert.equal((await clientPdf('client-a', 'other-reservation')).status, 404)
  })

  it('nega token administrativo e token sem reserva no portal do viajante', async () => {
    assert.equal((await clientPdf('client-a', 'reservation', { type: 'access' })).status, 401)
    assert.equal((await clientPdf('client-a', 'reservation', { rid: '' })).status, 401)
  })
})
