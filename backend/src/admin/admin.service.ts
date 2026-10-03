import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import {
  CancellationRequestStatus,
  ClientCreditTransactionType,
  InstallmentStatus,
  ManualPaymentStatus,
  PurchaseStatus,
  QuoteStatus,
  ReservationServiceStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { MercadoPagoConfig, Order, Payment, PaymentRefund } from 'mercadopago'
import { WhatsAppAutomationService } from '../notifications/whatsapp-automation.service'
import { PaymentConnectionService } from '../payments/payment-connection.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  CreateReservationDto,
  RegisterManualPaymentDto,
  UpdateReservationPassengersDto,
} from './dto/reservation.dto'

type AuditCategory =
  | 'RESERVATIONS'
  | 'CLIENTS'
  | 'TRIPS'
  | 'SEATS'
  | 'FINANCE'
  | 'COMMERCIAL'
  | 'SETTINGS'
  | 'OTHER'

function auditCategory(eventType: string): AuditCategory {
  if (eventType.includes('SEAT_') || eventType.includes('BOARDING_')) {
    return 'SEATS'
  }
  if (
    eventType.includes('PAYMENT_') ||
    eventType.includes('BONUS_') ||
    eventType.includes('FINANCE_') ||
    eventType.includes('INSTALLMENT_')
  ) {
    return 'FINANCE'
  }
  if (eventType.includes('CLIENT_')) return 'CLIENTS'
  if (eventType.includes('TRIP_')) return 'TRIPS'
  if (eventType.includes('RESERVATION_') || eventType.includes('PASSENGER_')) {
    return 'RESERVATIONS'
  }
  if (
    eventType.includes('QUOTE_') ||
    eventType.includes('SERVICE_') ||
    eventType.includes('COMMERCIAL_')
  ) {
    return 'COMMERCIAL'
  }
  if (
    eventType.includes('SETTING_') ||
    eventType.includes('MERCADO_PAGO_') ||
    eventType.includes('INTEGRATION_')
  ) {
    return 'SETTINGS'
  }
  return 'OTHER'
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly paymentConnection?: PaymentConnectionService,
    @Optional() private readonly whatsapp?: WhatsAppAutomationService,
  ) {}

  private async safeWhatsApp(action: () => Promise<unknown> | undefined) {
    if (!this.whatsapp) return
    try {
      await action()
    } catch {
      // A comunicação nunca deve impedir a operação principal.
    }
  }

  private async mercadoPagoClient() {
    if (!this.paymentConnection) {
      throw new BadGatewayException('Integração financeira indisponível')
    }
    const accessToken = await this.paymentConnection.getAccessToken()
    return new MercadoPagoConfig({
      accessToken,
      options: { timeout: 12_000 },
    })
  }

  async dashboard(role: UserRole = UserRole.ADMIN) {
    const canViewRelationship = role !== UserRole.FINANCE
    const [clients, pendingReservations, activeTrips, confirmedReservations, birthdays] =
      await Promise.all([
        this.prisma.client.count(),
        this.prisma.reservation.count({
          where: { status: ReservationStatus.PENDING },
        }),
        this.prisma.trip.count({
          where: { status: { in: [TripStatus.ACTIVE, TripStatus.SCHEDULED] } },
        }),
        this.prisma.reservation.count({
          where: { status: ReservationStatus.CONFIRMED },
        }),
        canViewRelationship
          ? this.prisma.client.findMany({
              where: { birthDate: { not: null } },
              select: {
                id: true,
                fullName: true,
                phone: true,
                birthDate: true,
              },
            })
          : Promise.resolve([]),
      ])

    const now = new Date()
    const upcomingBirthdays = birthdays
      .map((client) => {
        const birth = client.birthDate as Date
        let next = new Date(Date.UTC(
          now.getUTCFullYear(),
          birth.getUTCMonth(),
          birth.getUTCDate(),
        ))
        const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        if (next.getTime() < today) {
          next = new Date(Date.UTC(
            now.getUTCFullYear() + 1,
            birth.getUTCMonth(),
            birth.getUTCDate(),
          ))
        }
        const daysUntil = Math.round((next.getTime() - today) / 86_400_000)
        return { ...client, nextBirthday: next, daysUntil }
      })
      .filter((client) => client.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 12)

    return {
      metrics: {
        clients,
        pendingReservations,
        activeTrips,
        confirmedReservations,
      },
      birthdays: upcomingBirthdays,
    }
  }

  async listReservations() {
    const reservations = await this.prisma.reservation.findMany({
      select: {
        id: true,
        status: true,
        passengerCount: true,
        cancellationRequestStatus: true,
        cancellationRequestedAt: true,
        cancellationRequestReason: true,
        cancellationRequestResolvedAt: true,
        cancellationRequestResolutionNote: true,
        seatAssignments: {
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        },
        purchaseOrder: {
          select: { status: true, totalCents: true },
        },
        createdAt: true,
        updatedAt: true,
        client: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            creditTransactions: { select: { amountCents: true } },
          },
        },
        trip: {
          select: {
            id: true,
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return reservations.map((reservation) => {
      const { creditTransactions, ...client } = reservation.client
      return {
        ...reservation,
        client: {
          ...client,
          bonusBalanceCents: Math.max(
            0,
            creditTransactions.reduce(
              (sum, transaction) => sum + transaction.amountCents,
              0,
            ),
          ),
        },
      }
    })
  }

  private async ensureReservationPassengers(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        passengerCount: true,
        client: { select: { fullName: true } },
        passengers: {
          select: { id: true, sequence: true },
          orderBy: { sequence: 'asc' },
        },
        seatAssignments: {
          select: { id: true, seatNumber: true, passengerId: true },
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
              reservationId: reservation.id,
              sequence,
            },
          },
          update: {},
          create: {
            reservationId: reservation.id,
            sequence,
            fullName: sequence === 1 ? reservation.client.fullName : null,
            isPrimary: sequence === 1,
          },
        })
      }

      const [passengers, assignments] = await Promise.all([
        tx.reservationPassenger.findMany({
          where: { reservationId: reservation.id },
          select: { id: true, sequence: true },
          orderBy: { sequence: 'asc' },
        }),
        tx.seatAssignment.findMany({
          where: { reservationId: reservation.id },
          select: { id: true, passengerId: true },
          orderBy: { seatNumber: 'asc' },
        }),
      ])

      const assignedPassengerIds = new Set(
        assignments
          .map((assignment) => assignment.passengerId)
          .filter((value): value is string => Boolean(value)),
      )
      const freePassengers = passengers.filter(
        (passenger) => !assignedPassengerIds.has(passenger.id),
      )
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

  async reservationPassengers(id: string) {
    await this.ensureReservationPassengers(id)

    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        client: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        trip: {
          select: {
            id: true,
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
          },
        },
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
          select: { seatNumber: true, passengerId: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    return reservation
  }

  async updateReservationPassengers(
    id: string,
    data: UpdateReservationPassengersDto,
    actorUserId?: string,
  ) {
    const current = await this.reservationPassengers(id)

    if (data.passengers.length !== current.passengerCount) {
      throw new BadRequestException(
        `A reserva exige exatamente ${current.passengerCount} passageiro(s)`,
      )
    }

    const expectedIds = new Set(current.passengers.map((passenger) => passenger.id))
    if (
      new Set(data.passengers.map((passenger) => passenger.id)).size !==
        data.passengers.length ||
      data.passengers.some((passenger) => !expectedIds.has(passenger.id))
    ) {
      throw new BadRequestException('A lista de passageiros não pertence a esta reserva')
    }

    const seatNumbers = data.passengers
      .map((passenger) => passenger.seatNumber)
      .filter((seat): seat is number => seat !== null && seat !== undefined)

    if (new Set(seatNumbers).size !== seatNumbers.length) {
      throw new BadRequestException('Um assento não pode ser atribuído a dois passageiros')
    }

    const reservationSeats = new Set(
      current.seatAssignments.map((assignment) => assignment.seatNumber),
    )
    if (seatNumbers.some((seat) => !reservationSeats.has(seat))) {
      throw new BadRequestException('Só é possível vincular assentos desta reserva')
    }

    const primary = current.passengers.find((passenger) => passenger.isPrimary)
    const primaryInput = primary
      ? data.passengers.find((passenger) => passenger.id === primary.id)
      : null
    if (!primaryInput?.fullName?.trim()) {
      throw new BadRequestException('O passageiro titular deve ter nome')
    }

    const beforeSeats = current.passengers.map((passenger) => ({
      passengerId: passenger.id,
      seatNumber: passenger.seatAssignment?.seatNumber ?? null,
    }))

    await this.prisma.$transaction(async (tx) => {
      await tx.seatAssignment.updateMany({
        where: { reservationId: id },
        data: { passengerId: null },
      })

      for (const passenger of data.passengers) {
        await tx.reservationPassenger.update({
          where: { id: passenger.id },
          data: {
            fullName: passenger.fullName?.trim() || null,
            document: passenger.document?.trim() || null,
            birthDate: passenger.birthDate ?? null,
          },
        })

        if (passenger.seatNumber !== null && passenger.seatNumber !== undefined) {
          await tx.seatAssignment.update({
            where: {
              reservationId_seatNumber: {
                reservationId: id,
                seatNumber: passenger.seatNumber,
              },
            },
            data: { passengerId: passenger.id },
          })
        }
      }

      if (actorUserId) {
        await tx.authAuditEvent.create({
          data: {
            userId: actorUserId,
            eventType: 'OPS_RESERVATION_PASSENGERS_UPDATED',
            metadata: {
              reservationId: id,
              passengerCount: current.passengerCount,
              beforeSeats,
              afterSeats: data.passengers.map((passenger) => ({
                passengerId: passenger.id,
                seatNumber: passenger.seatNumber ?? null,
              })),
              changedPassengerIds: data.passengers.map(
                (passenger) => passenger.id,
              ),
            },
          },
        })
      }
    })

    return this.reservationPassengers(id)
  }

  async paymentsDashboard() {
    const [orders, manualPayments] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        unitPriceCents: true,
        passengerCount: true,
        totalCents: true,
        providerPaymentId: true,
        providerOrderId: true,
        providerStatus: true,
        paidAt: true,
        refundedCents: true,
        refundedAt: true,
        lastReconciledAt: true,
        createdAt: true,
        updatedAt: true,
        reservation: {
          select: {
            id: true,
            status: true,
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
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      }),
      this.prisma.manualPayment.findMany({
        select: {
          id: true,
          method: true,
          status: true,
          amountCents: true,
          paidAt: true,
          reference: true,
          note: true,
          reversedAt: true,
          reversedReason: true,
          createdAt: true,
          installment: {
            select: {
              id: true,
              sequence: true,
              dueDate: true,
              amountCents: true,
            },
          },
          recordedBy: {
            select: { id: true, email: true, role: true },
          },
          reversedBy: {
            select: { id: true, email: true, role: true },
          },
          reservation: {
            select: {
              id: true,
              status: true,
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
                },
              },
            },
          },
        },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      }),
    ])

    const summary = orders.reduce(
      (acc, order) => {
        acc.totalOrders += 1
        if (
          order.status === PurchaseStatus.PAID ||
          order.status === PurchaseStatus.PARTIALLY_REFUNDED
        ) {
          acc.paidOrders += 1
          acc.paidCents += Math.max(order.totalCents - order.refundedCents, 0)
        } else if (order.status === PurchaseStatus.PENDING_PAYMENT) {
          acc.pendingOrders += 1
          acc.pendingCents += order.totalCents
        } else if (order.status === PurchaseStatus.REFUNDED) {
          acc.refundedOrders += 1
        } else if (order.status === PurchaseStatus.CANCELLED) {
          acc.cancelledOrders += 1
        } else if (order.status === PurchaseStatus.EXPIRED) {
          acc.expiredOrders += 1
        }
        acc.refundedCents += order.refundedCents
        return acc
      },
      {
        totalOrders: 0,
        paidOrders: 0,
        pendingOrders: 0,
        refundedOrders: 0,
        cancelledOrders: 0,
        expiredOrders: 0,
        paidCents: 0,
        pendingCents: 0,
        refundedCents: 0,
        manualReceivedCount: 0,
        manualReceivedCents: 0,
        manualReversedCount: 0,
        manualReversedCents: 0,
      },
    )

    for (const payment of manualPayments) {
      if (payment.status === ManualPaymentStatus.RECEIVED) {
        summary.manualReceivedCount += 1
        summary.manualReceivedCents += payment.amountCents
        summary.paidCents += payment.amountCents
      } else {
        summary.manualReversedCount += 1
        summary.manualReversedCents += payment.amountCents
        summary.refundedCents += payment.amountCents
      }
    }

    return { summary, orders, manualPayments }
  }

  async reservationFinance(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        createdAt: true,
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
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            paymentMethod: true,
            unitPriceCents: true,
            passengerCount: true,
            totalCents: true,
            providerPaymentId: true,
            providerOrderId: true,
            providerStatus: true,
            paidAt: true,
            refundedCents: true,
            refundedAt: true,
            lastReconciledAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        financePlan: {
          select: {
            id: true,
            totalCents: true,
            downPaymentCents: true,
            installmentCount: true,
            refundedCents: true,
            createdAt: true,
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
        manualPayments: {
          select: {
            id: true,
            financePlanId: true,
            installmentId: true,
            method: true,
            status: true,
            amountCents: true,
            paidAt: true,
            reference: true,
            note: true,
            reversedAt: true,
            reversedReason: true,
            createdAt: true,
            recordedBy: {
              select: { id: true, email: true, role: true },
            },
            reversedBy: {
              select: { id: true, email: true, role: true },
            },
          },
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        },
        quotes: {
          where: { status: QuoteStatus.APPROVED },
          select: {
            id: true,
            revision: true,
            title: true,
            subtotalSaleCents: true,
            discountCents: true,
            totalCents: true,
            approvedAt: true,
          },
          orderBy: { revision: 'desc' },
          take: 1,
        },
        creditTransactions: {
          select: {
            id: true,
            type: true,
            amountCents: true,
            note: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')

    const manualPaymentInstallmentIds = new Set(
      reservation.manualPayments
        .map((item) => item.installmentId)
        .filter((value): value is string => Boolean(value)),
    )

    const legacyManualPaidCents =
      reservation.financePlan?.installments
        .filter(
          (item) =>
            item.status === InstallmentStatus.PAID &&
            !manualPaymentInstallmentIds.has(item.id),
        )
        .reduce((sum, item) => sum + item.amountCents, 0) ?? 0

    const manualGrossCents =
      legacyManualPaidCents +
      reservation.manualPayments.reduce(
        (sum, item) => sum + item.amountCents,
        0,
      )
    const manualReversedCents = reservation.manualPayments
      .filter((item) => item.status === ManualPaymentStatus.REVERSED)
      .reduce((sum, item) => sum + item.amountCents, 0)

    const providerWasPaid = Boolean(
      reservation.purchaseOrder?.paidAt ||
      reservation.purchaseOrder?.status === PurchaseStatus.PAID ||
      reservation.purchaseOrder?.status === PurchaseStatus.PARTIALLY_REFUNDED ||
      reservation.purchaseOrder?.status === PurchaseStatus.REFUNDED,
    )

    const providerGrossCents =
      reservation.purchaseOrder && providerWasPaid
        ? reservation.purchaseOrder.totalCents
        : 0
    const grossPaidCents = providerGrossCents + manualGrossCents

    const refundedCents =
      (reservation.purchaseOrder?.refundedCents ??
        reservation.financePlan?.refundedCents ??
        0) + manualReversedCents

    const totalCents =
      reservation.purchaseOrder?.totalCents ??
      reservation.financePlan?.totalCents ??
      reservation.quotes[0]?.totalCents ??
      0

    const events = await this.prisma.authAuditEvent.findMany({
      where: {
        eventType: {
          in: [
            'OPS_PAYMENT_REFUNDED',
            'OPS_PAYMENT_RECONCILED',
            'OPS_MANUAL_PAYMENT_RECEIVED',
            'OPS_MANUAL_PAYMENT_REVERSED',
          ],
        },
        metadata: {
          path: ['reservationId'],
          equals: id,
        },
      },
      select: {
        id: true,
        eventType: true,
        metadata: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return {
      reservation: {
        id: reservation.id,
        status: reservation.status,
        passengerCount: reservation.passengerCount,
        createdAt: reservation.createdAt,
        client: reservation.client,
        trip: reservation.trip,
      },
      purchaseOrder: reservation.purchaseOrder,
      financePlan: reservation.financePlan,
      quote: reservation.quotes[0] ?? null,
      credits: reservation.creditTransactions,
      summary: {
        totalCents,
        grossPaidCents,
        refundedCents,
        netPaidCents: Math.max(grossPaidCents - refundedCents, 0),
        outstandingCents: Math.max(
          totalCents - Math.max(grossPaidCents - refundedCents, 0),
          0,
        ),
        refundableCents:
          reservation.status === ReservationStatus.CANCELLED
            ? Math.max(grossPaidCents - refundedCents, 0)
            : 0,
      },
      manualPayments: reservation.manualPayments,
      events,
    }
  }

  async registerManualPayment(
    id: string,
    data: RegisterManualPaymentDto,
    actorUserId: string,
  ) {
    const current = await this.reservationFinance(id)

    if (
      current.reservation.status === ReservationStatus.CANCELLED ||
      current.reservation.status === ReservationStatus.COMPLETED
    ) {
      throw new ConflictException(
        'Não é possível registrar novo recebimento em uma reserva encerrada',
      )
    }

    if (data.amountCents > current.summary.outstandingCents) {
      throw new BadRequestException(
        'O valor informado é maior que o saldo pendente da reserva',
      )
    }

    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date()
    if (
      Number.isNaN(paidAt.getTime()) ||
      paidAt.getTime() > Date.now() + 5 * 60_000
    ) {
      throw new BadRequestException('Data do recebimento inválida')
    }

    const installment = data.installmentId
      ? current.financePlan?.installments.find(
          (item) => item.id === data.installmentId,
        )
      : null

    if (data.installmentId && !installment) {
      throw new BadRequestException(
        'A parcela informada não pertence a esta reserva',
      )
    }

    if (installment?.status === InstallmentStatus.CANCELLED) {
      throw new ConflictException(
        'Não é possível receber uma parcela cancelada',
      )
    }

    if (installment) {
      const alreadyReceived = current.manualPayments
        .filter(
          (item) =>
            item.installmentId === installment.id &&
            item.status === ManualPaymentStatus.RECEIVED,
        )
        .reduce((sum, item) => sum + item.amountCents, 0)
      const installmentOutstanding = Math.max(
        installment.amountCents - alreadyReceived,
        0,
      )

      if (data.amountCents > installmentOutstanding) {
        throw new BadRequestException(
          'O valor informado é maior que o saldo restante desta parcela',
        )
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.manualPayment.create({
        data: {
          reservationId: id,
          financePlanId: current.financePlan?.id ?? null,
          installmentId: installment?.id ?? null,
          method: data.method,
          amountCents: data.amountCents,
          paidAt,
          reference: data.reference?.trim() || null,
          note: data.note?.trim() || null,
          recordedByUserId: actorUserId,
        },
      })

      if (installment) {
        const received = await tx.manualPayment.aggregate({
          where: {
            installmentId: installment.id,
            status: ManualPaymentStatus.RECEIVED,
          },
          _sum: { amountCents: true },
        })
        const paidCents = received._sum.amountCents ?? 0

        if (paidCents >= installment.amountCents) {
          await tx.installment.update({
            where: { id: installment.id },
            data: {
              status: InstallmentStatus.PAID,
              paidAt,
              paymentMethod: data.method,
            },
          })
        }
      }

      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_MANUAL_PAYMENT_RECEIVED',
          metadata: {
            reservationId: id,
            manualPaymentId: payment.id,
            installmentId: installment?.id ?? null,
            amountCents: data.amountCents,
            method: data.method,
            reference: data.reference?.trim() || null,
            paidAt: paidAt.toISOString(),
          },
        },
      })
    })

    return this.reservationFinance(id)
  }

  async reverseManualPayment(
    id: string,
    paymentId: string,
    reason: string,
    actorUserId: string,
  ) {
    const payment = await this.prisma.manualPayment.findFirst({
      where: { id: paymentId, reservationId: id },
      select: {
        id: true,
        installmentId: true,
        status: true,
        amountCents: true,
        method: true,
      },
    })

    if (!payment) {
      throw new NotFoundException('Recebimento manual não encontrado')
    }
    if (payment.status === ManualPaymentStatus.REVERSED) {
      throw new ConflictException('Este recebimento já foi estornado')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.manualPayment.update({
        where: { id: payment.id },
        data: {
          status: ManualPaymentStatus.REVERSED,
          reversedAt: new Date(),
          reversedReason: reason.trim(),
          reversedByUserId: actorUserId,
        },
      })

      if (payment.installmentId) {
        const installment = await tx.installment.findUnique({
          where: { id: payment.installmentId },
          select: { id: true, amountCents: true, dueDate: true },
        })

        if (installment) {
          const remaining = await tx.manualPayment.aggregate({
            where: {
              installmentId: installment.id,
              status: ManualPaymentStatus.RECEIVED,
            },
            _sum: { amountCents: true },
          })
          const remainingPaid = remaining._sum.amountCents ?? 0

          if (remainingPaid < installment.amountCents) {
            await tx.installment.update({
              where: { id: installment.id },
              data: {
                status:
                  installment.dueDate.getTime() < Date.now()
                    ? InstallmentStatus.OVERDUE
                    : InstallmentStatus.OPEN,
                paidAt: null,
                paymentMethod: null,
              },
            })
          }
        }
      }

      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_MANUAL_PAYMENT_REVERSED',
          metadata: {
            reservationId: id,
            manualPaymentId: payment.id,
            installmentId: payment.installmentId,
            amountCents: payment.amountCents,
            method: payment.method,
            reason: reason.trim(),
          },
        },
      })
    })

    return this.reservationFinance(id)
  }

  async reconcileReservationPayment(
    id: string,
    actorUserId: string,
  ) {
    const current = await this.reservationFinance(id)
    const purchase = current.purchaseOrder

    if (!purchase) {
      throw new BadRequestException(
        'Esta reserva não possui pagamento online para reconciliar',
      )
    }

    if (!purchase.providerPaymentId && !purchase.providerOrderId) {
      throw new ConflictException(
        'O pagamento ainda não possui identificador do Mercado Pago',
      )
    }

    const client = await this.mercadoPagoClient()
    let status = purchase.status
    let providerStatus = purchase.providerStatus
    let refundedCents = purchase.refundedCents
    let providerPaymentId = purchase.providerPaymentId
    let paidAt = purchase.paidAt

    try {
      if (purchase.providerPaymentId) {
        const payment = await new Payment(client).get({
          id: purchase.providerPaymentId,
        })
        const refunds = await new PaymentRefund(client).list({
          payment_id: purchase.providerPaymentId,
        })
        refundedCents = Math.min(
          purchase.totalCents,
          Math.round(
            refunds.reduce(
              (sum, refund) => sum + (refund.amount ?? 0),
              0,
            ) * 100,
          ),
        )
        providerStatus = payment.status ?? 'unknown'
        providerPaymentId = String(
          payment.id ?? purchase.providerPaymentId,
        )
        paidAt = payment.date_approved
          ? new Date(payment.date_approved)
          : purchase.paidAt

        if (refundedCents >= purchase.totalCents) {
          status = PurchaseStatus.REFUNDED
        } else if (refundedCents > 0) {
          status = PurchaseStatus.PARTIALLY_REFUNDED
        } else if (payment.status === 'approved') {
          status = PurchaseStatus.PAID
        } else if (
          ['cancelled', 'rejected', 'charged_back'].includes(
            payment.status ?? '',
          )
        ) {
          status = PurchaseStatus.CANCELLED
        } else {
          status = PurchaseStatus.PENDING_PAYMENT
        }
      } else if (purchase.providerOrderId) {
        const order = await new Order(client).get({
          id: purchase.providerOrderId,
        })
        const refunds = order.transactions?.refunds ?? []
        refundedCents = Math.min(
          purchase.totalCents,
          Math.round(
            refunds.reduce(
              (sum, refund) => sum + Number(refund.amount ?? '0'),
              0,
            ) * 100,
          ),
        )
        providerStatus = [order.status, order.status_detail]
          .filter(Boolean)
          .join(':')
        providerPaymentId =
          order.transactions?.payments?.[0]?.id ??
          purchase.providerPaymentId

        if (refundedCents >= purchase.totalCents) {
          status = PurchaseStatus.REFUNDED
        } else if (refundedCents > 0) {
          status = PurchaseStatus.PARTIALLY_REFUNDED
        } else if (
          order.status === 'processed' &&
          order.status_detail === 'accredited'
        ) {
          status = PurchaseStatus.PAID
          paidAt = purchase.paidAt ?? new Date()
        } else if (order.status === 'expired') {
          status = PurchaseStatus.EXPIRED
        } else if (['canceled', 'failed'].includes(order.status ?? '')) {
          status = PurchaseStatus.CANCELLED
        } else {
          status = PurchaseStatus.PENDING_PAYMENT
        }
      }
    } catch (error) {
      throw new BadGatewayException(
        error instanceof Error
          ? 'Falha ao consultar o Mercado Pago: ' + error.message
          : 'Falha ao consultar o Mercado Pago',
      )
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchase.id },
        data: {
          status,
          providerPaymentId,
          providerStatus,
          paidAt,
          refundedCents,
          refundedAt:
            refundedCents > 0
              ? purchase.refundedAt ?? new Date()
              : null,
          lastReconciledAt: new Date(),
        },
      })

      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_PAYMENT_RECONCILED',
          metadata: {
            reservationId: id,
            purchaseOrderId: purchase.id,
            status,
            providerStatus,
            refundedCents,
          },
        },
      })
    })

    return this.reservationFinance(id)
  }

  async refundReservationPayment(
    id: string,
    amountCents: number,
    reason: string | undefined,
    actorUserId: string,
  ) {
    const current = await this.reservationFinance(id)
    const purchase = current.purchaseOrder

    if (!purchase) {
      throw new BadRequestException(
        'Esta reserva não possui pagamento online para estornar',
      )
    }
    if (current.reservation.status !== ReservationStatus.CANCELLED) {
      throw new ConflictException(
        'Cancele a reserva antes de realizar o estorno financeiro',
      )
    }
    if (
      purchase.status !== PurchaseStatus.PAID &&
      purchase.status !== PurchaseStatus.PARTIALLY_REFUNDED
    ) {
      throw new ConflictException(
        'Este pagamento não está disponível para estorno',
      )
    }

    const refundableCents = Math.max(
      purchase.totalCents - purchase.refundedCents,
      0,
    )
    if (amountCents > refundableCents) {
      throw new BadRequestException(
        'O valor do estorno supera o saldo reembolsável',
      )
    }

    const client = await this.mercadoPagoClient()
    let providerRefundId: string | null = null

    try {
      if (purchase.paymentMethod === 'PIX') {
        if (!purchase.providerPaymentId) {
          throw new ConflictException(
            'O pagamento PIX ainda não possui identificador do Mercado Pago',
          )
        }

        const refunds = new PaymentRefund(client)
        const response =
          amountCents === refundableCents &&
          purchase.refundedCents === 0
            ? await refunds.total({
                payment_id: purchase.providerPaymentId,
                requestOptions: {
                  idempotencyKey:
                    `${purchase.id}-refund-${purchase.refundedCents}-${amountCents}`,
                },
              })
            : await refunds.create({
                payment_id: purchase.providerPaymentId,
                body: { amount: amountCents / 100 },
                requestOptions: {
                  idempotencyKey:
                    `${purchase.id}-refund-${purchase.refundedCents}-${amountCents}`,
                },
              })

        providerRefundId =
          response.id !== undefined && response.id !== null
            ? String(response.id)
            : null
      } else if (purchase.paymentMethod === 'CARD') {
        if (!purchase.providerOrderId) {
          throw new ConflictException(
            'O pedido de cartão ainda não possui identificador do Mercado Pago',
          )
        }

        const orders = new Order(client)
        const remote = await orders.get({
          id: purchase.providerOrderId,
        })
        const transactionId = remote.transactions?.payments?.[0]?.id
        if (!transactionId) {
          throw new ConflictException(
            'O Mercado Pago não retornou a transação do cartão',
          )
        }

        const response =
          amountCents === refundableCents &&
          purchase.refundedCents === 0
            ? await orders.refund({
                id: purchase.providerOrderId,
                requestOptions: {
                  idempotencyKey:
                    `${purchase.id}-refund-${purchase.refundedCents}-${amountCents}`,
                },
              })
            : await orders.refund({
                id: purchase.providerOrderId,
                body: {
                  transactions: [
                    {
                      id: transactionId,
                      amount: (amountCents / 100).toFixed(2),
                    },
                  ],
                },
                requestOptions: {
                  idempotencyKey:
                    `${purchase.id}-refund-${purchase.refundedCents}-${amountCents}`,
                },
              })

        const providerRefunds = response.transactions?.refunds ?? []
        providerRefundId =
          providerRefunds[providerRefunds.length - 1]?.id ?? null
      } else {
        throw new BadRequestException(
          'Este método de pagamento não possui estorno automático',
        )
      }
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error
      }
      throw new BadGatewayException(
        error instanceof Error
          ? 'Falha ao solicitar estorno ao Mercado Pago: ' + error.message
          : 'Falha ao solicitar estorno ao Mercado Pago',
      )
    }

    const refundedCents = purchase.refundedCents + amountCents
    const status =
      refundedCents >= purchase.totalCents
        ? PurchaseStatus.REFUNDED
        : PurchaseStatus.PARTIALLY_REFUNDED

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchase.id },
        data: {
          status,
          refundedCents,
          refundedAt: new Date(),
          providerStatus:
            status === PurchaseStatus.REFUNDED
              ? 'refunded'
              : 'partially_refunded',
          lastReconciledAt: new Date(),
        },
      })

      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_PAYMENT_REFUNDED',
          metadata: {
            reservationId: id,
            purchaseOrderId: purchase.id,
            amountCents,
            refundedCents,
            providerRefundId,
            reason: reason?.trim() || null,
          },
        },
      })
    })

    return this.reservationFinance(id)
  }

  async createReservation(
    data: CreateReservationDto,
    actorUserId?: string,
  ) {
    const [client, trip] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } }),
      this.prisma.trip.findUnique({ where: { id: data.tripId }, select: { id: true } }),
    ])
    if (!client) throw new NotFoundException('Cliente não encontrado')
    if (!trip) throw new NotFoundException('Viagem não encontrada')

    const created = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: {
          clientId: data.clientId,
          tripId: data.tripId,
        },
        select: {
          id: true,
          status: true,
          passengerCount: true,
          seatAssignments: {
            select: { seatNumber: true },
            orderBy: { seatNumber: 'asc' },
          },
          createdAt: true,
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
            },
          },
        },
      })

      if (actorUserId) {
        await tx.authAuditEvent.create({
          data: {
            userId: actorUserId,
            eventType: 'OPS_RESERVATION_CREATED',
            metadata: {
              reservationId: reservation.id,
              clientId: data.clientId,
              tripId: data.tripId,
              afterStatus: reservation.status,
            },
          },
        })
      }

      return reservation
    })

    return created
  }

  async updateReservationStatus(
    id: string,
    status: ReservationStatus,
    actorUserId?: string,
  ) {
    const current = await this.prisma.reservation.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!current) throw new NotFoundException('Reserva não encontrada')

    if (status === ReservationStatus.CANCELLED) {
      throw new BadRequestException(
        'Use a ação de cancelamento para definir bônus e motivo',
      )
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.update({
        where: { id },
        data: { status },
      })

      if (actorUserId && current.status !== status) {
        await tx.authAuditEvent.create({
          data: {
            userId: actorUserId,
            eventType: 'OPS_RESERVATION_STATUS_CHANGED',
            metadata: {
              reservationId: id,
              beforeStatus: current.status,
              afterStatus: status,
            },
          },
        })
      }

      return reservation
    })

    if (status === ReservationStatus.CONFIRMED) {
      await this.safeWhatsApp(() =>
        this.whatsapp?.enqueueReservationConfirmed(id),
      )
    }

    return updated
  }

  async cancelReservation(
    id: string,
    creditAsBonus: boolean,
    reason: string | undefined,
    actorUserId: string,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        cancellationRequestStatus: true,
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            totalCents: true,
            refundedCents: true,
          },
        },
        financePlan: {
          select: {
            installments: {
              select: { amountCents: true, status: true },
            },
          },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    if (reservation.status === ReservationStatus.COMPLETED) {
      throw new ConflictException('Reserva concluída não pode ser cancelada')
    }

    const paidCents = reservation.purchaseOrder
      ? Math.max(
          (
            reservation.purchaseOrder.status === PurchaseStatus.PAID ||
            reservation.purchaseOrder.status === PurchaseStatus.PARTIALLY_REFUNDED ||
            reservation.purchaseOrder.status === PurchaseStatus.REFUNDED
              ? reservation.purchaseOrder.totalCents
              : 0
          ) - (reservation.purchaseOrder.refundedCents ?? 0),
          0,
        )
      : reservation.financePlan?.installments
          .filter((item) => item.status === InstallmentStatus.PAID)
          .reduce((sum, item) => sum + item.amountCents, 0) ?? 0

    if (reservation.status === ReservationStatus.CANCELLED) {
      const credit = await this.prisma.clientCreditTransaction.findUnique({
        where: { sourceKey: `cancellation:${id}` },
        select: { amountCents: true },
      })
      return {
        cancelled: true,
        alreadyCancelled: true,
        paidCents,
        bonusGrantedCents: credit?.amountCents ?? 0,
      }
    }

    let bonusGrantedCents = 0

    await this.prisma.$transaction(async (tx) => {
      await tx.seatAssignment.deleteMany({ where: { reservationId: id } })

      await tx.reservationService.updateMany({
        where: {
          reservationId: id,
          status: {
            in: [
              ReservationServiceStatus.PENDING,
              ReservationServiceStatus.CONFIRMED,
            ],
          },
        },
        data: { status: ReservationServiceStatus.CANCELLED },
      })

      if (reservation.financePlan) {
        const plan = await tx.financePlan.findUnique({
          where: { reservationId: id },
          select: { id: true },
        })
        if (plan) {
          await tx.installment.updateMany({
            where: {
              financePlanId: plan.id,
              status: {
                in: [InstallmentStatus.OPEN, InstallmentStatus.OVERDUE],
              },
            },
            data: { status: InstallmentStatus.CANCELLED },
          })
        }
      }

      if (
        reservation.purchaseOrder &&
        (
          reservation.purchaseOrder.status === PurchaseStatus.PENDING_PAYMENT ||
          reservation.purchaseOrder.status === PurchaseStatus.EXPIRED
        )
      ) {
        await tx.purchaseOrder.update({
          where: { id: reservation.purchaseOrder.id },
          data: { status: PurchaseStatus.CANCELLED },
        })
      }

      await tx.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.CANCELLED,
          ...(reservation.cancellationRequestStatus ===
          CancellationRequestStatus.PENDING
            ? {
                cancellationRequestStatus:
                  CancellationRequestStatus.APPROVED,
                cancellationRequestResolvedAt: new Date(),
                cancellationRequestResolutionNote:
                  reason?.trim() || 'Solicitação aprovada pelo administrador',
                cancellationRequestResolvedByUserId: actorUserId,
              }
            : {}),
        },
      })

      if (creditAsBonus && paidCents > 0) {
        const credit = await tx.clientCreditTransaction.upsert({
          where: { sourceKey: `cancellation:${id}` },
          update: {},
          create: {
            clientId: reservation.clientId,
            reservationId: id,
            type: ClientCreditTransactionType.CANCELLATION_CREDIT,
            amountCents: paidCents,
            note:
              reason?.trim() ||
              'Crédito gerado pelo cancelamento da reserva',
            sourceKey: `cancellation:${id}`,
            actorUserId,
          },
          select: { amountCents: true },
        })
        bonusGrantedCents = credit.amountCents
      }

      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_RESERVATION_CANCELLED',
          metadata: {
            reservationId: id,
            clientId: reservation.clientId,
            paidCents,
            creditAsBonus,
            bonusGrantedCents: creditAsBonus ? paidCents : 0,
            reason: reason?.trim() || null,
          },
        },
      })
    })

    await this.safeWhatsApp(() =>
      this.whatsapp?.enqueueReservationCancelled(id),
    )

    return {
      cancelled: true,
      alreadyCancelled: false,
      paidCents,
      bonusGrantedCents,
    }
  }

  async rejectCancellationRequest(
    id: string,
    note: string | undefined,
    actorUserId: string,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        cancellationRequestStatus: true,
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    if (
      reservation.cancellationRequestStatus !==
      CancellationRequestStatus.PENDING
    ) {
      throw new ConflictException(
        'Não há solicitação de cancelamento aguardando análise',
      )
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id },
        data: {
          cancellationRequestStatus: CancellationRequestStatus.REJECTED,
          cancellationRequestResolvedAt: new Date(),
          cancellationRequestResolutionNote:
            note?.trim() || 'Solicitação recusada pelo administrador',
          cancellationRequestResolvedByUserId: actorUserId,
        },
      })

      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_CANCELLATION_REQUEST_REJECTED',
          metadata: {
            reservationId: id,
            clientId: reservation.clientId,
            note: note?.trim() || null,
          },
        },
      })
    })

    return { rejected: true }
  }

  async applyBonus(
    id: string,
    amountCents: number,
    note: string | undefined,
    actorUserId: string,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        financePlan: { select: { id: true } },
      },
    })
    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    if (
      reservation.status === ReservationStatus.CANCELLED ||
      reservation.status === ReservationStatus.COMPLETED
    ) {
      throw new ConflictException(
        'Não é possível usar bônus nesta reserva',
      )
    }
    if (reservation.financePlan) {
      throw new ConflictException(
        'O bônus deve ser aplicado antes de gerar o plano financeiro',
      )
    }

    const balance = await this.prisma.clientCreditTransaction.aggregate({
      where: { clientId: reservation.clientId },
      _sum: { amountCents: true },
    })
    const balanceCents = Math.max(0, balance._sum.amountCents ?? 0)
    if (amountCents > balanceCents) {
      throw new BadRequestException(
        'O valor supera o saldo de bônus disponível',
      )
    }

    const quote = await this.prisma.quote.findFirst({
      where: {
        reservationId: id,
        status: QuoteStatus.APPROVED,
      },
      orderBy: { revision: 'desc' },
      select: {
        id: true,
        discountCents: true,
        totalCents: true,
        marginCents: true,
      },
    })
    if (!quote) {
      throw new BadRequestException(
        'A reserva precisa ter uma cotação aprovada para aplicar o bônus',
      )
    }
    if (amountCents > quote.totalCents) {
      throw new BadRequestException(
        'O bônus não pode superar o valor restante da cotação',
      )
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          discountCents: { increment: amountCents },
          totalCents: { decrement: amountCents },
          marginCents: { decrement: amountCents },
        },
      })

      await tx.clientCreditTransaction.create({
        data: {
          clientId: reservation.clientId,
          reservationId: id,
          type: ClientCreditTransactionType.BONUS_USED,
          amountCents: -amountCents,
          note: note?.trim() || 'Bônus usado como desconto na viagem',
          actorUserId,
        },
      })

      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_CLIENT_BONUS_USED',
          metadata: {
            reservationId: id,
            clientId: reservation.clientId,
            quoteId: quote.id,
            amountCents,
          },
        },
      })
    })

    return {
      appliedCents: amountCents,
      remainingBonusCents: balanceCents - amountCents,
      quoteTotalCents: quote.totalCents - amountCents,
    }
  }

  async auditTrail(
    rawCategory = 'ALL',
    rawRole = 'ALL',
    rawQuery = '',
    rawFrom?: string,
    rawTo?: string,
  ) {
    const category = rawCategory.trim().toUpperCase()
    const role = rawRole.trim().toUpperCase()
    const query = rawQuery.trim().toLowerCase()

    const roleFilter = Object.values(UserRole).includes(role as UserRole)
      ? (role as UserRole)
      : null

    const from = rawFrom ? new Date(rawFrom) : null
    const to = rawTo ? new Date(rawTo) : null
    const validFrom = from && !Number.isNaN(from.getTime()) ? from : null
    const validTo = to && !Number.isNaN(to.getTime()) ? to : null

    const events = await this.prisma.authAuditEvent.findMany({
      where: {
        eventType: { startsWith: 'OPS_' },
        ...(roleFilter ? { user: { role: roleFilter } } : {}),
        ...(validFrom || validTo
          ? {
              createdAt: {
                ...(validFrom ? { gte: validFrom } : {}),
                ...(validTo ? { lte: validTo } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        eventType: true,
        metadata: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    const normalized = events.map((event) => ({
      ...event,
      category: auditCategory(event.eventType),
    }))

    const filtered = normalized.filter((event) => {
      if (category !== 'ALL' && event.category !== category) return false
      if (!query) return true

      return [
        event.eventType,
        event.category,
        event.user?.email ?? '',
        event.user?.role ?? '',
        JSON.stringify(event.metadata ?? {}),
      ].some((value) => value.toLowerCase().includes(query))
    })

    const summary = filtered.reduce(
      (acc, event) => {
        acc.total += 1
        acc.byCategory[event.category] =
          (acc.byCategory[event.category] ?? 0) + 1
        if (event.user?.role) {
          acc.byRole[event.user.role] =
            (acc.byRole[event.user.role] ?? 0) + 1
        }
        return acc
      },
      {
        total: 0,
        byCategory: {} as Record<string, number>,
        byRole: {} as Record<string, number>,
      },
    )

    return {
      summary,
      events: filtered.slice(0, 250),
    }
  }

  async search(
    rawQuery: string,
    role: UserRole = UserRole.ADMIN,
  ) {
    const query = rawQuery.trim()
    if (query.length < 2) return { clients: [], trips: [], reservations: [] }
    const documentQuery = query.replace(/\D/g, '')
    const canSearchOperations = role !== UserRole.FINANCE

    const [clients, trips, reservations] = await Promise.all([
      canSearchOperations
        ? this.prisma.client.findMany({
        where: {
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
            ...(documentQuery
              ? [{ document: { contains: documentQuery } }]
              : []),
          ],
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          document: true,
        },
        take: 8,
      })
        : Promise.resolve([]),
      canSearchOperations
        ? this.prisma.trip.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { origin: { contains: query, mode: 'insensitive' } },
            { destination: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          origin: true,
          destination: true,
          departureDate: true,
          status: true,
        },
        take: 8,
      })
        : Promise.resolve([]),
      this.prisma.reservation.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { client: { fullName: { contains: query, mode: 'insensitive' } } },
            { trip: { title: { contains: query, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          status: true,
          client: { select: { fullName: true } },
          trip: { select: { title: true, departureDate: true } },
        },
        take: 8,
      }),
    ])

    return { clients, trips, reservations }
  }
}
