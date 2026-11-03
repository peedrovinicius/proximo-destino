import {
  BadRequestException,
  BadGatewayException,
  Optional,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  CancellationRequestStatus,
  Prisma,
  PurchasePaymentMethod,
  PurchaseStatus,
  QuoteStatus,
  ReservationStatus,
  TripStatus,
} from '@prisma/client'
import * as argon2 from 'argon2'
import {
  InvalidWebhookSignatureError,
  MercadoPagoConfig,
  Order,
  Payment,
  WebhookSignatureValidator,
} from 'mercadopago'
import { randomBytes } from 'node:crypto'
import { EmailAutomationService } from '../notifications/email-automation.service'
import { WhatsAppAutomationService } from '../notifications/whatsapp-automation.service'
import { PaymentConnectionService } from '../payments/payment-connection.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  encryptedDocumentFields,
  revealDocument,
} from '../security/sensitive-data'
import {
  ClientPortalLoginDto,
  RequestReservationDto,
  UpdateClientPassengersDto,
  UpdateClientSeatsDto,
} from './dto/portal.dto'

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Optional() private readonly paymentConnection?: PaymentConnectionService,
    @Optional() private readonly whatsapp?: WhatsAppAutomationService,
    @Optional() private readonly email?: EmailAutomationService,
  ) {}

  private async safeWhatsApp(action: () => Promise<unknown> | undefined) {
    if (!this.whatsapp) return
    try {
      await action()
    } catch {
      // A comunicação não pode invalidar pagamento ou reserva.
    }
  }

  private async safeEmail(action: () => Promise<unknown> | undefined) {
    if (!this.email) return
    try {
      await action()
    } catch {
      // A comunicação não pode invalidar pagamento ou reserva.
    }
  }

  async paymentConfig() {
    const configured = this.paymentConnection
      ? (await this.paymentConnection.status()).readyForPayments
      : Boolean(
          this.config.get<string>('MERCADO_PAGO_ACCESS_TOKEN')?.trim() &&
          this.config.get<string>('MERCADO_PAGO_WEBHOOK_SECRET')?.trim(),
        )

    return {
      provider: 'MERCADO_PAGO',
      configured,
      methods: {
        PIX: configured,
        CARD: configured,
        BOLETO: false,
        TRANSFER: false,
      },
    }
  }

  private async mercadoPagoClient() {
    const accessToken = this.paymentConnection
      ? await this.paymentConnection.getAccessToken()
      : this.config.get<string>('MERCADO_PAGO_ACCESS_TOKEN')?.trim()

    if (!accessToken) {
      throw new ServiceUnavailableException(
        'Pagamento online ainda não está configurado',
      )
    }

    return new MercadoPagoConfig({
      accessToken,
      options: { timeout: 10_000 },
    })
  }

  private async canProcessOnlinePayment(method: string | undefined) {
    const config = await this.paymentConfig()
    return config.configured && (method === 'PIX' || method === 'CARD')
  }

  async requestReservation(data: RequestReservationDto) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: data.tripId,
        companyId: null,
        status: { in: [TripStatus.ACTIVE, TripStatus.SCHEDULED] },
        departureDate: { gte: new Date() },
      },
      select: {
        id: true,
        capacity: true,
        blockedSeats: true,
        priceCents: true,
      },
    })

    if (!trip) throw new NotFoundException('Viagem indisponível')

    const purchaseIntent = data.intent === 'PURCHASE'
    if (purchaseIntent) {
      if (trip.priceCents === null || trip.priceCents <= 0) {
        throw new BadRequestException(
          'Esta viagem ainda não possui preço disponível para compra online',
        )
      }

      if (!data.paymentMethod) {
        throw new BadRequestException(
          'Escolha uma forma de pagamento para continuar a compra',
        )
      }

      if (!(await this.canProcessOnlinePayment(data.paymentMethod))) {
        throw new ServiceUnavailableException(
          'Pagamento online ainda não está disponível',
        )
      }
    }

    const seatSelectionEnabled =
      trip.capacity !== null &&
      trip.capacity >= 1 &&
      trip.capacity <= 80

    const selectedSeats = [...(data.selectedSeats ?? [])].sort((a, b) => a - b)
    const providedPassengers = data.passengers?.map((passenger, index) => ({
      sequence: index + 1,
      fullName:
        index === 0
          ? data.fullName.trim()
          : passenger.fullName.trim(),
      document: passenger.document?.trim() || null,
    }))

    if (
      providedPassengers &&
      providedPassengers.length !== data.passengerCount
    ) {
      throw new BadRequestException(
        `Informe os dados dos ${data.passengerCount} passageiro(s)`,
      )
    }

    if (seatSelectionEnabled) {
      if (selectedSeats.length !== data.passengerCount) {
        throw new BadRequestException(
          `Selecione exatamente ${data.passengerCount} assento(s) para concluir a solicitação`,
        )
      }

      if (selectedSeats.some((seat) => seat < 1 || seat > (trip.capacity as number))) {
        throw new BadRequestException('Há um assento fora da capacidade desta viagem')
      }

      const blocked = selectedSeats.filter((seat) => trip.blockedSeats.includes(seat))
      if (blocked.length) {
        throw new ConflictException(
          `O(s) assento(s) ${blocked.join(', ')} está(ão) bloqueado(s) pela agência`,
        )
      }

      const occupied = await this.prisma.seatAssignment.findMany({
        where: {
          tripId: trip.id,
          seatNumber: { in: selectedSeats },
          reservation: { status: { not: ReservationStatus.CANCELLED } },
        },
        select: { seatNumber: true },
      })

      if (occupied.length) {
        throw new ConflictException(
          `O(s) assento(s) ${occupied.map((item) => item.seatNumber).join(', ')} não está(ão) mais disponível(is)`,
        )
      }
    } else if (selectedSeats.length) {
      throw new BadRequestException('Esta viagem não possui escolha de assentos')
    }

    const email = data.email.trim().toLowerCase()
    const accessCode = this.generateAccessCode()
    const accessCodeHash = await argon2.hash(accessCode)

    const client = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "email" = ${email} FOR UPDATE`
      const existingClient = await tx.client.findUnique({ where: { email }, select: { companyId: true } })
      if (existingClient?.companyId) throw new ConflictException('Não foi possível concluir a solicitação com estes dados')
      return tx.client.upsert({
        where: { email, companyId: null },
        update: {
          fullName: data.fullName.trim(),
          phone: data.phone.trim(),
        },
        create: {
          fullName: data.fullName.trim(),
          email,
          phone: data.phone.trim(),
        },
        select: { id: true },
      })
    })

    const existing = await this.prisma.reservation.findUnique({
      where: {
        clientId_tripId: {
          clientId: client.id,
          tripId: trip.id,
        },
      },
      select: { id: true },
    })

    if (existing) {
      throw new ConflictException('Já existe uma solicitação para este e-mail nesta viagem')
    }

    let reservation

    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        if (seatSelectionEnabled) {
          const latestTrip = await tx.trip.findUnique({
            where: { id: trip.id, companyId: null },
            select: { capacity: true, blockedSeats: true },
          })

          if (
            !latestTrip ||
            latestTrip.capacity === null ||
            selectedSeats.some(
              (seat) =>
                seat < 1 ||
                seat > latestTrip.capacity! ||
                latestTrip.blockedSeats.includes(seat),
            )
          ) {
            throw new ConflictException(
              'A disponibilidade dos assentos mudou. Atualize a seleção e tente novamente.',
            )
          }
        }

        const created = await tx.reservation.create({
          data: {
            clientId: client.id,
            tripId: trip.id,
            passengerCount: data.passengerCount,
            accessCodeHash,
          },
          select: {
            id: true,
            status: true,
            passengerCount: true,
            createdAt: true,
          },
        })

        const passengers: Array<{ id: string }> = []
        for (let index = 0; index < data.passengerCount; index += 1) {
          passengers.push(
            await tx.reservationPassenger.create({
              data: {
                reservationId: created.id,
                sequence: index + 1,
                fullName:
                  providedPassengers?.[index]?.fullName ??
                  (index === 0 ? data.fullName.trim() : null),
                ...encryptedDocumentFields(
                  providedPassengers?.[index]?.document ?? null,
                ),
                isPrimary: index === 0,
              },
              select: { id: true },
            }),
          )
        }

        if (purchaseIntent && trip.priceCents !== null && data.paymentMethod) {
          await tx.purchaseOrder.create({
            data: {
              reservationId: created.id,
              paymentMethod: data.paymentMethod as PurchasePaymentMethod,
              unitPriceCents: trip.priceCents,
              passengerCount: data.passengerCount,
              totalCents: trip.priceCents * data.passengerCount,
            },
          })
        }

        if (seatSelectionEnabled) {
          await tx.seatAssignment.createMany({
            data: selectedSeats.map((seatNumber, index) => ({
              tripId: trip.id,
              reservationId: created.id,
              passengerId: passengers[index]?.id,
              seatNumber,
            })),
          })
        }

        return created
      })
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === 'P2002'
      ) {
        const duplicateReservation = await this.prisma.reservation.findUnique({
          where: {
            clientId_tripId: {
              clientId: client.id,
              tripId: trip.id,
            },
          },
          select: { id: true },
        })

        if (duplicateReservation) {
          throw new ConflictException(
            'Já existe uma solicitação para este e-mail nesta viagem',
          )
        }

        throw new ConflictException(
          'Um dos assentos selecionados acabou de ser ocupado. Atualize a seleção e tente novamente.',
        )
      }

      throw cause
    }

    const passengers = await this.prisma.reservationPassenger.findMany({
      where: { reservationId: reservation.id },
      select: {
        id: true,
        sequence: true,
        fullName: true,
        document: true,
        documentEncrypted: true,
        isPrimary: true,
        seatAssignment: { select: { seatNumber: true } },
      },
      orderBy: { sequence: 'asc' },
    })

    const purchaseOrder = purchaseIntent
      ? await this.prisma.purchaseOrder.findUnique({
          where: { reservationId: reservation.id },
          select: {
            id: true,
            status: true,
            paymentMethod: true,
            unitPriceCents: true,
            passengerCount: true,
            totalCents: true,
            createdAt: true,
          },
        })
      : null

    let payment = null
    if (purchaseOrder) {
      try {
        payment = await this.initializePurchasePayment(purchaseOrder.id)
      } catch {
        payment = {
          provider: 'MERCADO_PAGO' as const,
          kind: 'UNAVAILABLE' as const,
          status: 'pending',
          message:
            'O pedido foi criado, mas o pagamento não pôde ser iniciado agora.',
        }
      }
    }

    await this.safeEmail(() =>
      this.email?.enqueueReservationCreated(
        reservation.id,
        accessCode,
      ),
    )

    return {
      reservation,
      accessCode,
      selectedSeats,
      passengers: passengers.map((passenger) => ({
        ...passenger,
        document: revealDocument(passenger),
        documentEncrypted: undefined,
      })),
      purchaseOrder,
      payment,
      message: purchaseIntent
        ? 'Pedido criado. Continue para concluir o pagamento.'
        : 'Solicitação recebida. Guarde o código para acessar sua viagem.',
    }
  }

  private async initializePurchasePayment(purchaseOrderId: string) {
    const purchase = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        reservation: {
          include: {
            client: true,
            trip: true,
          },
        },
      },
    })

    if (!purchase) {
      throw new NotFoundException('Pedido de compra não encontrado')
    }

    const client = await this.mercadoPagoClient()
    const webhookUrl = this.paymentWebhookUrl()

    if (purchase.paymentMethod === PurchasePaymentMethod.PIX) {
      const payment = new Payment(client)
      const response = await payment.create({
        body: {
          transaction_amount: purchase.totalCents / 100,
          description: purchase.reservation.trip.title.slice(0, 120),
          payment_method_id: 'pix',
          external_reference: purchase.id,
          notification_url: webhookUrl,
          date_of_expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
          payer: {
            email: purchase.reservation.client.email ?? undefined,
          },
        },
        requestOptions: {
          idempotencyKey: `${purchase.id}-pix`,
        },
      })

      await this.prisma.purchaseOrder.update({
        where: { id: purchase.id },
        data: {
          providerPaymentId:
            response.id !== undefined && response.id !== null
              ? String(response.id)
              : undefined,
          providerStatus: response.status ?? 'pending',
          lastReconciledAt: new Date(),
        },
      })

      const transaction = response.point_of_interaction?.transaction_data
      if (!transaction?.qr_code) {
        throw new BadGatewayException('O PIX não pôde ser gerado')
      }

      return {
        provider: 'MERCADO_PAGO' as const,
        kind: 'PIX' as const,
        status: response.status ?? 'pending',
        qrCode: transaction.qr_code,
        qrCodeBase64: transaction.qr_code_base64 ?? null,
        ticketUrl: transaction.ticket_url ?? null,
        expiresAt: response.date_of_expiration ?? null,
      }
    }

    if (purchase.paymentMethod === PurchasePaymentMethod.CARD) {
      const order = new Order(client)
      const total = (purchase.totalCents / 100).toFixed(2)
      const unit = (purchase.unitPriceCents / 100).toFixed(2)
      const frontend = this.frontendOrigin()
      const response = await order.create({
        body: {
          type: 'online',
          processing_mode: 'manual',
          capture_mode: 'automatic_async',
          total_amount: total,
          external_reference: purchase.id,
          expiration_time: 'PT30M',
          description: purchase.reservation.trip.title.slice(0, 120),
          payer: {
            email: purchase.reservation.client.email ?? undefined,
          },
          items: [
            {
              title: purchase.reservation.trip.title.slice(0, 120),
              unit_price: unit,
              quantity: purchase.passengerCount,
              unit_measure: 'unit',
              category_id: 'travels',
              type: 'travel',
              event_date: purchase.reservation.trip.departureDate.toISOString(),
            },
          ],
          config: {
            online: {
              callback_url: webhookUrl,
              success_url: `${frontend}/?payment=success`,
              pending_url: `${frontend}/?payment=pending`,
              failure_url: `${frontend}/?payment=failure`,
              auto_return: 'approved',
            },
            payment_method: {
              not_allowed_types: ['ticket', 'bank_transfer'],
            },
          },
        },
        requestOptions: {
          idempotencyKey: `${purchase.id}-checkout`,
        },
      })

      await this.prisma.purchaseOrder.update({
        where: { id: purchase.id },
        data: {
          providerOrderId: response.id ? String(response.id) : undefined,
          providerStatus: response.status ?? 'created',
          lastReconciledAt: new Date(),
        },
      })

      if (!response.checkout_url) {
        throw new BadGatewayException('O checkout não pôde ser iniciado')
      }

      return {
        provider: 'MERCADO_PAGO' as const,
        kind: 'CHECKOUT' as const,
        status: response.status ?? 'created',
        checkoutUrl: response.checkout_url,
      }
    }

    throw new BadRequestException('Forma de pagamento online inválida')
  }

  private async applyPurchaseStatus(
    purchaseOrderId: string,
    status: PurchaseStatus,
    provider: {
      paymentId?: string
      orderId?: string
      providerStatus?: string
    } = {},
  ) {
    const purchase = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        reservationId: true,
        paidAt: true,
        totalCents: true,
      },
    })

    if (!purchase) return { ignored: true }

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status,
          providerPaymentId: provider.paymentId,
          providerOrderId: provider.orderId,
          providerStatus: provider.providerStatus,
          lastReconciledAt: new Date(),
          paidAt:
            status === PurchaseStatus.PAID
              ? purchase.paidAt ?? new Date()
              : undefined,
        },
      })

      if (status === PurchaseStatus.PAID) {
        await tx.reservation.update({
          where: { id: purchase.reservationId },
          data: { status: ReservationStatus.CONFIRMED },
        })
        return
      }

      if (
        status === PurchaseStatus.CANCELLED ||
        status === PurchaseStatus.EXPIRED ||
        status === PurchaseStatus.REFUNDED
      ) {
        await tx.seatAssignment.deleteMany({
          where: { reservationId: purchase.reservationId },
        })
        await tx.reservation.update({
          where: { id: purchase.reservationId },
          data: { status: ReservationStatus.CANCELLED },
        })
      }
    })

    if (status === PurchaseStatus.PAID) {
      await this.safeWhatsApp(() =>
        this.whatsapp?.enqueuePaymentConfirmed(purchaseOrderId),
      )
      await this.safeWhatsApp(() =>
        this.whatsapp?.enqueueReservationConfirmed(purchase.reservationId),
      )
      await this.safeEmail(() =>
        this.email?.enqueuePaymentConfirmed(purchaseOrderId),
      )
      await this.safeEmail(() =>
        this.email?.enqueueReservationConfirmed(purchase.reservationId),
      )
    } else if (
      status === PurchaseStatus.CANCELLED ||
      status === PurchaseStatus.EXPIRED ||
      status === PurchaseStatus.REFUNDED
    ) {
      await this.safeWhatsApp(() =>
        this.whatsapp?.enqueueReservationCancelled(purchase.reservationId),
      )
      await this.safeEmail(() =>
        this.email?.enqueueReservationCancelled(purchase.reservationId),
      )
      if (status === PurchaseStatus.REFUNDED) {
        await this.safeEmail(() =>
          this.email?.enqueuePaymentRefunded(
            purchase.reservationId,
            purchase.totalCents,
            `webhook-full:${purchaseOrderId}`,
          ),
        )
      }
    }

    return { updated: true, status }
  }

  async handlePaymentWebhook(input: {
    type?: string
    action?: string
    dataId?: string
    xSignature?: string
    xRequestId?: string
  }) {
    const secret = this.paymentConnection
      ? await this.paymentConnection.getWebhookSecret()
      : this.config.get<string>('MERCADO_PAGO_WEBHOOK_SECRET')?.trim()

    if (!secret) {
      throw new ServiceUnavailableException(
        'Webhook de pagamento ainda não está configurado',
      )
    }

    try {
      WebhookSignatureValidator.validate({
        xSignature: input.xSignature,
        xRequestId: input.xRequestId,
        dataId: input.dataId,
        secret,
        toleranceSeconds: 300,
      })
    } catch (error) {
      if (
        error instanceof InvalidWebhookSignatureError ||
        error instanceof RangeError
      ) {
        throw new UnauthorizedException('Assinatura do webhook inválida')
      }
      throw error
    }

    if (!input.dataId) return { ignored: true }

    const client = await this.mercadoPagoClient()

    if (input.type === 'payment') {
      const payment = await new Payment(client).get({
        id: input.dataId,
      })

      const purchaseId = payment.external_reference
      if (!purchaseId) return { ignored: true }

      const purchase = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseId },
        select: { totalCents: true },
      })
      if (!purchase) return { ignored: true }

      const amountCents = Math.round((payment.transaction_amount ?? -1) * 100)
      if (amountCents !== purchase.totalCents) {
        return { ignored: true, reason: 'amount_mismatch' }
      }

      const status =
        payment.status === 'approved'
          ? PurchaseStatus.PAID
          : payment.status === 'refunded'
            ? PurchaseStatus.REFUNDED
            : ['cancelled', 'charged_back'].includes(
                  payment.status ?? '',
                )
              ? PurchaseStatus.CANCELLED
              : PurchaseStatus.PENDING_PAYMENT

      return this.applyPurchaseStatus(purchaseId, status, {
        paymentId: String(payment.id ?? input.dataId),
        providerStatus: payment.status ?? 'unknown',
      })
    }

    if (input.type === 'order' || input.action?.startsWith('order.')) {
      const order = await new Order(client).get({
        id: input.dataId,
      })

      const purchaseId = order.external_reference
      if (!purchaseId) return { ignored: true }

      const purchase = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseId },
        select: { totalCents: true },
      })
      if (!purchase) return { ignored: true }

      const amountCents = Math.round(Number(order.total_amount ?? '-1') * 100)
      if (amountCents !== purchase.totalCents) {
        return { ignored: true, reason: 'amount_mismatch' }
      }

      const status =
        order.status === 'processed' && order.status_detail === 'accredited'
          ? PurchaseStatus.PAID
          : order.status === 'expired'
            ? PurchaseStatus.EXPIRED
            : order.status === 'refunded'
              ? PurchaseStatus.REFUNDED
              : order.status === 'canceled'
                ? PurchaseStatus.CANCELLED
                : PurchaseStatus.PENDING_PAYMENT

      return this.applyPurchaseStatus(purchaseId, status, {
        orderId: String(order.id ?? input.dataId),
        providerStatus: [order.status, order.status_detail]
          .filter(Boolean)
          .join(':'),
      })
    }

    return { ignored: true }
  }

  private paymentWebhookUrl() {
    const override =
      this.config.get<string>('MERCADO_PAGO_WEBHOOK_URL')?.trim()
    if (override) return override

    const publicDomain =
      this.config.get<string>('RAILWAY_PUBLIC_DOMAIN')?.trim()

    if (!publicDomain) {
      throw new ServiceUnavailableException(
        'URL pública do webhook de pagamento não configurada',
      )
    }

    return `https://${publicDomain}/api/v1/payments/mercado-pago/webhook`
  }

  private frontendOrigin() {
    return this.config
      .getOrThrow<string>('FRONTEND_ORIGIN')
      .replace(/\/$/, '')
  }

  async retryPayment(clientId: string, reservationId: string) {
    const purchase = await this.prisma.purchaseOrder.findFirst({
      where: {
        reservationId,
        reservation: { clientId },
      },
      select: {
        id: true,
        status: true,
      },
    })

    if (!purchase) {
      throw new NotFoundException('Pedido de compra não encontrado')
    }

    if (purchase.status === PurchaseStatus.PAID) {
      return {
        provider: 'MERCADO_PAGO' as const,
        kind: 'PAID' as const,
        status: 'approved',
      }
    }

    return this.initializePurchasePayment(purchase.id)
  }

  async login(data: ClientPortalLoginDto) {
    const email = data.email.trim().toLowerCase()
    const reservations = await this.prisma.reservation.findMany({
      where: {
        companyId: null,
        client: { email, companyId: null },
        trip: { companyId: null },
        accessCodeHash: { not: null },
      },
      select: {
        id: true,
        clientId: true,
        accessCodeHash: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    for (const reservation of reservations) {
      if (
        reservation.accessCodeHash &&
        await argon2.verify(
          reservation.accessCodeHash,
          data.code.trim().toUpperCase(),
        )
      ) {
        const accessToken = await this.jwt.signAsync(
          {
            sub: reservation.clientId,
            rid: reservation.id,
            type: 'client_portal',
          },
          {
            secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
            expiresIn: '30m',
          },
        )

        return { accessToken }
      }
    }

    throw new UnauthorizedException('E-mail ou código da reserva inválido')
  }

  private async ensurePortalPassengers(
    clientId: string,
    reservationId: string,
  ) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, clientId },
      select: {
        id: true,
        passengerCount: true,
        client: { select: { fullName: true } },
        seatAssignments: {
          select: { id: true, passengerId: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')

    await this.prisma.$transaction(async (tx) => {
      for (let sequence = 1; sequence <= reservation.passengerCount; sequence += 1) {
        await tx.reservationPassenger.upsert({
          where: {
            reservationId_sequence: {
              reservationId,
              sequence,
            },
          },
          update: {},
          create: {
            reservationId,
            sequence,
            fullName: sequence === 1 ? reservation.client.fullName : null,
            isPrimary: sequence === 1,
          },
        })
      }

      const [passengers, assignments] = await Promise.all([
        tx.reservationPassenger.findMany({
          where: { reservationId },
          select: { id: true },
          orderBy: { sequence: 'asc' },
        }),
        tx.seatAssignment.findMany({
          where: { reservationId },
          select: { id: true, passengerId: true },
          orderBy: { seatNumber: 'asc' },
        }),
      ])

      const used = new Set(
        assignments
          .map((assignment) => assignment.passengerId)
          .filter((value): value is string => Boolean(value)),
      )
      const freePassengers = passengers.filter((passenger) => !used.has(passenger.id))
      const freeAssignments = assignments.filter(
        (assignment) => assignment.passengerId === null,
      )

      for (let index = 0; index < freeAssignments.length; index += 1) {
        const passenger = freePassengers[index]
        if (!passenger) break

        await tx.seatAssignment.update({
          where: { id: freeAssignments[index].id },
          data: { passengerId: passenger.id },
        })
      }
    })
  }

  async updateClientPassengers(
    clientId: string,
    reservationId: string,
    data: UpdateClientPassengersDto,
  ) {
    await this.ensurePortalPassengers(clientId, reservationId)

    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, clientId },
      select: {
        status: true,
        passengerCount: true,
        trip: { select: { departureDate: true } },
        passengers: {
          select: { id: true, isPrimary: true },
          orderBy: { sequence: 'asc' },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')

    const editable =
      reservation.trip.departureDate.getTime() > Date.now() &&
      reservation.status !== ReservationStatus.CANCELLED &&
      reservation.status !== ReservationStatus.COMPLETED

    if (!editable) {
      throw new ConflictException(
        'Os dados dos passageiros não podem mais ser alterados nesta viagem',
      )
    }

    if (data.passengers.length !== reservation.passengerCount) {
      throw new BadRequestException(
        `Informe exatamente ${reservation.passengerCount} passageiro(s)`,
      )
    }

    const expectedIds = new Set(
      reservation.passengers.map((passenger) => passenger.id),
    )
    const inputIds = data.passengers.map((passenger) => passenger.id)

    if (
      new Set(inputIds).size !== inputIds.length ||
      inputIds.some((id) => !expectedIds.has(id))
    ) {
      throw new BadRequestException(
        'A lista de passageiros não pertence a esta reserva',
      )
    }

    if (data.passengers.some((passenger) => !passenger.fullName.trim())) {
      throw new BadRequestException('Todos os passageiros devem ter nome')
    }

    if (
      data.passengers.some(
        (passenger) =>
          passenger.birthDate &&
          passenger.birthDate.getTime() > Date.now(),
      )
    ) {
      throw new BadRequestException(
        'A data de nascimento não pode estar no futuro',
      )
    }

    const primary = reservation.passengers.find(
      (passenger) => passenger.isPrimary,
    )
    const primaryInput = primary
      ? data.passengers.find((passenger) => passenger.id === primary.id)
      : null

    await this.prisma.$transaction(async (tx) => {
      for (const passenger of data.passengers) {
        await tx.reservationPassenger.update({
          where: { id: passenger.id },
          data: {
            fullName: passenger.fullName.trim(),
            ...encryptedDocumentFields(
              passenger.document?.trim() || null,
            ),
            birthDate: passenger.birthDate ?? null,
          },
        })
      }

      if (primaryInput) {
        await tx.client.update({
          where: { id: clientId },
          data: { fullName: primaryInput.fullName.trim() },
        })
      }
    })

    return this.getPortal(clientId, reservationId)
  }

  async updateClientSeats(
    clientId: string,
    reservationId: string,
    data: UpdateClientSeatsDto,
  ) {
    await this.ensurePortalPassengers(clientId, reservationId)

    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, clientId },
      select: {
        status: true,
        passengerCount: true,
        passengers: {
          select: { id: true, sequence: true },
          orderBy: { sequence: 'asc' },
        },
        trip: {
          select: {
            id: true,
            status: true,
            departureDate: true,
            capacity: true,
            blockedSeats: true,
          },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')

    const cutoffAt =
      reservation.trip.departureDate.getTime() - 24 * 60 * 60 * 1000
    const canChange =
      Date.now() < cutoffAt &&
      reservation.status !== ReservationStatus.CANCELLED &&
      reservation.status !== ReservationStatus.COMPLETED &&
      reservation.trip.status !== TripStatus.CANCELLED &&
      reservation.trip.status !== TripStatus.COMPLETED

    if (!canChange) {
      throw new ConflictException(
        'A troca de poltrona fica bloqueada nas 24 horas antes do embarque e após o encerramento da viagem',
      )
    }

    const capacity = reservation.trip.capacity
    if (capacity === null || capacity < 1 || capacity > 80) {
      throw new BadRequestException('Esta viagem não possui escolha de assentos')
    }

    const selectedSeats = [...data.selectedSeats].sort((a, b) => a - b)

    if (selectedSeats.length !== reservation.passengerCount) {
      throw new BadRequestException(
        `Selecione exatamente ${reservation.passengerCount} assento(s)`,
      )
    }

    if (
      selectedSeats.some((seat) => seat < 1 || seat > capacity) ||
      selectedSeats.some((seat) => reservation.trip.blockedSeats.includes(seat))
    ) {
      throw new ConflictException(
        'Um ou mais assentos selecionados não estão disponíveis',
      )
    }

    const occupied = await this.prisma.seatAssignment.findMany({
      where: {
        tripId: reservation.trip.id,
        reservationId: { not: reservationId },
        seatNumber: { in: selectedSeats },
        reservation: { status: { not: ReservationStatus.CANCELLED } },
      },
      select: { seatNumber: true },
    })

    if (occupied.length) {
      throw new ConflictException(
        `O(s) assento(s) ${occupied.map((item) => item.seatNumber).join(', ')} não está(ão) mais disponível(is)`,
      )
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const latestTrip = await tx.trip.findUnique({
          where: { id: reservation.trip.id },
          select: {
            capacity: true,
            blockedSeats: true,
            departureDate: true,
            status: true,
          },
        })

        if (
          !latestTrip ||
          latestTrip.capacity === null ||
          Date.now() >= latestTrip.departureDate.getTime() - 24 * 60 * 60 * 1000 ||
          latestTrip.status === TripStatus.CANCELLED ||
          latestTrip.status === TripStatus.COMPLETED ||
          selectedSeats.some(
            (seat) =>
              seat < 1 ||
              seat > latestTrip.capacity! ||
              latestTrip.blockedSeats.includes(seat),
          )
        ) {
          throw new ConflictException(
            'A disponibilidade dos assentos mudou. Atualize a viagem e tente novamente.',
          )
        }

        const latestOccupied = await tx.seatAssignment.findMany({
          where: {
            tripId: reservation.trip.id,
            reservationId: { not: reservationId },
            seatNumber: { in: selectedSeats },
            reservation: { status: { not: ReservationStatus.CANCELLED } },
          },
          select: { seatNumber: true },
        })

        if (latestOccupied.length) {
          throw new ConflictException(
            'Um dos assentos selecionados acabou de ser ocupado',
          )
        }

        const currentAssignments = await tx.seatAssignment.findMany({
          where: { reservationId },
          select: { id: true, passengerId: true, seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        })

        const selectedSet = new Set(selectedSeats)
        const retained = currentAssignments.filter((assignment) =>
          selectedSet.has(assignment.seatNumber),
        )
        const retainedPassengerIds = new Set(
          retained
            .map((assignment) => assignment.passengerId)
            .filter((id): id is string => Boolean(id)),
        )
        const retainedSeats = new Set(
          retained.map((assignment) => assignment.seatNumber),
        )
        const passengersToAssign = reservation.passengers.filter(
          (passenger) => !retainedPassengerIds.has(passenger.id),
        )
        const newSeats = selectedSeats.filter((seat) => !retainedSeats.has(seat))

        if (passengersToAssign.length !== newSeats.length) {
          throw new ConflictException(
            'Não foi possível preservar a distribuição atual dos passageiros',
          )
        }

        await tx.seatAssignment.deleteMany({
          where: {
            reservationId,
            seatNumber: { notIn: selectedSeats },
          },
        })

        for (let index = 0; index < newSeats.length; index += 1) {
          await tx.seatAssignment.create({
            data: {
              tripId: reservation.trip.id,
              reservationId,
              passengerId: passengersToAssign[index].id,
              seatNumber: newSeats[index],
            },
          })
        }
      })
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === 'P2002'
      ) {
        throw new ConflictException(
          'Um dos assentos selecionados acabou de ser ocupado. Atualize a seleção e tente novamente.',
        )
      }
      throw cause
    }

    return this.getPortal(clientId, reservationId)
  }

  async requestCancellation(
    clientId: string,
    reservationId: string,
    reason: string,
  ) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, clientId },
      select: {
        status: true,
        cancellationRequestStatus: true,
        trip: { select: { departureDate: true, status: true } },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    if (
      reservation.status === ReservationStatus.CANCELLED ||
      reservation.status === ReservationStatus.COMPLETED ||
      reservation.trip.status === TripStatus.CANCELLED ||
      reservation.trip.status === TripStatus.COMPLETED ||
      reservation.trip.departureDate.getTime() <= Date.now()
    ) {
      throw new ConflictException(
        'Esta viagem não está mais disponível para solicitação de cancelamento',
      )
    }

    if (reservation.cancellationRequestStatus === CancellationRequestStatus.PENDING) {
      throw new ConflictException(
        'Já existe uma solicitação de cancelamento aguardando análise',
      )
    }

    await this.prisma.reservation.update({
      where: { id: reservationId },
      data: {
        cancellationRequestStatus: CancellationRequestStatus.PENDING,
        cancellationRequestedAt: new Date(),
        cancellationRequestReason: reason.trim(),
        cancellationRequestResolvedAt: null,
        cancellationRequestResolutionNote: null,
        cancellationRequestResolvedByUserId: null,
      },
    })

    await this.safeEmail(() =>
      this.email?.enqueueCancellationRequested(reservationId),
    )

    return this.getPortal(clientId, reservationId)
  }

  async getPortal(clientId: string, reservationId: string) {
    await this.ensurePortalPassengers(clientId, reservationId)

    const reservation = await this.prisma.reservation.findFirst({
      where: {
        id: reservationId,
        clientId,
      },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        createdAt: true,
        cancellationRequestStatus: true,
        cancellationRequestedAt: true,
        cancellationRequestReason: true,
        cancellationRequestResolvedAt: true,
        cancellationRequestResolutionNote: true,
        passengers: {
          select: {
            id: true,
            sequence: true,
            fullName: true,
            document: true,
            documentEncrypted: true,
            birthDate: true,
            isPrimary: true,
            seatAssignment: { select: { seatNumber: true } },
          },
          orderBy: { sequence: 'asc' },
        },
        seatAssignments: {
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        },
        client: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            creditTransactions: {
              select: {
                id: true,
                type: true,
                amountCents: true,
                note: true,
                createdAt: true,
                reservation: {
                  select: {
                    id: true,
                    trip: {
                      select: {
                        title: true,
                        destination: true,
                      },
                    },
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
              take: 30,
            },
          },
        },
        trip: {
          select: {
            id: true,
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
            returnDate: true,
            priceCents: true,
            summary: true,
            imageUrl: true,
            status: true,
            capacity: true,
            busTemplate: true,
            seatLayout: true,
            deckCount: true,
            lowerDeckCapacity: true,
            vehicleFeatures: true,
            blockedSeats: true,
          },
        },
        quotes: {
          where: {
            status: { in: [QuoteStatus.SENT, QuoteStatus.APPROVED] },
          },
          select: {
            id: true,
            revision: true,
            status: true,
            title: true,
            validUntil: true,
            notes: true,
            subtotalSaleCents: true,
            discountCents: true,
            totalCents: true,
            sentAt: true,
            approvedAt: true,
            items: {
              select: {
                id: true,
                category: true,
                description: true,
                supplier: true,
                quantity: true,
                unitSaleCents: true,
                totalSaleCents: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { revision: 'desc' },
          take: 1,
        },
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            paymentMethod: true,
            unitPriceCents: true,
            passengerCount: true,
            totalCents: true,
            refundedCents: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        services: {
          select: {
            id: true,
            category: true,
            description: true,
            supplier: true,
            amountCents: true,
            status: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        financePlan: {
          select: {
            id: true,
            totalCents: true,
            downPaymentCents: true,
            installmentCount: true,
            refundedCents: true,
            installments: {
              select: {
                id: true,
                sequence: true,
                dueDate: true,
                amountCents: true,
                status: true,
                paidAt: true,
                paymentMethod: true,
              },
              orderBy: { sequence: 'asc' },
            },
          },
        },
        documents: {
          select: {
            id: true,
            type: true,
            version: true,
            documentNumber: true,
            issuedAt: true,
          },
          orderBy: { issuedAt: 'desc' },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')

    const { creditTransactions, ...client } = reservation.client
    const bonusBalanceCents = Math.max(
      0,
      creditTransactions.reduce(
        (sum, transaction) => sum + transaction.amountCents,
        0,
      ),
    )

    const seatMapEnabled =
      reservation.trip.capacity !== null &&
      reservation.trip.capacity >= 1 &&
      reservation.trip.capacity <= 80
    const seatChangeCutoffAt = new Date(
      reservation.trip.departureDate.getTime() - 24 * 60 * 60 * 1000,
    )
    const canChangeSeats =
      seatMapEnabled &&
      Date.now() < seatChangeCutoffAt.getTime() &&
      reservation.status !== ReservationStatus.CANCELLED &&
      reservation.status !== ReservationStatus.COMPLETED &&
      reservation.trip.status !== TripStatus.CANCELLED &&
      reservation.trip.status !== TripStatus.COMPLETED

    const externalAssignments = seatMapEnabled
      ? await this.prisma.seatAssignment.findMany({
          where: {
            tripId: reservation.trip.id,
            reservationId: { not: reservation.id },
            reservation: { status: { not: ReservationStatus.CANCELLED } },
          },
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        })
      : []

    const capacity = reservation.trip.capacity
    const blockedSeats =
      seatMapEnabled && capacity !== null
        ? reservation.trip.blockedSeats
            .filter((seat) => seat >= 1 && seat <= capacity)
            .sort((a, b) => a - b)
        : []
    const occupiedSeats = externalAssignments.map(
      (assignment) => assignment.seatNumber,
    )
    const unavailableSeats = new Set([...blockedSeats, ...occupiedSeats])
    const seatLayout =
      reservation.trip.seatLayout === 'TWO_BY_ONE'
        ? 'TWO_BY_ONE'
        : 'TWO_BY_TWO'
    const deckCount = reservation.trip.deckCount === 2 ? 2 : 1
    const lowerDeckCapacity =
      deckCount === 2 &&
      reservation.trip.lowerDeckCapacity !== null &&
      capacity !== null &&
      reservation.trip.lowerDeckCapacity > 0 &&
      reservation.trip.lowerDeckCapacity < capacity
        ? reservation.trip.lowerDeckCapacity
        : null

    const cancellationPaidCents = reservation.purchaseOrder
      ? Math.max(
          (
            reservation.purchaseOrder.status === PurchaseStatus.PAID ||
            reservation.purchaseOrder.status === PurchaseStatus.PARTIALLY_REFUNDED ||
            reservation.purchaseOrder.status === PurchaseStatus.REFUNDED
              ? reservation.purchaseOrder.totalCents
              : 0
          ) - reservation.purchaseOrder.refundedCents,
          0,
        )
      : Math.max(
          (reservation.financePlan?.installments
            .filter((item) => item.status === 'PAID')
            .reduce((sum, item) => sum + item.amountCents, 0) ?? 0) -
            (reservation.financePlan?.refundedCents ?? 0),
          0,
        )
    const canRequestCancellation =
      reservation.status !== ReservationStatus.CANCELLED &&
      reservation.status !== ReservationStatus.COMPLETED &&
      reservation.trip.status !== TripStatus.CANCELLED &&
      reservation.trip.status !== TripStatus.COMPLETED &&
      reservation.trip.departureDate.getTime() > Date.now() &&
      reservation.cancellationRequestStatus !== CancellationRequestStatus.PENDING

    return {
      ...reservation,
      passengers: reservation.passengers.map((passenger) => ({
        ...passenger,
        document: revealDocument(passenger),
        documentEncrypted: undefined,
      })),
      client,
      bonus: {
        balanceCents: bonusBalanceCents,
        transactions: creditTransactions,
      },
      canRequestCancellation,
      cancellationFinancial: {
        paidCents: cancellationPaidCents,
        reviewableCents: cancellationPaidCents,
      },
      canEditPassengers:
        reservation.trip.departureDate.getTime() > Date.now() &&
        reservation.status !== ReservationStatus.CANCELLED &&
        reservation.status !== ReservationStatus.COMPLETED,
      canChangeSeats,
      seatChangeCutoffAt,
      seatMap: {
        enabled: seatMapEnabled,
        capacity,
        busTemplate: reservation.trip.busTemplate,
        busLabel:
          reservation.trip.busTemplate === 'CUSTOM'
            ? capacity
              ? `Personalizado · ${capacity} lugares`
              : 'Personalizado'
            : capacity
              ? `Veículo · ${capacity} lugares`
              : null,
        seatLayout,
        deckCount,
        lowerDeckCapacity,
        vehicleFeatures: Array.isArray(reservation.trip.vehicleFeatures)
          ? reservation.trip.vehicleFeatures
          : [],
        blockedSeats,
        occupiedSeats,
        availableCount:
          seatMapEnabled && capacity !== null
            ? Math.max(0, capacity - unavailableSeats.size)
            : capacity,
      },
    }
  }

  async approveQuote(
    clientId: string,
    reservationId: string,
    quoteId: string,
  ) {
    const quote = await this.prisma.quote.findFirst({
      where: {
        id: quoteId,
        reservationId,
        reservation: { clientId },
      },
      include: { items: true },
    })

    if (!quote) throw new NotFoundException('Cotação não encontrada')
    if (quote.status !== QuoteStatus.SENT) {
      throw new ConflictException('Esta cotação não está disponível para aprovação')
    }
    if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
      await this.prisma.quote.update({
        where: { id: quote.id },
        data: { status: QuoteStatus.EXPIRED },
      })
      throw new ConflictException('A validade desta cotação expirou')
    }

    return this.prisma.$transaction(async (tx) => {
      const approved = await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: QuoteStatus.APPROVED,
          approvedAt: new Date(),
        },
        select: {
          id: true,
          revision: true,
          status: true,
          totalCents: true,
          approvedAt: true,
        },
      })

      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CONFIRMED },
      })

      if (quote.items.length) {
        await tx.reservationService.createMany({
          data: quote.items.map((item) => ({
            reservationId,
            sourceQuoteItemId: item.id,
            category: item.category,
            description: item.description,
            supplier: item.supplier,
            amountCents: item.totalSaleCents,
          })),
          skipDuplicates: true,
        })
      }

      return approved
    })
  }

  async rejectQuote(
    clientId: string,
    reservationId: string,
    quoteId: string,
  ) {
    const quote = await this.prisma.quote.findFirst({
      where: {
        id: quoteId,
        reservationId,
        reservation: { clientId },
      },
      select: { id: true, status: true },
    })

    if (!quote) throw new NotFoundException('Cotação não encontrada')
    if (quote.status !== QuoteStatus.SENT) {
      throw new ConflictException('Esta cotação não está disponível para resposta')
    }

    return this.prisma.quote.update({
      where: { id: quote.id },
      data: {
        status: QuoteStatus.REJECTED,
        rejectedAt: new Date(),
      },
      select: {
        id: true,
        revision: true,
        status: true,
        rejectedAt: true,
      },
    })
  }

  private generateAccessCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = randomBytes(10)
    let code = ''

    for (let index = 0; index < 10; index += 1) {
      code += alphabet[bytes[index] % alphabet.length]
    }

    return `${code.slice(0, 5)}-${code.slice(5)}`
  }
}
