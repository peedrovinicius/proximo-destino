import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  OutboundMessageStatus,
  PurchaseStatus,
  ReservationStatus,
  TripStatus,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

type QueueInput = {
  eventType: string
  idempotencyKey: string
  recipientPhone: string | null
  recipientName?: string | null
  body: string
  templateName?: string | null
  templateParams?: string[]
  sourceType?: string
  sourceId?: string
  scheduledAt?: Date
}

type ProviderConfig = {
  configured: boolean
  accessToken: string
  messagesUrl: string
  allowFreeform: boolean
  templateLanguage: string
}

@Injectable()
export class WhatsAppAutomationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsAppAutomationService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const enabled =
      this.config.get<string>('WHATSAPP_AUTOMATION_ENABLED')?.trim() !== 'false'

    if (!enabled) {
      this.logger.log('Automação do WhatsApp desativada por configuração')
      return
    }

    const initial = setTimeout(() => void this.tick(), 5_000)
    initial.unref()

    this.timer = setInterval(() => void this.tick(), 60_000)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private providerConfig(): ProviderConfig {
    const accessToken =
      this.config.get<string>('WHATSAPP_CLOUD_ACCESS_TOKEN')?.trim() ?? ''
    const directUrl =
      this.config.get<string>('WHATSAPP_CLOUD_MESSAGES_URL')?.trim() ?? ''
    const phoneNumberId =
      this.config.get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID')?.trim() ?? ''
    const graphVersion =
      this.config.get<string>('WHATSAPP_CLOUD_GRAPH_VERSION')?.trim() ?? ''

    const messagesUrl =
      directUrl ||
      (phoneNumberId && graphVersion
        ? `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`
        : '')

    return {
      configured: Boolean(accessToken && messagesUrl),
      accessToken,
      messagesUrl,
      allowFreeform:
        this.config.get<string>('WHATSAPP_ALLOW_FREEFORM')?.trim() === 'true',
      templateLanguage:
        this.config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE')?.trim() || 'pt_BR',
    }
  }

  async status() {
    const provider = this.providerConfig()
    const grouped = await this.prisma.outboundMessage.groupBy({
      by: ['status'],
      _count: { _all: true },
    })

    const counts = Object.fromEntries(
      grouped.map((item) => [item.status, item._count._all]),
    )

    return {
      enabled:
        this.config.get<string>('WHATSAPP_AUTOMATION_ENABLED')?.trim() !==
        'false',
      providerConfigured: provider.configured,
      deliveryMode: provider.configured
        ? 'WHATSAPP_CLOUD_API'
        : 'OUTBOX_ONLY',
      freeformEnabled: provider.allowFreeform,
      templateLanguage: provider.templateLanguage,
      templates: {
        reservationConfirmed: Boolean(
          this.templateName('RESERVATION_CONFIRMED'),
        ),
        paymentConfirmed: Boolean(this.templateName('PAYMENT_CONFIRMED')),
        reservationCancelled: Boolean(
          this.templateName('RESERVATION_CANCELLED'),
        ),
        tripReminder: Boolean(this.templateName('TRIP_REMINDER')),
        birthday: Boolean(this.templateName('BIRTHDAY')),
      },
      counts: {
        pending: counts.PENDING ?? 0,
        processing: counts.PROCESSING ?? 0,
        sent: counts.SENT ?? 0,
        failed: counts.FAILED ?? 0,
      },
    }
  }

  async recent(limit = 50) {
    return this.prisma.outboundMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        eventType: true,
        recipientPhone: true,
        recipientName: true,
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
    await this.scheduleRecurringMessages()
    const processed = await this.processPending()
    return { processed, ...(await this.status()) }
  }

  async enqueueReservationConfirmed(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        client: {
          select: { fullName: true, phone: true },
        },
        trip: {
          select: {
            title: true,
            departureDate: true,
            origin: true,
            destination: true,
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
    const firstName = this.firstName(reservation.client.fullName)
    const departure = this.formatDateTime(reservation.trip.departureDate)

    return this.enqueue({
      eventType: 'RESERVATION_CONFIRMED',
      idempotencyKey: `reservation-confirmed:${reservation.id}`,
      recipientPhone: reservation.client.phone,
      recipientName: reservation.client.fullName,
      body:
        `Olá, ${firstName}! Sua reserva para ${reservation.trip.title} está confirmada. ` +
        `Embarque: ${departure}, de ${reservation.trip.origin} para ${reservation.trip.destination}.` +
        (seats ? ` Poltrona(s): ${seats}.` : '') +
        ' Próximo Destino Turismo e Viagens.',
      templateName: this.templateName('RESERVATION_CONFIRMED'),
      templateParams: [
        firstName,
        reservation.trip.title,
        departure,
        reservation.trip.origin,
        reservation.trip.destination,
        seats || '-',
      ],
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
        reservation: {
          select: {
            id: true,
            client: {
              select: { fullName: true, phone: true },
            },
            trip: {
              select: { title: true },
            },
          },
        },
      },
    })

    if (!order || order.status !== PurchaseStatus.PAID) return null

    const firstName = this.firstName(order.reservation.client.fullName)
    const amount = this.formatMoney(order.totalCents)

    return this.enqueue({
      eventType: 'PAYMENT_CONFIRMED',
      idempotencyKey: `payment-confirmed:${order.id}`,
      recipientPhone: order.reservation.client.phone,
      recipientName: order.reservation.client.fullName,
      body:
        `Olá, ${firstName}! Confirmamos o pagamento de ${amount} referente a ` +
        `${order.reservation.trip.title}. Sua compra está registrada com a Próximo Destino.`,
      templateName: this.templateName('PAYMENT_CONFIRMED'),
      templateParams: [firstName, amount, order.reservation.trip.title],
      sourceType: 'PURCHASE_ORDER',
      sourceId: order.id,
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
          select: { fullName: true, phone: true },
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
    const firstName = this.firstName(reservation.client.fullName)
    const balanceText =
      balanceCents > 0
        ? ` Você possui ${this.formatMoney(balanceCents)} em bônus disponível.`
        : ''

    return this.enqueue({
      eventType: 'RESERVATION_CANCELLED',
      idempotencyKey: `reservation-cancelled:${reservation.id}`,
      recipientPhone: reservation.client.phone,
      recipientName: reservation.client.fullName,
      body:
        `Olá, ${firstName}. Sua reserva para ${reservation.trip.title} foi cancelada.` +
        balanceText +
        ' Se precisar, fale com a Próximo Destino.',
      templateName: this.templateName('RESERVATION_CANCELLED'),
      templateParams: [
        firstName,
        reservation.trip.title,
        balanceCents > 0 ? this.formatMoney(balanceCents) : 'R$ 0,00',
      ],
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  private async enqueueTripReminder(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        client: {
          select: { fullName: true, phone: true },
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

    const firstName = this.firstName(reservation.client.fullName)
    const departure = this.formatDateTime(reservation.trip.departureDate)
    const seats = reservation.seatAssignments
      .map((item) => item.seatNumber)
      .join(', ')

    return this.enqueue({
      eventType: 'TRIP_REMINDER',
      idempotencyKey: `trip-reminder-24h:${reservation.id}`,
      recipientPhone: reservation.client.phone,
      recipientName: reservation.client.fullName,
      body:
        `Olá, ${firstName}! Sua viagem ${reservation.trip.title} está próxima. ` +
        `Embarque: ${departure}, de ${reservation.trip.origin} para ${reservation.trip.destination}.` +
        (seats ? ` Poltrona(s): ${seats}.` : '') +
        ' Confira seus documentos e chegue com antecedência.',
      templateName: this.templateName('TRIP_REMINDER'),
      templateParams: [
        firstName,
        reservation.trip.title,
        departure,
        reservation.trip.origin,
        reservation.trip.destination,
        seats || '-',
      ],
      sourceType: 'RESERVATION',
      sourceId: reservation.id,
    })
  }

  private async enqueueBirthday(
    client: {
      id: string
      fullName: string
      phone: string | null
    },
    year: number,
  ) {
    const firstName = this.firstName(client.fullName)

    return this.enqueue({
      eventType: 'BIRTHDAY',
      idempotencyKey: `birthday:${client.id}:${year}`,
      recipientPhone: client.phone,
      recipientName: client.fullName,
      body:
        `Feliz aniversário, ${firstName}! A Próximo Destino deseja um novo ciclo cheio de boas experiências, saúde e viagens inesquecíveis.`,
      templateName: this.templateName('BIRTHDAY'),
      templateParams: [firstName],
      sourceType: 'CLIENT',
      sourceId: client.id,
    })
  }

  private async enqueue(input: QueueInput) {
    const phone = this.normalizePhone(input.recipientPhone)
    if (!phone) return null

    return this.prisma.outboundMessage.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        channel: 'WHATSAPP',
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        recipientPhone: phone,
        recipientName: input.recipientName?.trim() || null,
        body: input.body,
        templateName: input.templateName || null,
        templateLanguage:
          this.config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE')?.trim() ||
          'pt_BR',
        templateParams: input.templateParams ?? [],
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        scheduledAt: input.scheduledAt ?? new Date(),
      },
    })
  }

  private async tick() {
    if (this.running) return
    this.running = true

    try {
      const staleBefore = new Date(Date.now() - 10 * 60_000)
      await this.prisma.outboundMessage.updateMany({
        where: {
          status: OutboundMessageStatus.PROCESSING,
          lastAttemptAt: { lt: staleBefore },
        },
        data: {
          status: OutboundMessageStatus.FAILED,
          errorMessage: 'Processamento anterior interrompido',
        },
      })

      await this.scheduleRecurringMessages()
      await this.processPending()
    } catch (error) {
      this.logger.error(
        'Falha no ciclo automático do WhatsApp',
        error instanceof Error ? error.stack : String(error),
      )
    } finally {
      this.running = false
    }
  }

  private async scheduleRecurringMessages() {
    await Promise.all([
      this.scheduleTripReminders(),
      this.scheduleBirthdayMessages(),
    ])
  }

  private async scheduleTripReminders() {
    const now = new Date()
    const from = new Date(now.getTime() + 20 * 60 * 60_000)
    const to = new Date(now.getTime() + 28 * 60 * 60_000)

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.CONFIRMED,
        client: { phone: { not: null } },
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
  }

  private async scheduleBirthdayMessages() {
    const local = this.fortalezaParts(new Date())
    if (local.hour < 8) return

    const clients = await this.prisma.client.findMany({
      where: {
        phone: { not: null },
        birthDate: { not: null },
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        birthDate: true,
      },
      take: 5_000,
    })

    for (const client of clients) {
      if (!client.birthDate) continue
      const birthMonth = client.birthDate.getUTCMonth() + 1
      const birthDay = client.birthDate.getUTCDate()
      if (birthMonth !== local.month || birthDay !== local.day) continue
      await this.enqueueBirthday(client, local.year)
    }
  }

  private async processPending() {
    const provider = this.providerConfig()
    if (!provider.configured) return 0

    const messages = await this.prisma.outboundMessage.findMany({
      where: {
        status: {
          in: [OutboundMessageStatus.PENDING, OutboundMessageStatus.FAILED],
        },
        attempts: { lt: 5 },
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    })

    let processed = 0

    for (const message of messages) {
      const claimed = await this.prisma.outboundMessage.updateMany({
        where: {
          id: message.id,
          status: {
            in: [OutboundMessageStatus.PENDING, OutboundMessageStatus.FAILED],
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
        const providerMessageId = await this.sendMessage(message.id, provider)
        await this.prisma.outboundMessage.update({
          where: { id: message.id },
          data: {
            status: OutboundMessageStatus.SENT,
            sentAt: new Date(),
            providerMessageId,
            errorMessage: null,
          },
        })
      } catch (error) {
        const refreshed = await this.prisma.outboundMessage.findUnique({
          where: { id: message.id },
          select: { attempts: true },
        })
        const attempts = refreshed?.attempts ?? 1
        const backoffMinutes = Math.min(60, attempts * 5)

        await this.prisma.outboundMessage.update({
          where: { id: message.id },
          data: {
            status: OutboundMessageStatus.FAILED,
            errorMessage: this.errorText(error).slice(0, 700),
            scheduledAt: new Date(Date.now() + backoffMinutes * 60_000),
          },
        })
      }

      processed += 1
    }

    return processed
  }

  private async sendMessage(messageId: string, provider: ProviderConfig) {
    const message = await this.prisma.outboundMessage.findUniqueOrThrow({
      where: { id: messageId },
    })

    const params = Array.isArray(message.templateParams)
      ? message.templateParams
          .map((value) => String(value))
          .filter((value) => value.length > 0)
      : []

    let payload: Record<string, unknown>

    if (message.templateName) {
      payload = {
        messaging_product: 'whatsapp',
        to: message.recipientPhone,
        type: 'template',
        template: {
          name: message.templateName,
          language: {
            code: message.templateLanguage || provider.templateLanguage,
          },
          ...(params.length
            ? {
                components: [
                  {
                    type: 'body',
                    parameters: params.map((text) => ({
                      type: 'text',
                      text,
                    })),
                  },
                ],
              }
            : {}),
        },
      }
    } else if (provider.allowFreeform) {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.recipientPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: message.body,
        },
      }
    } else {
      throw new Error(
        `Template do evento ${message.eventType} não configurado e envio livre desativado`,
      )
    }

    const response = await fetch(provider.messagesUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const raw = await response.text()
    let parsed: {
      messages?: Array<{ id?: string }>
      error?: { message?: string; code?: number }
    } = {}

    try {
      parsed = raw ? JSON.parse(raw) : {}
    } catch {
      parsed = {}
    }

    if (!response.ok) {
      const reason =
        parsed.error?.message ||
        `Cloud API respondeu HTTP ${response.status}`
      throw new Error(reason)
    }

    return parsed.messages?.[0]?.id ?? null
  }

  private templateName(event: string) {
    return (
      this.config
        .get<string>(`WHATSAPP_TEMPLATE_${event}`)
        ?.trim() || null
    )
  }

  private normalizePhone(phone: string | null | undefined) {
    const digits = (phone ?? '').replace(/\D/g, '')
    if (!digits) return null

    const normalized = digits.startsWith('55') ? digits : `55${digits}`
    if (normalized.length < 12 || normalized.length > 13) return null
    return normalized
  }

  private firstName(fullName: string) {
    return fullName.trim().split(/\s+/)[0] || fullName.trim()
  }

  private formatDateTime(value: Date) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(value)
  }

  private formatMoney(cents: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100)
  }

  private fortalezaParts(value: Date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Fortaleza',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })

    const parts = Object.fromEntries(
      formatter
        .formatToParts(value)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )

    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
    }
  }

  private errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
