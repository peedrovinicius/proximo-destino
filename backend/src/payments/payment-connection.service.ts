import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'

type OAuthTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  user_id?: number
  public_key?: string
  live_mode?: boolean
}

@Injectable()
export class PaymentConnectionService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async platformConfig() {
    const stored =
      await this.prisma.paymentPlatformConfig.findUnique({
        where: { provider: 'MERCADO_PAGO' },
      })

    if (stored) {
      return {
        source: 'DATABASE' as const,
        clientId: stored.clientId.trim(),
        clientSecret: this.decrypt(stored.clientSecretEncrypted),
        webhookSecret: this.decrypt(stored.webhookSecretEncrypted),
        configuredAt: stored.configuredAt,
      }
    }

    const clientId =
      this.config.get<string>('MERCADO_PAGO_CLIENT_ID')?.trim() ?? ''
    const clientSecret =
      this.config.get<string>('MERCADO_PAGO_CLIENT_SECRET')?.trim() ?? ''
    const webhookSecret =
      this.config.get<string>('MERCADO_PAGO_WEBHOOK_SECRET')?.trim() ?? ''

    return {
      source:
        clientId || clientSecret || webhookSecret
          ? ('ENVIRONMENT' as const)
          : ('NONE' as const),
      clientId,
      clientSecret,
      webhookSecret,
      configuredAt: null,
    }
  }

  async status() {
    const [connection, platform] = await Promise.all([
      this.prisma.paymentProviderConnection.findUnique({
        where: { provider: 'MERCADO_PAGO' },
      }),
      this.platformConfig(),
    ])
    const platformConfigured = Boolean(
      platform.clientId && platform.clientSecret,
    )
    const webhookConfigured = Boolean(platform.webhookSecret)
    const connected = Boolean(connection)

    return {
      provider: 'MERCADO_PAGO',
      platformConfigured,
      webhookConfigured,
      connected,
      readyForPayments:
        platformConfigured &&
        webhookConfigured &&
        connected,
      configurationSource: platform.source,
      configuredAt: platform.configuredAt,
      externalUserId: connection?.externalUserId ?? null,
      liveMode: connection?.liveMode ?? null,
      connectedAt: connection?.connectedAt ?? null,
      expiresAt: connection?.expiresAt ?? null,
    }
  }

  async configurePlatform(
    input: {
      clientId: string
      clientSecret: string
      webhookSecret: string
    },
    actorUserId: string,
  ) {
    const clientId = input.clientId.trim()
    const clientSecret = input.clientSecret.trim()
    const webhookSecret = input.webhookSecret.trim()

    if (!clientId) {
      throw new BadRequestException('Informe o Client ID do Mercado Pago')
    }
    if (clientSecret.length < 8) {
      throw new BadRequestException('Client Secret do Mercado Pago inválido')
    }
    if (webhookSecret.length < 8) {
      throw new BadRequestException('Segredo do webhook do Mercado Pago inválido')
    }

    await this.prisma.$transaction([
      this.prisma.paymentPlatformConfig.upsert({
        where: { provider: 'MERCADO_PAGO' },
        create: {
          provider: 'MERCADO_PAGO',
          clientId,
          clientSecretEncrypted: this.encrypt(clientSecret),
          webhookSecretEncrypted: this.encrypt(webhookSecret),
          configuredByUserId: actorUserId,
        },
        update: {
          clientId,
          clientSecretEncrypted: this.encrypt(clientSecret),
          webhookSecretEncrypted: this.encrypt(webhookSecret),
          configuredByUserId: actorUserId,
          configuredAt: new Date(),
        },
      }),
      this.prisma.paymentProviderConnection.deleteMany({
        where: { provider: 'MERCADO_PAGO' },
      }),
      this.prisma.paymentOAuthState.deleteMany({
        where: { provider: 'MERCADO_PAGO' },
      }),
      this.prisma.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_MERCADO_PAGO_PLATFORM_CONFIGURED',
          metadata: {
            provider: 'MERCADO_PAGO',
            clientIdLast4: clientId.slice(-4),
            webhookConfigured: true,
          },
        },
      }),
    ])

    return this.status()
  }

  async getWebhookSecret() {
    const platform = await this.platformConfig()
    return platform.webhookSecret || null
  }

  async begin(userId: string) {
    const platform = await this.platformConfig()
    if (!platform.clientId || !platform.clientSecret) {
      throw new ServiceUnavailableException('Mercado Pago ainda não está habilitado na plataforma')
    }
    const state = randomBytes(32).toString('base64url')
    await this.prisma.paymentOAuthState.create({
      data: {
        provider: 'MERCADO_PAGO',
        stateHash: this.hash(state),
        userId,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })
    const url = new URL('https://auth.mercadopago.com/authorization')
    url.searchParams.set('client_id', platform.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('platform_id', 'mp')
    url.searchParams.set('state', state)
    url.searchParams.set('redirect_uri', this.redirectUri())
    return { authorizationUrl: url.toString() }
  }

  async complete(code: string, state: string) {
    const platform = await this.platformConfig()
    if (!platform.clientId || !platform.clientSecret) {
      throw new ServiceUnavailableException(
        'Configuração central do Mercado Pago ausente',
      )
    }

    const stateHash = this.hash(state)
    const pending = await this.prisma.paymentOAuthState.findUnique({ where: { stateHash } })
    if (!pending || pending.usedAt || pending.expiresAt < new Date()) {
      throw new BadGatewayException('Autorização expirada ou inválida')
    }

    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: platform.clientId,
        client_secret: platform.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri(),
        test_token: false,
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) throw new BadGatewayException('Não foi possível concluir a conexão com o Mercado Pago')
    const token = await response.json() as OAuthTokenResponse
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null

    await this.prisma.$transaction([
      this.prisma.paymentProviderConnection.upsert({
        where: { provider: 'MERCADO_PAGO' },
        create: {
          provider: 'MERCADO_PAGO',
          externalUserId: token.user_id ? String(token.user_id) : null,
          accessTokenEncrypted: this.encrypt(token.access_token),
          refreshTokenEncrypted: token.refresh_token ? this.encrypt(token.refresh_token) : null,
          publicKey: token.public_key ?? null,
          scope: token.scope ?? null,
          liveMode: token.live_mode ?? true,
          expiresAt,
          connectedByUserId: pending.userId,
        },
        update: {
          externalUserId: token.user_id ? String(token.user_id) : null,
          accessTokenEncrypted: this.encrypt(token.access_token),
          refreshTokenEncrypted: token.refresh_token ? this.encrypt(token.refresh_token) : null,
          publicKey: token.public_key ?? null,
          scope: token.scope ?? null,
          liveMode: token.live_mode ?? true,
          expiresAt,
          connectedByUserId: pending.userId,
          connectedAt: new Date(),
        },
      }),
      this.prisma.paymentOAuthState.update({
        where: { id: pending.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.authAuditEvent.create({
        data: {
          userId: pending.userId,
          eventType: 'OPS_MERCADO_PAGO_CONNECTED',
          metadata: {
            provider: 'MERCADO_PAGO',
            externalUserId: token.user_id ? String(token.user_id) : null,
            liveMode: token.live_mode ?? true,
          },
        },
      }),
    ])
  }

  async disconnect(actorUserId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentProviderConnection.deleteMany({
        where: { provider: 'MERCADO_PAGO' },
      })

      if (actorUserId) {
        await tx.authAuditEvent.create({
          data: {
            userId: actorUserId,
            eventType: 'OPS_MERCADO_PAGO_DISCONNECTED',
            metadata: { provider: 'MERCADO_PAGO' },
          },
        })
      }
    })
    return { disconnected: true }
  }

  async getAccessToken() {
    const connection = await this.prisma.paymentProviderConnection.findUnique({ where: { provider: 'MERCADO_PAGO' } })
    if (!connection) throw new ServiceUnavailableException('Mercado Pago não conectado')
    if (!connection.expiresAt || connection.expiresAt.getTime() > Date.now() + 5 * 60_000) {
      return this.decrypt(connection.accessTokenEncrypted)
    }
    if (!connection.refreshTokenEncrypted) throw new ServiceUnavailableException('Reconecte o Mercado Pago')

    const platform = await this.platformConfig()
    if (!platform.clientId || !platform.clientSecret) {
      throw new ServiceUnavailableException(
        'Configuração central do Mercado Pago ausente',
      )
    }

    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: platform.clientId,
        client_secret: platform.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.decrypt(connection.refreshTokenEncrypted),
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) throw new BadGatewayException('Não foi possível renovar a conexão com o Mercado Pago')
    const token = await response.json() as OAuthTokenResponse
    await this.prisma.paymentProviderConnection.update({
      where: { provider: 'MERCADO_PAGO' },
      data: {
        accessTokenEncrypted: this.encrypt(token.access_token),
        refreshTokenEncrypted: token.refresh_token ? this.encrypt(token.refresh_token) : connection.refreshTokenEncrypted,
        expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : connection.expiresAt,
      },
    })
    return token.access_token
  }

  frontendResultUrl(status: 'success' | 'error') {
    const origin = this.config.getOrThrow<string>('FRONTEND_ORIGIN').replace(/\/$/, '')
    return `${origin}/?paymentConnection=${status}`
  }

  private redirectUri() {
    const override = this.config.get<string>('MERCADO_PAGO_OAUTH_REDIRECT_URI')?.trim()
    if (override) return override
    const domain = this.config.getOrThrow<string>('RAILWAY_PUBLIC_DOMAIN')
    return `https://${domain}/api/v1/payments/mercado-pago/oauth/callback`
  }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex') }
  private key() {
    const raw = this.config.get<string>('PAYMENTS_ENCRYPTION_KEY')?.trim() || this.config.getOrThrow<string>('MFA_ENCRYPTION_KEY')
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) throw new Error('PAYMENTS_ENCRYPTION_KEY deve conter 32 bytes em base64')
    return key
  }
  private encrypt(value: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
  }
  private decrypt(value: string) {
    const [iv, tag, encrypted] = value.split('.')
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
  }
}
