import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { UserRole } from '@prisma/client'
import { PaymentConnectionService } from '../payments/payment-connection.service'
import { PrismaService } from '../prisma/prisma.service'

describe('conexão OAuth do Mercado Pago', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const userId = `oauth-user-${suffix}`
  const encryptionKey = Buffer.alloc(32, 7).toString('base64')
  const service = new PaymentConnectionService(
    prisma,
    new ConfigService({
      MERCADO_PAGO_CLIENT_ID: 'app-test-123',
      MERCADO_PAGO_CLIENT_SECRET: 'secret-test',
      MERCADO_PAGO_WEBHOOK_SECRET: 'webhook-test',
      RAILWAY_PUBLIC_DOMAIN: 'api.example.test',
      FRONTEND_ORIGIN: 'https://app.example.test',
      MFA_ENCRYPTION_KEY: encryptionKey,
    }),
  )

  before(async () => {
    await prisma.$connect()
    await prisma.user.create({
      data: {
        id: userId,
        email: `oauth-${suffix}@example.com`,
        passwordHash: 'not-used',
        role: UserRole.ADMIN,
      },
    })
  })

  after(async () => {
    await prisma.paymentOAuthState.deleteMany({ where: { userId } })
    await prisma.paymentProviderConnection.deleteMany({
      where: { connectedByUserId: userId },
    })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it('gera autorização segura sem expor segredo', async () => {
    const result = await service.begin(userId)
    const url = new URL(result.authorizationUrl)

    assert.equal(url.origin, 'https://auth.mercadopago.com')
    assert.equal(url.pathname, '/authorization')
    assert.equal(url.searchParams.get('client_id'), 'app-test-123')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('platform_id'), 'mp')
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://api.example.test/api/v1/payments/mercado-pago/oauth/callback',
    )

    const state = url.searchParams.get('state')
    assert.ok(state)
    assert.equal(result.authorizationUrl.includes('secret-test'), false)

    const persisted = await prisma.paymentOAuthState.findFirst({
      where: { userId },
    })
    assert.ok(persisted)
    assert.notEqual(persisted?.stateHash, state)
    assert.ok((persisted?.expiresAt.getTime() ?? 0) > Date.now())
  })

  it('informa que a aplicação está pronta e a conta ainda não está conectada', async () => {
    const status = await service.status()
    assert.equal(status.platformConfigured, true)
    assert.equal(status.connected, false)
    assert.equal('accessToken' in status, false)
  })
})
