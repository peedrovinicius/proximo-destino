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
import { PaymentConnectionService } from '../payments/payment-connection.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  ClientPortalLoginDto,
  RequestReservationDto,
  UpdateClientPassengersDto,
} from './dto/portal.dto'

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Optional() private readonly paymentConnection?: PaymentConnectionService,
  ) {}

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

    const client = await this.prisma.client.upsert({
      where: { email },
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
            where: { id: trip.id },
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
                document: providedPassengers?.[index]?.document ?? null,
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

    return {
      reservation,
      accessCode,
      selectedSeats,
      passengers,
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
  ) {
    const purchase = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { reservationId: true },
    })

    if (!purchase) return { ignored: true }

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status },
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
        status === PurchaseStatus.EXPIRED
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

    return { updated: true, status }
  }

  async handlePaymentWebhook(input: {
    type?: string
    action?: string
    dataId?: string
    xSignature?: string
    xRequestId?: string
  }) {
    const secret =
      this.config.get<string>('MERCADO_PAGO_WEBHOOK_SECRET')?.trim()

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
          : ['cancelled', 'rejected', 'refunded', 'charged_back'].includes(
                payment.status ?? '',
              )
            ? PurchaseStatus.CANCELLED
            : PurchaseStatus.PENDING_PAYMENT

      return this.applyPurchaseStatus(purchaseId, status)
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
            : ['canceled', 'failed', 'refunded'].includes(order.status ?? '')
              ? PurchaseStatus.CANCELLED
              : PurchaseStatus.PENDING_PAYMENT

      return this.applyPurchaseStatus(purchaseId, status)
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
        client: { email },
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
            document: passenger.document?.trim() || null,
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
        passengers: {
          select: {
            id: true,
            sequence: true,
            fullName: true,
            document: true,
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

    return {
      ...reservation,
      canEditPassengers:
        reservation.trip.departureDate.getTime() > Date.now() &&
        reservation.status !== ReservationStatus.CANCELLED &&
        reservation.status !== ReservationStatus.COMPLETED,
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
