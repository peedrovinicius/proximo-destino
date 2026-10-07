import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { lockCompanyRead, lockCompanyWrite } from './company-write-lock'
import { CancelReservationDto, CreateReservationDto, UpdateReservationPassengersDto } from '../admin/dto/reservation.dto'
import { encryptedDocumentFields } from '../security/sensitive-data'

const passengerFields = { id: true, sequence: true, fullName: true, birthDate: true, isPrimary: true } as const

@Injectable()
export class CompanyReservationsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: CompanyScopeService) {}

  async passengers(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso aos passageiros')
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const row = await tx.reservation.findFirst({ where: { id, companyId: scope.companyId,
        client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } },
        select: { passengers: { select: passengerFields, orderBy: { sequence: 'asc' } } } })
      if (!row) throw new NotFoundException('Reserva não encontrada')
      return row.passengers
    }, { isolationLevel: 'RepeatableRead' })
  }

  private async lockDraft(tx: Prisma.TransactionClient, companyId: string, id: string) {
    // Serialize with reservation creation through the trip lock, in the same order.
    const parent = await tx.reservation.findFirst({ where: { id, companyId,
      client: { companyId }, trip: { companyId } }, select: { tripId: true } })
    if (!parent) throw new NotFoundException('Reserva não encontrada')
    await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${parent.tripId} AND "companyId" = ${companyId} FOR UPDATE`
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`
    const row = await tx.reservation.findFirst({ where: { id, companyId,
      client: { companyId }, trip: { companyId } }, include: { trip: { select: { status: true } },
      passengers: { select: passengerFields }, _count: { select: { quotes: true, services: true,
        documents: true, seatAssignments: true, creditTransactions: true, manualPayments: true } },
      financePlan: { select: { id: true } }, purchaseOrder: { select: { id: true } } } })
    if (!row) throw new NotFoundException('Reserva não encontrada')
    if (row.status !== 'PENDING' || row.trip.status !== 'DRAFT' || row.accessCodeHash ||
      row.financePlan || row.purchaseOrder || Object.values(row._count).some(count => count > 0)) {
      throw new ConflictException('Operação permitida apenas em reserva pendente de rascunho sem vínculos operacionais')
    }
    return row
  }

  async updatePassengers(userId: string, sessionId: string, id: string, data: UpdateReservationPassengersDto) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role !== 'ADMIN') throw new ForbiddenException('Perfil sem acesso à edição de passageiros')
    if (!data.passengers.length || data.passengers.length > 80 || new Set(data.passengers.map(p => p.id)).size !== data.passengers.length) {
      throw new BadRequestException('Lista de passageiros inválida')
    }
    if (data.passengers.some(p => p.seatNumber != null)) throw new BadRequestException('Atribuição de assentos ainda não habilitada para empresas')
    return this.prisma.$transaction(async tx => {
      await lockCompanyWrite(tx, scope)
      const row = await this.lockDraft(tx, scope.companyId, id)
      const own = new Set(row.passengers.map(p => p.id))
      if (data.passengers.some(p => !own.has(p.id))) throw new NotFoundException('Passageiro não encontrado')
      for (const p of data.passengers) {
        if (p.fullName !== undefined && (!p.fullName?.trim() || p.fullName.trim().length < 2)) {
          throw new BadRequestException('Nome de passageiro inválido')
        }
        await tx.reservationPassenger.update({ where: { id: p.id, reservationId: id }, data: {
          fullName: p.fullName?.trim(), birthDate: p.birthDate,
          ...(p.document !== undefined ? encryptedDocumentFields(p.document?.trim() || null) : {}),
        } })
      }
      await tx.authAuditEvent.create({ data: { userId, eventType: 'OPS_COMPANY_PASSENGERS_UPDATED',
        metadata: { companyId: scope.companyId, reservationId: id, passengerCount: data.passengers.length } } })
      return tx.reservationPassenger.findMany({ where: { reservationId: id }, select: passengerFields, orderBy: { sequence: 'asc' } })
    })
  }

  async cancelDraft(userId: string, sessionId: string, id: string, data: CancelReservationDto) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role !== 'ADMIN') throw new ForbiddenException('Perfil sem acesso ao cancelamento de reservas')
    if (data.creditAsBonus) throw new BadRequestException('Crédito financeiro ainda não habilitado para empresas')
    return this.prisma.$transaction(async tx => {
      await lockCompanyWrite(tx, scope)
      await this.lockDraft(tx, scope.companyId, id)
      const result = await tx.reservation.update({ where: { id, companyId: scope.companyId, status: 'PENDING' },
        data: { status: 'CANCELLED' }, select: { id: true, status: true } })
      await tx.authAuditEvent.create({ data: { userId, eventType: 'OPS_COMPANY_DRAFT_RESERVATION_CANCELLED',
        metadata: { companyId: scope.companyId, reservationId: id } } })
      return result
    })
  }

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
