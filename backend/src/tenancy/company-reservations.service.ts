import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { lockCompanyWrite } from './company-write-lock'
import { CreateReservationDto } from '../admin/dto/reservation.dto'

@Injectable()
export class CompanyReservationsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: CompanyScopeService) {}

  async create(userId: string, sessionId: string, data: CreateReservationDto) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de reservas')
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCompanyWrite(tx, scope)
        // Hold the parents against reassignment, capacity/status changes and competing bookings.
        await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${data.clientId} AND "companyId" = ${scope.companyId} FOR SHARE`
        await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${data.tripId} AND "companyId" = ${scope.companyId} FOR UPDATE`
        const client = await tx.client.findFirst({ where: { id: data.clientId, companyId: scope.companyId },
          select: { id: true, fullName: true } })
        const trip = await tx.trip.findFirst({ where: { id: data.tripId, companyId: scope.companyId },
          select: { id: true, status: true, capacity: true, blockedSeats: true, departureDate: true } })
        if (!client || !trip) throw new NotFoundException('Cliente ou viagem não encontrado')
        // Preparation only: no confirmation, checkout, message, document, access code or seat allocation.
        if (trip.status !== 'DRAFT' || trip.departureDate <= new Date()) {
          throw new ConflictException('Nesta etapa, reservas só podem ser preparadas em viagens futuras em rascunho')
        }
        if (await tx.reservation.findUnique({ where: { clientId_tripId: { clientId: client.id, tripId: trip.id } }, select: { id: true } })) {
          throw new ConflictException('Cliente já possui reserva nesta viagem')
        }
        const reserved = await tx.reservation.aggregate({ where: { tripId: trip.id, status: { not: 'CANCELLED' } },
          _sum: { passengerCount: true } })
        const blocked = new Set(trip.blockedSeats.filter(seat => seat >= 1 && seat <= (trip.capacity ?? 0))).size
        if (!trip.capacity || (reserved._sum.passengerCount ?? 0) + 1 > trip.capacity - blocked) {
          throw new ConflictException('Viagem sem capacidade disponível para preparar a reserva')
        }
        const reservation = await tx.reservation.create({ data: { companyId: scope.companyId,
          clientId: client.id, tripId: trip.id, status: 'PENDING', passengerCount: 1,
          passengers: { create: { sequence: 1, isPrimary: true, fullName: client.fullName } } },
          select: { id: true, status: true, passengerCount: true, createdAt: true,
            client: { select: { id: true, fullName: true } }, trip: { select: { id: true, title: true } } } })
        await tx.authAuditEvent.create({ data: { userId, eventType: 'OPS_COMPANY_RESERVATION_CREATED',
          metadata: { companyId: scope.companyId, reservationId: reservation.id, clientId: client.id, tripId: trip.id } } })
        return reservation
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Não foi possível preparar uma nova reserva nesta viagem')
      }
      throw error
    }
  }
}
