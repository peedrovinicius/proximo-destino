import { Injectable, NotFoundException } from '@nestjs/common'
import { ReservationStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

const BLOCKING_STATUSES: ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
]

@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async exportClient(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        birthDate: true,
        document: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        companions: {
          select: {
            id: true,
            fullName: true,
            document: true,
            birthDate: true,
            relationship: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        reservations: {
          select: {
            id: true,
            status: true,
            passengerCount: true,
            createdAt: true,
            updatedAt: true,
            trip: {
              select: {
                id: true,
                title: true,
                origin: true,
                destination: true,
                departureDate: true,
                returnDate: true,
                status: true,
              },
            },
            quotes: {
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
                rejectedAt: true,
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
              orderBy: { revision: 'asc' },
            },
            services: {
              select: {
                id: true,
                category: true,
                description: true,
                supplier: true,
                amountCents: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
            financePlan: {
              select: {
                id: true,
                totalCents: true,
                downPaymentCents: true,
                installmentCount: true,
                createdAt: true,
                updatedAt: true,
                installments: {
                  select: {
                    id: true,
                    sequence: true,
                    dueDate: true,
                    amountCents: true,
                    status: true,
                    paidAt: true,
                    paymentMethod: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                  orderBy: { sequence: 'asc' },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!client) throw new NotFoundException('Cliente não encontrado')

    return {
      generatedAt: new Date(),
      purpose: 'Acesso aos dados pessoais e histórico operacional',
      client,
    }
  }

  async retentionReport(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        reservations: {
          select: {
            id: true,
            status: true,
            trip: {
              select: {
                title: true,
                departureDate: true,
                returnDate: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!client) throw new NotFoundException('Cliente não encontrado')

    const now = new Date()
    const blockers = client.reservations
      .filter((reservation) => {
        const finalTravelDate =
          reservation.trip.returnDate ?? reservation.trip.departureDate

        return (
          BLOCKING_STATUSES.includes(reservation.status) ||
          finalTravelDate.getTime() >= now.getTime()
        )
      })
      .map((reservation) => ({
        reservationId: reservation.id,
        status: reservation.status,
        trip: reservation.trip.title,
        departureDate: reservation.trip.departureDate,
        returnDate: reservation.trip.returnDate,
      }))

    return {
      client: {
        id: client.id,
        fullName: client.fullName,
      },
      canProceedToAnonymizationReview: blockers.length === 0,
      blockers,
      note:
        blockers.length === 0
          ? 'Não há viagem futura ou reserva pendente/confirmada. A anonimização ainda deve respeitar obrigações legais e fiscais aplicáveis.'
          : 'Há vínculos operacionais ativos. Não anonimizar enquanto existirem bloqueios.',
    }
  }
}
