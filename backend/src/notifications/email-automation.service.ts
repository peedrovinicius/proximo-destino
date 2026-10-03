import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ManualPaymentStatus,
  OutboundMessageStatus,
  PurchaseStatus,
  ReservationStatus,
  TravelDocumentType,
  TripStatus,
  UserRole,
} from '@prisma/client'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'

type EmailQueueInput = {
  eventType: string
  idempotencyKey: string
  recipientEmail: string | null
  recipientName?: string | null
  subject: string
  textBody: string
  htmlBody?: string | null
  sourceType?: string
  sourceId?: string
  scheduledAt?: Date
  includeAdminCopy?: boolean
}

type ProviderConfig = {
  configured: boolean
  productionReady: boolean
  testOnly: boolean
  apiKey: string
  apiUrl: string
  from: string
  replyTo: string | null
  adminCopyEmail: string | null
  automationEnabled: boolean
  connectionSource: 'DATABASE' | 'ENVIRONMENT' | 'NONE'
  connectionMode: 'OAUTH' | 'API_KEY' | 'NONE'
  connectedAt: Date | null
  expiresAt: Date | null
  scope: string | null
}

type ResendOAuthToken = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

@Injectable()
export class EmailAutomationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EmailAutomationService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.bootstrapConnectionFromEnvironment()
    const verifyOnStart =
      this.config.get<string>('EMAIL_PROVIDER_VERIFY_ON_START')?.trim() ===
      'true'

    if (verifyOnStart) {
      const verification = setTimeout(
        () => void this.verifyProviderOnStart(),
        3_000,
      )
      verification.unref()
    }

    const provider = await this.providerConfig()
    if (!provider.automationEnabled) {
      this.logger.log('Automação de e-mail pausada')
    }

    const initial = setTimeout(() => void this.tick(), 7_000)
    initial.unref()

    this.timer = setInterval(() => void this.tick(), 60_000)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private async providerConfig(): Promise<ProviderConfig> {
    const connection =
      await this.prisma.emailProviderConnection.findUnique({
        where: { provider: 'RESEND' },
      })

    if (connection) {
      const credential = connection.accessTokenEncrypted
        ? await this.getOAuthAccessToken(connection)
        : connection.apiKeyEncrypted
          ? this.decrypt(connection.apiKeyEncrypted)
          : ''
      const from = connection.fromName?.trim()
        ? `${connection.fromName.trim()} <${connection.fromEmail}>`
        : connection.fromEmail
      const testOnly = /@resend\.dev(?:>|\s|$)/i.test(from)

      return {
        configured: Boolean(credential && from),
        productionReady: Boolean(credential && from && !testOnly),
        testOnly,
        apiKey: credential,
        apiUrl:
          this.config.get<string>('RESEND_API_URL')?.trim() ||
          'https://api.resend.com/emails',
        from,
        replyTo: connection.replyToEmail,
        adminCopyEmail: connection.adminCopyEmail,
        automationEnabled: connection.automationEnabled,
        connectionSource: 'DATABASE',
        connectionMode: connection.accessTokenEncrypted
          ? 'OAUTH'
          : connection.apiKeyEncrypted
            ? 'API_KEY'
            : 'NONE',
        connectedAt: connection.connectedAt,
        expiresAt: connection.expiresAt,
        scope: connection.scope,
      }
    }

    const apiKey =
      this.config.get<string>('RESEND_API_KEY')?.trim() ?? ''
    const from =
      this.config.get<string>('EMAIL_FROM')?.trim() ?? ''
    const replyTo =
      this.config.get<string>('EMAIL_REPLY_TO')?.trim() ||
      this.config.get<string>('ADMIN_EMAIL')?.trim() ||
      null
    const adminCopyEmail =
      this.normalizeEmail(
        this.config.get<string>('ADMIN_EMAIL')?.trim(),
      )
    const testOnly = /@resend\.dev(?:>|\s|$)/i.test(from)

    return {
      configured: Boolean(apiKey && from),
      productionReady: Boolean(apiKey && from && !testOnly),
      testOnly,
      apiKey,
      apiUrl:
        this.config.get<string>('RESEND_API_URL')?.trim() ||
        'https://api.resend.com/emails',
      from,
      replyTo,
      adminCopyEmail,
      automationEnabled:
        this.config
          .get<string>('EMAIL_AUTOMATION_ENABLED')
          ?.trim() !== 'false',
      connectionSource: apiKey && from ? 'ENVIRONMENT' : 'NONE',
      connectionMode: apiKey && from ? 'API_KEY' : 'NONE',
      connectedAt: null,
      expiresAt: null,
      scope: null,
    }
  }

  private async bootstrapConnectionFromEnvironment() {
    const existing =
      await this.prisma.emailProviderConnection.findUnique({
        where: { provider: 'RESEND' },
        select: { id: true },
      })
    if (existing) return

    const apiKey =
      this.config.get<string>('RESEND_API_KEY')?.trim() ?? ''
    const rawFrom =
      this.config.get<string>('EMAIL_FROM')?.trim() ?? ''
    if (!apiKey || !rawFrom) return

    const parsed = this.parseFrom(rawFrom)
    if (!parsed.email) return

    await this.prisma.emailProviderConnection.create({
      data: {
        provider: 'RESEND',
        apiKeyEncrypted: this.encrypt(apiKey),
        fromName: parsed.name,
        fromEmail: parsed.email,
        replyToEmail: this.normalizeEmail(
          this.config.get<string>('EMAIL_REPLY_TO')?.trim(),
        ),
        adminCopyEmail: this.normalizeEmail(
          this.config.get<string>('ADMIN_EMAIL')?.trim(),
        ),
        automationEnabled:
          this.config
            .get<string>('EMAIL_AUTOMATION_ENABLED')
            ?.trim() !== 'false',
      },
    })
  }

  async connectProvider(
    input: {
      apiKey: string
      fromName?: string
      fromEmail: string
      replyToEmail?: string
      adminCopyEmail?: string
    },
    actorUserId: string,
  ) {
    const apiKey = input.apiKey.trim()
    const fromEmail = this.normalizeEmail(input.fromEmail)
    const replyToEmail = this.normalizeEmail(input.replyToEmail)
    const adminCopyEmail = this.normalizeEmail(input.adminCopyEmail)

    if (!apiKey.startsWith('re_') || apiKey.length < 16) {
      throw new BadRequestException('Chave do Resend inválida')
    }
    if (!fromEmail) {
      throw new BadRequestException('E-mail remetente inválido')
    }
    if (input.replyToEmail?.trim() && !replyToEmail) {
      throw new BadRequestException('E-mail de resposta inválido')
    }
    if (input.adminCopyEmail?.trim() && !adminCopyEmail) {
      throw new BadRequestException('E-mail administrativo inválido')
    }

    await this.prisma.$transaction([
      this.prisma.emailProviderConnection.upsert({
        where: { provider: 'RESEND' },
        create: {
          provider: 'RESEND',
          apiKeyEncrypted: this.encrypt(apiKey),
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          scope: null,
          expiresAt: null,
          fromName: input.fromName?.trim() || null,
          fromEmail,
          replyToEmail,
          adminCopyEmail,
          automationEnabled: false,
          connectedByUserId: actorUserId,
        },
        update: {
          apiKeyEncrypted: this.encrypt(apiKey),
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          scope: null,
          expiresAt: null,
          fromName: input.fromName?.trim() || null,
          fromEmail,
          replyToEmail,
          adminCopyEmail,
          connectedByUserId: actorUserId,
          connectedAt: new Date(),
        },
      }),
      this.prisma.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_INTEGRATION_EMAIL_CONNECTED',
          metadata: {
            provider: 'RESEND',
            fromEmail,
            adminCopyConfigured: Boolean(adminCopyEmail),
          },
        },
      }),
    ])

    return this.status()
  }

  async disconnectProvider(actorUserId: string) {
    await this.prisma.$transaction([
      this.prisma.emailProviderConnection.deleteMany({
        where: { provider: 'RESEND' },
      }),
      this.prisma.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_INTEGRATION_EMAIL_DISCONNECTED',
          metadata: { provider: 'RESEND' },
        },
      }),
    ])

    return { disconnected: true }
  }

  async setAutomationEnabled(
    enabled: boolean,
    actorUserId: string,
  ) {
    const connection =
      await this.prisma.emailProviderConnection.findUnique({
        where: { provider: 'RESEND' },
      })
    if (!connection) {
      throw new BadRequestException(
        'Conecte o provedor de e-mail primeiro',
      )
    }

    const from = connection.fromName?.trim()
      ? `${connection.fromName.trim()} <${connection.fromEmail}>`
      : connection.fromEmail
    if (enabled && /@resend\.dev(?:>|\s|$)/i.test(from)) {
      throw new BadRequestException(
        'Verifique um domínio próprio no Resend antes de ativar envios para clientes',
      )
    }

    await this.prisma.$transaction([
      this.prisma.emailProviderConnection.update({
        where: { provider: 'RESEND' },
        data: { automationEnabled: enabled },
      }),
      this.prisma.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_INTEGRATION_EMAIL_AUTOMATION_UPDATED',
          metadata: {
            provider: 'RESEND',
            enabled,
          },
        },
      }),
    ])

    return this.status()
  }

  async status() {
    const provider = await this.providerConfig()
    const grouped = await this.prisma.emailOutboundMessage.groupBy({
      by: ['status'],
      _count: { _all: true },
    })

    const counts = Object.fromEntries(
      grouped.map((item) => [item.status, item._count._all]),
    )

    const parsedFrom = this.parseFrom(provider.from)

    return {
      enabled: provider.automationEnabled,
      connected: provider.connectionSource !== 'NONE',
      connectionSource: provider.connectionSource,
      connectionMode: provider.connectionMode,
      connectedAt: provider.connectedAt,
      expiresAt: provider.expiresAt,
      scope: provider.scope,
      from: provider.from || null,
      fromName: parsedFrom.name,
      fromEmail: parsedFrom.email,
      replyTo: provider.replyTo,
      adminCopyEmail: provider.adminCopyEmail,
      providerConfigured: provider.configured,
      productionReady: provider.productionReady,
      testOnly: provider.testOnly,
      deliveryMode: provider.configured
        ? provider.testOnly
          ? 'RESEND_TEST'
          : 'RESEND_API'
        : 'OUTBOX_ONLY',
      adminCopyConfigured: Boolean(
        provider.adminCopyEmail ||
          this.config.get<string>('ADMIN_EMAIL')?.trim(),
      ),
      fromConfigured: Boolean(provider.from),
      counts: {
        pending: counts.PENDING ?? 0,
        processing: counts.PROCESSING ?? 0,
        sent: counts.SENT ?? 0,
        failed: counts.FAILED ?? 0,
      },
    }
  }

  async recent(limit = 50) {
    return this.prisma.emailOutboundMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        eventType: true,
        recipientEmail: true,
        recipientName: true,
        adminCopyEmails: true,
        subject: true,
        sourceType: true,
        sourceId: true,
        status: true,
        attempts: true,
        scheduledAt: true,
        sentAt: true,
        providerMessageId: true,
        errorMessage: true,
        createdAt: true,
      },
    })
  }

  async processNow() {
    await this.scheduleRecurringEmails()
    const processed = await this.processPending()
    return { processed, ...(await this.status()) }
  }

  async sendTestEmail() {
    const provider = await this.providerConfig()
    const recipient =
      provider.adminCopyEmail ||
      this.normalizeEmail(
        this.config.get<string>('ADMIN_EMAIL')?.trim(),
      )

    if (!recipient) {
      return {
        queued: false,
        processed: 0,
        providerConfigured: provider.configured,
        status: null,
        message: 'ADMIN_EMAIL não configurado',
      }
    }

    const queued = await this.enqueue({
      eventType: 'EMAIL_TEST',
      idempotencyKey: `email:test:${randomUUID()}`,
      recipientEmail: recipient,
      recipientName: 'Administração',
      subject: 'Teste de e-mail — Próximo Destino',
      textBody:
        'Este é um teste do sistema de e-mails da Próximo Destino. Se esta mensagem chegou, o envio transacional está funcionando.',
      htmlBody: this.emailHtml(
        'E-mail funcionando',
        'Este é um teste do sistema de e-mails transacionais da Próximo Destino.',
        [
          ['Status', 'Configuração validada'],
          ['Ambiente', 'Produção'],
        ],
      ),
      sourceType: 'SYSTEM',
      sourceId: 'EMAIL_TEST',
      includeAdminCopy: false,
    })

    const processed = await this.processPending()
    const current = queued
      ? await this.prisma.emailOutboundMessage.findUnique({
          where: { id: queued.id },
          select: {
            status: true,
            providerMessageId: true,
            errorMessage: true,
          },
        })
      : null

    return {
      queued: Boolean(queued),
      processed,
      providerConfigured: provider.configured,
      status: current?.status ?? null,
      providerMessageId: current?.providerMessageId ?? null,
      errorMessage: current?.errorMessage ?? null,
    }
  }

  async enqueueReservationCreated(
    reservationId: string,
    accessCode?: string,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        client: {
          select: {
            fullName: true,
            email: true,
          },
        },
        trip: {
          select: {
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
          },
        },
        seatAssignments: {
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (!reservation) return null

    const seats = reservation.seatAssignments
      .map((item) => item.seatNumber)
      .join(', ')
    const codeText = accessCode
      ? ` Seu código de acesso é ${accessCode}.`
      : ''
    const details =
      `${reservation.trip.origin} → ${reservation.trip.destination}, ` +
      `${this.formatDateTime(reservation.trip.departureDate)}`

    return this.enqueue({
      eventType: 'RESERVATION_CREATED',
      idempotencyKey: `email:reservation-created:${reservation.id}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Recebemos sua reserva — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}! Recebemos sua reserva para ` +
        `${reservation.trip.title}. ${details}.` +
        (seats ? ` Poltrona(s): ${seats}.` : '') +
        codeText +
        ' Guarde este e-mail para acompanhar sua viagem com a Próximo Destino.',
      htmlBody: this.emailHtml(
        'Reserva recebida',
        `Recebemos sua reserva para <strong>${this.escape(reservation.trip.title)}</strong>.`,
        [
          ['Trajeto', details],
          ['Passageiros', String(reservation.passengerCount)],
          ...(seats ? [['Poltrona(s)', seats] as [string, string]] : []),
          ...(accessCode
            ? [['Código de acesso', accessCode] as [string, string]]
            : []),
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  async enqueueReservationConfirmed(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        client: {
          select: { fullName: true, email: true },
        },
        trip: {
          select: {
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
          },
        },
        seatAssignments: {
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (!reservation || reservation.status !== ReservationStatus.CONFIRMED) {
      return null
    }

    const seats = reservation.seatAssignments
      .map((item) => item.seatNumber)
      .join(', ')

    return this.enqueue({
      eventType: 'RESERVATION_CONFIRMED',
      idempotencyKey: `email:reservation-confirmed:${reservation.id}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Reserva confirmada — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}! Sua reserva para ` +
        `${reservation.trip.title} está confirmada. Embarque em ` +
        `${this.formatDateTime(reservation.trip.departureDate)}, de ` +
        `${reservation.trip.origin} para ${reservation.trip.destination}.` +
        (seats ? ` Poltrona(s): ${seats}.` : ''),
      htmlBody: this.emailHtml(
        'Reserva confirmada',
        `Sua reserva para <strong>${this.escape(reservation.trip.title)}</strong> está confirmada.`,
        [
          [
            'Embarque',
            this.formatDateTime(reservation.trip.departureDate),
          ],
          [
            'Trajeto',
            `${reservation.trip.origin} → ${reservation.trip.destination}`,
          ],
          ...(seats ? [['Poltrona(s)', seats] as [string, string]] : []),
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  async enqueuePaymentConfirmed(purchaseOrderId: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        status: true,
        totalCents: true,
        paymentMethod: true,
        reservation: {
          select: {
            id: true,
            client: {
              select: { fullName: true, email: true },
            },
            trip: {
              select: { title: true },
            },
          },
        },
      },
    })

    if (!order || order.status !== PurchaseStatus.PAID) return null

    const amount = this.formatMoney(order.totalCents)
    return this.enqueue({
      eventType: 'PAYMENT_CONFIRMED',
      idempotencyKey: `email:payment-confirmed:${order.id}`,
      recipientEmail: order.reservation.client.email,
      recipientName: order.reservation.client.fullName,
      subject: `Pagamento confirmado — ${order.reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(order.reservation.client.fullName)}! Confirmamos o pagamento de ` +
        `${amount} referente a ${order.reservation.trip.title}. Sua compra está registrada.`,
      htmlBody: this.emailHtml(
        'Pagamento confirmado',
        `Recebemos seu pagamento referente a <strong>${this.escape(order.reservation.trip.title)}</strong>.`,
        [
          ['Valor', amount],
          ['Método', order.paymentMethod],
          ['Reserva', '#' + order.reservation.id.slice(-8).toUpperCase()],
        ],
      ),
      sourceType: 'PURCHASE_ORDER',
      sourceId: order.id,
    })
  }

  async enqueueCancellationRequested(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        cancellationRequestStatus: true,
        cancellationRequestReason: true,
        client: {
          select: { fullName: true, email: true },
        },
        trip: {
          select: { title: true },
        },
      },
    })

    if (
      !reservation ||
      reservation.cancellationRequestStatus !== 'PENDING'
    ) {
      return null
    }

    return this.enqueue({
      eventType: 'CANCELLATION_REQUESTED',
      idempotencyKey: `email:cancellation-requested:${reservation.id}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Pedido de cancelamento recebido — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}. Recebemos seu pedido de cancelamento ` +
        `para ${reservation.trip.title}. A solicitação está aguardando análise da Próximo Destino.`,
      htmlBody: this.emailHtml(
        'Pedido de cancelamento recebido',
        `Sua solicitação referente a <strong>${this.escape(reservation.trip.title)}</strong> foi registrada e está aguardando análise.`,
        [
          [
            'Motivo informado',
            reservation.cancellationRequestReason || 'Não informado',
          ],
          ['Reserva', '#' + reservation.id.slice(-8).toUpperCase()],
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  async enqueueCancellationRejected(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        cancellationRequestStatus: true,
        cancellationRequestResolutionNote: true,
        client: {
          select: { fullName: true, email: true },
        },
        trip: {
          select: { title: true },
        },
      },
    })

    if (
      !reservation ||
      reservation.cancellationRequestStatus !== 'REJECTED'
    ) {
      return null
    }

    return this.enqueue({
      eventType: 'CANCELLATION_REJECTED',
      idempotencyKey: `email:cancellation-rejected:${reservation.id}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Atualização do cancelamento — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}. Seu pedido de cancelamento para ` +
        `${reservation.trip.title} foi analisado e não foi aprovado. Motivo: ` +
        `${reservation.cancellationRequestResolutionNote || 'consulte a Próximo Destino'}.`,
      htmlBody: this.emailHtml(
        'Atualização do cancelamento',
        `Sua solicitação referente a <strong>${this.escape(reservation.trip.title)}</strong> foi analisada e não foi aprovada.`,
        [
          [
            'Motivo',
            reservation.cancellationRequestResolutionNote ||
              'Consulte a Próximo Destino',
          ],
          ['Reserva', '#' + reservation.id.slice(-8).toUpperCase()],
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  async enqueueBonusUsed(
    reservationId: string,
    amountCents: number,
    balanceCents: number,
    eventKey: string,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        client: {
          select: { fullName: true, email: true },
        },
        trip: {
          select: { title: true },
        },
      },
    })

    if (!reservation) return null

    return this.enqueue({
      eventType: 'BONUS_USED',
      idempotencyKey: `email:bonus-used:${eventKey}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Bônus aplicado — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}! Aplicamos ` +
        `${this.formatMoney(amountCents)} do seu bônus em ${reservation.trip.title}. ` +
        `Saldo restante: ${this.formatMoney(balanceCents)}.`,
      htmlBody: this.emailHtml(
        'Bônus aplicado',
        `Seu bônus foi usado em <strong>${this.escape(reservation.trip.title)}</strong>.`,
        [
          ['Valor aplicado', this.formatMoney(amountCents)],
          ['Saldo restante', this.formatMoney(balanceCents)],
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  async enqueueQuoteSent(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        status: true,
        title: true,
        revision: true,
        totalCents: true,
        validUntil: true,
        reservation: {
          select: {
            id: true,
            client: {
              select: { fullName: true, email: true },
            },
            trip: {
              select: { title: true },
            },
          },
        },
      },
    })

    if (!quote || quote.status !== 'SENT') return null

    return this.enqueue({
      eventType: 'QUOTE_SENT',
      idempotencyKey: `email:quote-sent:${quote.id}:${quote.revision}`,
      recipientEmail: quote.reservation.client.email,
      recipientName: quote.reservation.client.fullName,
      subject: `Cotação disponível — ${quote.reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(quote.reservation.client.fullName)}! Sua cotação ` +
        `${quote.title} para ${quote.reservation.trip.title} está disponível. ` +
        `Valor: ${this.formatMoney(quote.totalCents)}.` +
        (quote.validUntil
          ? ` Validade: ${this.formatDate(quote.validUntil)}.`
          : ''),
      htmlBody: this.emailHtml(
        'Cotação disponível',
        `Sua cotação para <strong>${this.escape(quote.reservation.trip.title)}</strong> está disponível.`,
        [
          ['Cotação', quote.title],
          ['Valor', this.formatMoney(quote.totalCents)],
          ...(quote.validUntil
            ? [['Validade', this.formatDate(quote.validUntil)] as [string, string]]
            : []),
        ],
      ),
      sourceType: 'QUOTE',
      sourceId: quote.id,
    })
  }

  async enqueueReservationCancelled(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        clientId: true,
        client: {
          select: { fullName: true, email: true },
        },
        trip: {
          select: { title: true },
        },
      },
    })

    if (!reservation || reservation.status !== ReservationStatus.CANCELLED) {
      return null
    }

    const bonus = await this.prisma.clientCreditTransaction.aggregate({
      where: { clientId: reservation.clientId },
      _sum: { amountCents: true },
    })
    const balanceCents = Math.max(0, bonus._sum.amountCents ?? 0)

    return this.enqueue({
      eventType: 'RESERVATION_CANCELLED',
      idempotencyKey: `email:reservation-cancelled:${reservation.id}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Reserva cancelada — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}. Sua reserva para ` +
        `${reservation.trip.title} foi cancelada.` +
        (balanceCents > 0
          ? ` Seu saldo de bônus atual é ${this.formatMoney(balanceCents)}.`
          : ''),
      htmlBody: this.emailHtml(
        'Reserva cancelada',
        `A reserva para <strong>${this.escape(reservation.trip.title)}</strong> foi cancelada.`,
        [
          ...(balanceCents > 0
            ? [
                [
                  'Bônus disponível',
                  this.formatMoney(balanceCents),
                ] as [string, string],
              ]
            : []),
          ['Reserva', '#' + reservation.id.slice(-8).toUpperCase()],
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  async enqueueManualPaymentReceived(paymentId: string) {
    const payment = await this.prisma.manualPayment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        method: true,
        reference: true,
        paidAt: true,
        reservation: {
          select: {
            id: true,
            client: {
              select: { fullName: true, email: true },
            },
            trip: {
              select: { title: true },
            },
          },
        },
      },
    })

    if (!payment || payment.status !== ManualPaymentStatus.RECEIVED) {
      return null
    }

    const amount = this.formatMoney(payment.amountCents)
    return this.enqueue({
      eventType: 'MANUAL_PAYMENT_RECEIVED',
      idempotencyKey: `email:manual-payment-received:${payment.id}`,
      recipientEmail: payment.reservation.client.email,
      recipientName: payment.reservation.client.fullName,
      subject: `Recebimento registrado — ${payment.reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(payment.reservation.client.fullName)}! Registramos o recebimento de ` +
        `${amount} por ${this.manualMethod(payment.method)} referente a ` +
        `${payment.reservation.trip.title}.`,
      htmlBody: this.emailHtml(
        'Recebimento registrado',
        `O recebimento referente a <strong>${this.escape(payment.reservation.trip.title)}</strong> foi registrado.`,
        [
          ['Valor', amount],
          ['Método', this.manualMethod(payment.method)],
          ['Data', this.formatDateTime(payment.paidAt)],
          ...(payment.reference
            ? [['Referência', payment.reference] as [string, string]]
            : []),
        ],
      ),
      sourceType: 'MANUAL_PAYMENT',
      sourceId: payment.id,
    })
  }

  async enqueueManualPaymentReversed(paymentId: string) {
    const payment = await this.prisma.manualPayment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        method: true,
        reversedReason: true,
        reservation: {
          select: {
            id: true,
            client: {
              select: { fullName: true, email: true },
            },
            trip: {
              select: { title: true },
            },
          },
        },
      },
    })

    if (!payment || payment.status !== ManualPaymentStatus.REVERSED) {
      return null
    }

    return this.enqueue({
      eventType: 'MANUAL_PAYMENT_REVERSED',
      idempotencyKey: `email:manual-payment-reversed:${payment.id}`,
      recipientEmail: payment.reservation.client.email,
      recipientName: payment.reservation.client.fullName,
      subject: `Lançamento estornado — ${payment.reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(payment.reservation.client.fullName)}. O lançamento de ` +
        `${this.formatMoney(payment.amountCents)} por ${this.manualMethod(payment.method)} ` +
        `referente a ${payment.reservation.trip.title} foi estornado.`,
      htmlBody: this.emailHtml(
        'Lançamento estornado',
        `Um lançamento financeiro referente a <strong>${this.escape(payment.reservation.trip.title)}</strong> foi estornado.`,
        [
          ['Valor', this.formatMoney(payment.amountCents)],
          ['Método', this.manualMethod(payment.method)],
          [
            'Motivo',
            payment.reversedReason || 'Não informado',
          ],
        ],
      ),
      sourceType: 'MANUAL_PAYMENT',
      sourceId: payment.id,
    })
  }

  async enqueuePaymentRefunded(
    reservationId: string,
    refundedCents: number,
    eventKey: string,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        client: {
          select: { fullName: true, email: true },
        },
        trip: {
          select: { title: true },
        },
      },
    })

    if (!reservation) return null
    const amount = this.formatMoney(refundedCents)

    return this.enqueue({
      eventType: 'PAYMENT_REFUNDED',
      idempotencyKey: `email:payment-refunded:${eventKey}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Estorno registrado — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}. Registramos um estorno de ` +
        `${amount} referente a ${reservation.trip.title}.`,
      htmlBody: this.emailHtml(
        'Estorno registrado',
        `O estorno referente a <strong>${this.escape(reservation.trip.title)}</strong> foi registrado.`,
        [
          ['Valor', amount],
          ['Reserva', '#' + reservation.id.slice(-8).toUpperCase()],
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  async enqueueDocumentIssued(documentId: string) {
    const document = await this.prisma.travelDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        type: true,
        documentNumber: true,
        verificationCode: true,
        reservation: {
          select: {
            id: true,
            client: {
              select: { fullName: true, email: true },
            },
            trip: {
              select: { title: true },
            },
          },
        },
      },
    })

    if (!document) return null

    const label =
      document.type === TravelDocumentType.TRAVEL_VOUCHER
        ? 'Passagem / voucher'
        : 'Comprovante de compra'
    const verificationUrl = this.verificationUrl(document.verificationCode)

    return this.enqueue({
      eventType: 'DOCUMENT_ISSUED',
      idempotencyKey: `email:document-issued:${document.id}`,
      recipientEmail: document.reservation.client.email,
      recipientName: document.reservation.client.fullName,
      subject: `${label} emitido — ${document.reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(document.reservation.client.fullName)}! Seu ${label.toLowerCase()} ` +
        `${document.documentNumber} foi emitido para ${document.reservation.trip.title}. ` +
        `Verificação: ${verificationUrl}`,
      htmlBody: this.emailHtml(
        `${label} emitido`,
        `Seu documento referente a <strong>${this.escape(document.reservation.trip.title)}</strong> foi emitido.`,
        [
          ['Documento', document.documentNumber],
          ['Código de verificação', document.verificationCode],
          ['Verificar', verificationUrl],
        ],
      ),
      sourceType: 'TRAVEL_DOCUMENT',
      sourceId: document.id,
    })
  }

  private async enqueueTripReminder(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        client: {
          select: { fullName: true, email: true },
        },
        trip: {
          select: {
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
          },
        },
        seatAssignments: {
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (!reservation || reservation.status !== ReservationStatus.CONFIRMED) {
      return null
    }

    const seats = reservation.seatAssignments
      .map((item) => item.seatNumber)
      .join(', ')

    return this.enqueue({
      eventType: 'TRIP_REMINDER',
      idempotencyKey: `email:trip-reminder-24h:${reservation.id}`,
      recipientEmail: reservation.client.email,
      recipientName: reservation.client.fullName,
      subject: `Sua viagem está próxima — ${reservation.trip.title}`,
      textBody:
        `Olá, ${this.firstName(reservation.client.fullName)}! Sua viagem ` +
        `${reservation.trip.title} está próxima. Embarque em ` +
        `${this.formatDateTime(reservation.trip.departureDate)}, de ` +
        `${reservation.trip.origin} para ${reservation.trip.destination}.` +
        (seats ? ` Poltrona(s): ${seats}.` : '') +
        ' Confira seus documentos e chegue com antecedência.',
      htmlBody: this.emailHtml(
        'Sua viagem está próxima',
        `Falta pouco para <strong>${this.escape(reservation.trip.title)}</strong>.`,
        [
          [
            'Embarque',
            this.formatDateTime(reservation.trip.departureDate),
          ],
          [
            'Trajeto',
            `${reservation.trip.origin} → ${reservation.trip.destination}`,
          ],
          ...(seats ? [['Poltrona(s)', seats] as [string, string]] : []),
        ],
      ),
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  private async enqueueBirthday(
    client: {
      id: string
      fullName: string
      email: string | null
    },
    year: number,
  ) {
    const firstName = this.firstName(client.fullName)

    return this.enqueue({
      eventType: 'BIRTHDAY',
      idempotencyKey: `email:birthday:${client.id}:${year}`,
      recipientEmail: client.email,
      recipientName: client.fullName,
      subject: `Feliz aniversário, ${firstName}!`,
      textBody:
        `Feliz aniversário, ${firstName}! A Próximo Destino deseja um novo ciclo cheio de saúde, boas experiências e viagens inesquecíveis.`,
      htmlBody: this.emailHtml(
        `Feliz aniversário, ${firstName}!`,
        'A Próximo Destino deseja um novo ciclo cheio de saúde, boas experiências e viagens inesquecíveis.',
        [],
      ),
      sourceType: 'CLIENT',
      sourceId: client.id,
    })
  }

  private async enqueue(input: EmailQueueInput) {
    const adminCopies = input.includeAdminCopy === false
      ? []
      : await this.adminCopyEmails()
    const recipient = this.normalizeEmail(input.recipientEmail)
    const fallback = adminCopies[0] ?? null

    if (!recipient && !fallback) return null

    const actualRecipient = recipient ?? fallback!
    const copies = recipient
      ? adminCopies.filter((email) => email !== recipient)
      : adminCopies.filter((email) => email !== actualRecipient)

    return this.prisma.emailOutboundMessage.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        recipientEmail: actualRecipient,
        recipientName: input.recipientName?.trim() || null,
        adminCopyEmails: copies,
        subject: input.subject.trim(),
        textBody: input.textBody.trim(),
        htmlBody: input.htmlBody?.trim() || null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        scheduledAt: input.scheduledAt ?? new Date(),
      },
    })
  }

  private async adminCopyEmails() {
    const provider = await this.providerConfig()
    const configured = [
      provider.adminCopyEmail,
      this.config.get<string>('ADMIN_EMAIL')?.trim(),
      ...(this.config
        .get<string>('EMAIL_ADMIN_COPY')?.split(',')
        .map((value) => value.trim()) ?? []),
    ]
      .map((value) => this.normalizeEmail(value))
      .filter((value): value is string => Boolean(value))

    const admins = await this.prisma.user.findMany({
      where: {
        role: UserRole.ADMIN,
        isActive: true,
      },
      select: { email: true },
      take: 20,
    })

    return [...new Set([
      ...configured,
      ...admins
        .map((admin) => this.normalizeEmail(admin.email))
        .filter((value): value is string => Boolean(value)),
    ])]
  }

  private async tick() {
    if (this.running) return
    const provider = await this.providerConfig()
    if (!provider.automationEnabled) return
    this.running = true

    try {
      const staleBefore = new Date(Date.now() - 10 * 60_000)
      await this.prisma.emailOutboundMessage.updateMany({
        where: {
          status: OutboundMessageStatus.PROCESSING,
          lastAttemptAt: { lt: staleBefore },
        },
        data: {
          status: OutboundMessageStatus.FAILED,
          errorMessage: 'Processamento anterior interrompido',
        },
      })

      await this.scheduleRecurringEmails()
      await this.processPending()
    } catch (error) {
      this.logger.error(
        'Falha no ciclo automático de e-mail',
        error instanceof Error ? error.stack : String(error),
      )
    } finally {
      this.running = false
    }
  }

  private async scheduleRecurringEmails() {
    const now = new Date()
    const from = new Date(now.getTime() + 20 * 60 * 60_000)
    const to = new Date(now.getTime() + 28 * 60 * 60_000)

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.CONFIRMED,
        client: { email: { not: null } },
        trip: {
          status: { in: [TripStatus.ACTIVE, TripStatus.SCHEDULED] },
          departureDate: { gte: from, lte: to },
        },
      },
      select: { id: true },
      take: 200,
    })

    for (const reservation of reservations) {
      await this.enqueueTripReminder(reservation.id)
    }

    const local = this.fortalezaParts(now)
    if (local.hour < 8) return

    const clients = await this.prisma.client.findMany({
      where: {
        email: { not: null },
        birthDate: { not: null },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        birthDate: true,
      },
      take: 5_000,
    })

    for (const client of clients) {
      if (!client.birthDate) continue
      if (
        client.birthDate.getUTCMonth() + 1 !== local.month ||
        client.birthDate.getUTCDate() !== local.day
      ) {
        continue
      }
      await this.enqueueBirthday(client, local.year)
    }
  }

  private fortalezaParts(value: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Fortaleza',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(value)

    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0)

    return {
      year: read('year'),
      month: read('month'),
      day: read('day'),
      hour: read('hour'),
    }
  }

  private async processPending() {
    const provider = await this.providerConfig()
    if (!provider.configured) return 0

    const adminEmail =
      provider.adminCopyEmail ||
      this.normalizeEmail(
        this.config.get<string>('ADMIN_EMAIL')?.trim(),
      )

    const messages = await this.prisma.emailOutboundMessage.findMany({
      where: {
        status: {
          in: [
            OutboundMessageStatus.PENDING,
            OutboundMessageStatus.FAILED,
          ],
        },
        attempts: { lt: 5 },
        scheduledAt: { lte: new Date() },
        ...(provider.testOnly && adminEmail
          ? { recipientEmail: adminEmail }
          : provider.testOnly
            ? { id: '__no-test-recipient__' }
            : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    })

    let processed = 0

    for (const message of messages) {
      const claimed = await this.prisma.emailOutboundMessage.updateMany({
        where: {
          id: message.id,
          status: {
            in: [
              OutboundMessageStatus.PENDING,
              OutboundMessageStatus.FAILED,
            ],
          },
        },
        data: {
          status: OutboundMessageStatus.PROCESSING,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorMessage: null,
        },
      })

      if (!claimed.count) continue

      try {
        const providerMessageId = await this.sendMessage(
          message.id,
          provider,
        )
        await this.prisma.emailOutboundMessage.update({
          where: { id: message.id },
          data: {
            status: OutboundMessageStatus.SENT,
            sentAt: new Date(),
            providerMessageId,
            errorMessage: null,
          },
        })
      } catch (error) {
        const refreshed =
          await this.prisma.emailOutboundMessage.findUnique({
            where: { id: message.id },
            select: { attempts: true },
          })
        const attempts = refreshed?.attempts ?? 1
        const backoffMinutes = Math.min(60, attempts * 5)

        await this.prisma.emailOutboundMessage.update({
          where: { id: message.id },
          data: {
            status: OutboundMessageStatus.FAILED,
            errorMessage: this.errorText(error).slice(0, 700),
            scheduledAt: new Date(
              Date.now() + backoffMinutes * 60_000,
            ),
          },
        })
      }

      processed += 1
    }

    return processed
  }

  private async verifyProviderOnStart() {
    const provider = await this.providerConfig()
    const recipient =
      provider.adminCopyEmail ||
      this.normalizeEmail(
        this.config.get<string>('ADMIN_EMAIL')?.trim(),
      )

    if (!provider.configured) {
      this.logger.warn('EMAIL_PROVIDER_VERIFY provider_not_configured')
      return
    }

    if (!recipient) {
      this.logger.warn('EMAIL_PROVIDER_VERIFY admin_email_not_configured')
      return
    }

    try {
      const response = await fetch(provider.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: provider.from,
          to: [recipient],
          ...(provider.replyTo ? { reply_to: provider.replyTo } : {}),
          subject: 'Teste de e-mail — Próximo Destino',
          text:
            'Teste único de validação do provedor de e-mail da Próximo Destino.',
        }),
        signal: AbortSignal.timeout(12_000),
      })

      const raw = await response.text()
      let parsed: { id?: string; message?: string } = {}
      try {
        parsed = raw ? JSON.parse(raw) : {}
      } catch {
        parsed = {}
      }

      if (!response.ok) {
        this.logger.warn(
          `EMAIL_PROVIDER_VERIFY failed http=${response.status} message=${(
            parsed.message || 'provider_rejected'
          ).slice(0, 180)}`,
        )
        return
      }

      this.logger.log(
        `EMAIL_PROVIDER_VERIFY success provider_message_id=${
          parsed.id || 'unknown'
        }`,
      )
    } catch (error) {
      this.logger.warn(
        `EMAIL_PROVIDER_VERIFY failed message=${this.errorText(error).slice(
          0,
          180,
        )}`,
      )
    }
  }

  private async sendMessage(
    messageId: string,
    provider: ProviderConfig,
  ) {
    const message =
      await this.prisma.emailOutboundMessage.findUniqueOrThrow({
        where: { id: messageId },
      })

    const rawCopies = Array.isArray(message.adminCopyEmails)
      ? message.adminCopyEmails
      : []
    const bcc = rawCopies
      .map((value) => this.normalizeEmail(String(value)))
      .filter((value): value is string => Boolean(value))

    const response = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: provider.from,
        to: [message.recipientEmail],
        ...(bcc.length ? { bcc } : {}),
        ...(provider.replyTo ? { reply_to: provider.replyTo } : {}),
        subject: message.subject,
        text: message.textBody,
        ...(message.htmlBody ? { html: message.htmlBody } : {}),
      }),
      signal: AbortSignal.timeout(12_000),
    })

    const raw = await response.text()
    let parsed: {
      id?: string
      message?: string
      error?: { message?: string }
    } = {}

    try {
      parsed = raw ? JSON.parse(raw) : {}
    } catch {
      parsed = {}
    }

    if (!response.ok) {
      throw new Error(
        parsed.message ||
          parsed.error?.message ||
          `Resend respondeu HTTP ${response.status}`,
      )
    }

    return parsed.id || null
  }

  private normalizeEmail(value: string | null | undefined) {
    const email = value?.trim().toLowerCase() ?? ''
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return null
    }
    return email
  }

  private firstName(value: string) {
    return value.trim().split(/\s+/)[0] || value.trim()
  }

  private formatMoney(cents: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100)
  }

  private formatDateTime(value: Date) {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Fortaleza',
    }).format(value)
  }

  private formatDate(value: Date) {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeZone: 'America/Fortaleza',
    }).format(value)
  }

  private manualMethod(method: string) {
    if (method === 'CASH') return 'dinheiro'
    if (method === 'BOLETO') return 'boleto'
    return 'transferência'
  }

  private verificationUrl(code: string) {
    const base = this.config
      .get<string>('PUBLIC_API_URL', '')
      .replace(/\/$/, '')
    return base
      ? `${base}/public/documents/verify/${encodeURIComponent(code)}`
      : `PD-VERIFY:${code}`
  }

  private emailHtml(
    title: string,
    intro: string,
    rows: Array<[string, string]>,
  ) {
    const bodyRows = rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:7px 0;color:#6b7f8f;font-size:12px;width:34%">${this.escape(label)}</td><td style="padding:7px 0;color:#173f60;font-size:13px;font-weight:600">${this.escape(value)}</td></tr>`,
      )
      .join('')

    return `<!doctype html><html><body style="margin:0;background:#f5f7f9;font-family:Arial,sans-serif;color:#213b50"><div style="max-width:620px;margin:0 auto;padding:28px 16px"><div style="background:#ffffff;border:1px solid #e2e8ed;border-radius:18px;padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#5f7a8e">PRÓXIMO DESTINO</div><h1 style="font-size:24px;line-height:1.25;margin:14px 0 10px;color:#163a5f">${this.escape(title)}</h1><p style="font-size:14px;line-height:1.65;color:#536c7f">${intro}</p><table role="presentation" style="width:100%;border-collapse:collapse;margin-top:18px;border-top:1px solid #edf1f4">${bodyRows}</table><p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#82919d">Próximo Destino Turismo e Viagens · Este é um e-mail transacional sobre sua reserva.</p></div></div></body></html>`
  }

  private escape(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  private parseFrom(value: string) {
    const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
    if (match) {
      return {
        name: match[1]?.trim() || null,
        email: this.normalizeEmail(match[2]),
      }
    }
    return {
      name: null,
      email: this.normalizeEmail(value),
    }
  }

  private key() {
    const raw =
      this.config.get<string>('EMAIL_ENCRYPTION_KEY')?.trim() ||
      this.config.get<string>('PAYMENTS_ENCRYPTION_KEY')?.trim() ||
      this.config.getOrThrow<string>('MFA_ENCRYPTION_KEY')
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) {
      throw new Error(
        'EMAIL_ENCRYPTION_KEY deve conter 32 bytes em base64',
      )
    }
    return key
  }

  private encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ])
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64url'))
      .join('.')
  }

  private decrypt(value: string) {
    const [iv, tag, encrypted] = value.split('.')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }

  private errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
