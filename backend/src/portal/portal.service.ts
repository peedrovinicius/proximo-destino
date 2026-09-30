import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { QuoteStatus, ReservationStatus, TripStatus } from '@prisma/client'
import * as argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { ClientPortalLoginDto, RequestReservationDto } from './dto/portal.dto'

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async requestReservation(data: RequestReservationDto) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: data.tripId,
        status: { in: [TripStatus.ACTIVE, TripStatus.SCHEDULED] },
        departureDate: { gte: new Date() },
      },
      select: { id: true },
    })

    if (!trip) throw new NotFoundException('Viagem indisponível')

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

    const reservation = await this.prisma.reservation.create({
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

    return {
      reservation,
      accessCode,
      message: 'Solicitação recebida. Guarde o código para acessar sua viagem.',
    }
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

  async getPortal(clientId: string, reservationId: string) {
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
    return reservation
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
