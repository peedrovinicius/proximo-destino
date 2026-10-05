import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { lockCompanyWrite } from './company-write-lock'
import { AssignSeatClientDto, CreateTripDto, UpdateTripDto, VehicleFeatureDto } from '../trips/dto/admin-trip.dto'
import { describeBus, resolveBusTemplate } from '../trips/bus-templates'

const fields = { id: true, title: true, origin: true, destination: true,
  departureDate: true, returnDate: true, status: true, priceCents: true, summary: true,
  imageUrl: true, capacity: true, busTemplate: true, seatLayout: true, deckCount: true,
  lowerDeckCapacity: true, vehicleFeatures: true, blockedSeats: true } as const

@Injectable()
export class CompanyTripsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: CompanyScopeService) {}
  create(userId: string, sessionId: string, data: CreateTripDto) { return this.write(userId, sessionId, data) }
  update(userId: string, sessionId: string, id: string, data: UpdateTripDto) { return this.write(userId, sessionId, data, id) }

  async seatMap(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role !== 'ADMIN') throw new ForbiddenException('Perfil sem acesso ao mapa de assentos')
    return this.prisma.$transaction(tx => this.draftSeatMap(tx, scope.companyId, id), { isolationLevel: 'RepeatableRead' })
  }

  private async draftSeatMap(tx: Prisma.TransactionClient, companyId: string, id: string) {
    const trip = await tx.trip.findFirst({ where: { id, companyId },
      select: { ...fields, _count: { select: { seatAssignments: true } } } })
    if (!trip) throw new NotFoundException('Viagem não encontrada')
    if (trip.status !== 'DRAFT') {
      throw new ConflictException('Mapa operacional ainda não habilitado para empresas')
    }
    const enabled = trip.capacity !== null && trip.capacity >= 1 && trip.capacity <= 80
    const blockedSeats = enabled ? trip.blockedSeats.filter(s => s >= 1 && s <= trip.capacity!) : []
    const rows = await tx.seatAssignment.findMany({ where: { tripId: id, reservation: {
      companyId, tripId: id, client: { companyId }, status: 'PENDING', accessCodeHash: null,
      financePlan: null, purchaseOrder: null, quotes: { none: {} }, services: { none: {} },
      documents: { none: {} }, creditTransactions: { none: {} }, manualPayments: { none: {} },
    } }, select: { seatNumber: true, passenger: { select: { id: true, sequence: true, fullName: true, reservationId: true } },
      reservation: { select: { id: true, status: true, passengerCount: true, client: { select: { id: true, fullName: true } } } } },
      orderBy: { seatNumber: 'asc' } })
    if (rows.length !== trip._count.seatAssignments || rows.some(row => !row.passenger ||
      row.passenger.reservationId !== row.reservation.id || !enabled || row.seatNumber < 1 ||
      row.seatNumber > trip.capacity! || blockedSeats.includes(row.seatNumber))) {
      throw new ConflictException('Mapa de rascunho contém vínculos não preparatórios ou inconsistentes')
    }
    const assignments = rows.map(row => ({ seatNumber: row.seatNumber,
      passenger: { id: row.passenger!.id, sequence: row.passenger!.sequence, fullName: row.passenger!.fullName },
      reservation: row.reservation, source: 'ADMIN_RESERVATION' }))
    const occupiedSeats = assignments.map(row => row.seatNumber)
    return { enabled, preparatory: true, trip: { id: trip.id, title: trip.title, origin: trip.origin,
      destination: trip.destination, departureDate: trip.departureDate }, capacity: trip.capacity,
      busLabel: describeBus(trip.busTemplate, trip.capacity), seatLayout: trip.seatLayout ?? 'TWO_BY_TWO',
      deckCount: trip.deckCount ?? 1, lowerDeckCapacity: trip.lowerDeckCapacity,
      vehicleFeatures: trip.vehicleFeatures ?? [], blockedSeats, occupiedSeats, assignments,
      availableCount: enabled ? trip.capacity! - new Set([...blockedSeats, ...occupiedSeats]).size : trip.capacity }
  }

  assignDraftSeat(userId: string, sessionId: string, id: string, seatNumber: number, data: AssignSeatClientDto) {
    if (!data.clientId || Object.entries(data).some(([key, value]) => key !== 'clientId' && value !== undefined)) {
      throw new BadRequestException('Selecione um cliente com reserva preparatória existente; cadastro implícito não habilitado')
    }
    return this.changeDraftSeat(userId, sessionId, id, seatNumber, 'ASSIGN', data.clientId)
  }

  moveDraftSeat(userId: string, sessionId: string, id: string, seatNumber: number, toSeatNumber: number) {
    return this.changeDraftSeat(userId, sessionId, id, seatNumber, 'MOVE', undefined, toSeatNumber)
  }

  releaseDraftSeat(userId: string, sessionId: string, id: string, seatNumber: number) {
    return this.changeDraftSeat(userId, sessionId, id, seatNumber, 'RELEASE')
  }

  private async changeDraftSeat(userId: string, sessionId: string, id: string, seatNumber: number,
    action: 'ASSIGN' | 'MOVE' | 'RELEASE', clientId?: string, toSeatNumber?: number) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role !== 'ADMIN') throw new ForbiddenException('Perfil sem acesso à alocação de assentos')
    const target = toSeatNumber ?? seatNumber
    if ([seatNumber, target].some(n => !Number.isInteger(n) || n < 1 || n > 80)) throw new BadRequestException('Assento inválido')
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCompanyWrite(tx, scope)
        await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${id} AND "companyId" = ${scope.companyId} FOR UPDATE`
        const trip = await tx.trip.findFirst({ where: { id, companyId: scope.companyId }, select: fields })
        if (!trip) throw new NotFoundException('Viagem não encontrada')
        if (trip.status !== 'DRAFT' || (action !== 'RELEASE' && trip.departureDate <= new Date())) {
          throw new ConflictException('Alocação permitida somente em rascunho preparatório')
        }
        if (!trip.capacity || trip.capacity > 80 || seatNumber > trip.capacity || target > trip.capacity) {
          throw new BadRequestException('Assento fora da capacidade da viagem')
        }
        if (action !== 'RELEASE' && trip.blockedSeats.includes(target)) throw new ConflictException('Assento bloqueado')
        const source = action === 'ASSIGN' ? null : await tx.seatAssignment.findUnique({
          where: { tripId_seatNumber: { tripId: id, seatNumber } },
          select: { id: true, passengerId: true, reservationId: true, reservation: { select: { clientId: true } } },
        })
        if (action !== 'ASSIGN' && !source) throw new NotFoundException('Atribuição não encontrada')
        const selectedClient = clientId ?? source!.reservation.clientId
        await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${selectedClient} AND "companyId" = ${scope.companyId} FOR SHARE`
        const filter = { companyId: scope.companyId, clientId: selectedClient, tripId: id,
          client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } }
        const parent = await tx.reservation.findFirst({ where: filter, select: { id: true } })
        if (!parent) throw new NotFoundException('Reserva preparatória não encontrada')
        await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${parent.id} FOR UPDATE`
        const reservation = await tx.reservation.findFirst({ where: { ...filter, id: parent.id },
          include: { passengers: { select: { id: true, isPrimary: true, sequence: true } },
            financePlan: { select: { id: true } }, purchaseOrder: { select: { id: true } },
            _count: { select: { quotes: true, services: true, documents: true, creditTransactions: true, manualPayments: true } } } })
        if (!reservation) throw new NotFoundException('Reserva não encontrada')
        if (reservation.status !== 'PENDING' || reservation.accessCodeHash || reservation.financePlan || reservation.purchaseOrder ||
          Object.values(reservation._count).some(n => n > 0) || reservation.passengerCount !== 1 ||
          reservation.passengers.length !== 1 || !reservation.passengers[0].isPrimary || reservation.passengers[0].sequence !== 1) {
          throw new ConflictException('Atribuição exige reserva preparatória de um passageiro, sem vínculos operacionais')
        }
        const passengerId = reservation.passengers[0].id
        await tx.$queryRaw`SELECT "id" FROM "ReservationPassenger" WHERE "id" = ${passengerId} AND "reservationId" = ${reservation.id} FOR UPDATE`
        if (source && (source.reservationId !== reservation.id || source.passengerId !== passengerId)) {
          throw new ConflictException('Atribuição incompatível com o passageiro da reserva')
        }
        if (action !== 'RELEASE') {
          const occupied = await tx.seatAssignment.findUnique({ where: { tripId_seatNumber: { tripId: id, seatNumber: target } }, select: { id: true } })
          if (occupied && occupied.id !== source?.id) throw new ConflictException('Assento ocupado')
        }
        if (action === 'ASSIGN') {
          if (await tx.seatAssignment.findUnique({ where: { passengerId }, select: { id: true } })) throw new ConflictException('Passageiro já possui assento')
          await tx.seatAssignment.create({ data: { tripId: id, reservationId: reservation.id, passengerId, seatNumber } })
        } else if (action === 'MOVE') {
          await tx.seatAssignment.update({ where: { id: source!.id }, data: { seatNumber: target } })
        } else await tx.seatAssignment.delete({ where: { id: source!.id } })
        await tx.authAuditEvent.create({ data: { userId, eventType: `OPS_COMPANY_DRAFT_SEAT_${action}`,
          metadata: { companyId: scope.companyId, tripId: id, reservationId: reservation.id, passengerId, seatNumber, targetSeat: target } } })
        return this.draftSeatMap(tx, scope.companyId, id)
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Assento ou passageiro já atribuído')
      throw error
    }
  }

  async setSeatBlocked(userId: string, sessionId: string, id: string, seatNumber: number, blocked: boolean) {
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 80 || typeof blocked !== 'boolean') {
      throw new BadRequestException('Assento ou bloqueio inválido')
    }
    await this.write(userId, sessionId, {}, id, { seatNumber, blocked })
    return this.seatMap(userId, sessionId, id)
  }

  private async write(userId: string, sessionId: string, data: UpdateTripDto, id?: string,
    seatChange?: { seatNumber: number; blocked: boolean }) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de viagens')
    if (seatChange && scope.role !== 'ADMIN') throw new ForbiddenException('Perfil sem acesso ao bloqueio de assentos')
    if (data.status !== undefined && data.status !== 'DRAFT') throw new BadRequestException('Publicação de viagens ainda não habilitada para empresas')
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCompanyWrite(tx, scope)
        if (id) await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${id} AND "companyId" = ${scope.companyId} FOR UPDATE`
        const existing = id ? await tx.trip.findFirst({ where: { id, companyId: scope.companyId }, select: fields }) : null
        if (id && !existing) throw new NotFoundException('Viagem não encontrada')
        if (existing && (existing.status !== 'DRAFT' ||
          await tx.reservation.count({ where: { tripId: id } }) || await tx.seatAssignment.count({ where: { tripId: id } }))) {
          throw new ConflictException('Somente rascunhos sem reservas ou assentos atribuídos podem ser editados nesta etapa')
        }
        const provided = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
        if (seatChange) {
          const seats = new Set(existing!.blockedSeats)
          if (seatChange.blocked) seats.add(seatChange.seatNumber)
          else seats.delete(seatChange.seatNumber)
          provided.blockedSeats = [...seats]
          if (existing!.capacity === null || seatChange.seatNumber > existing!.capacity) {
            throw new BadRequestException('Assento fora da capacidade da viagem')
          }
        }
        const target = { ...existing, ...provided } as UpdateTripDto
        for (const key of ['title', 'origin', 'destination'] as const) {
          if (!target[key]?.trim()) throw new BadRequestException('Informe título, origem e destino')
        }
        if (!(target.departureDate instanceof Date) || !Number.isFinite(target.departureDate.getTime()) ||
          (target.returnDate && (!(target.returnDate instanceof Date) || !Number.isFinite(target.returnDate.getTime()) || target.returnDate < target.departureDate))) {
          throw new BadRequestException('Datas da viagem inválidas')
        }
        if (target.priceCents != null && (!Number.isInteger(target.priceCents) || target.priceCents < 0 || target.priceCents > 2147483647)) {
          throw new BadRequestException('Preço da viagem inválido')
        }
        const changedTemplate = data.busTemplate !== undefined && data.busTemplate !== existing?.busTemplate
        const key = target.busTemplate || (target.capacity ? 'CUSTOM' : null)
        const config = key ? resolveBusTemplate(key, target.capacity, target.seatLayout, target.deckCount, target.lowerDeckCapacity) : null
        const features = data.vehicleFeatures ?? (changedTemplate ? config?.defaultFeatures : target.vehicleFeatures) ?? config?.defaultFeatures ?? []
        const blocked = [...new Set(target.blockedSeats ?? [])].sort((a, b) => a - b)
        if ((!config && (features.length || blocked.length)) ||
          features.some(feature => feature.deck > (config?.deckCount ?? 0)) ||
          blocked.some(seat => seat < 1 || seat > (config?.capacity ?? 0))) {
          throw new BadRequestException('Configuração do veículo incompatível com a capacidade ou os andares')
        }
        const values = { title: target.title!.trim(), origin: target.origin!.trim(), destination: target.destination!.trim(),
          departureDate: target.departureDate!, returnDate: target.returnDate ?? null, status: 'DRAFT' as const,
          priceCents: target.priceCents, summary: target.summary?.trim(), imageUrl: target.imageUrl === null ? null : target.imageUrl?.trim(),
          capacity: config?.capacity ?? null, busTemplate: config?.busTemplate ?? null,
          seatLayout: config?.seatLayout ?? null, deckCount: config?.deckCount ?? null,
          lowerDeckCapacity: config?.lowerDeckCapacity ?? null,
          vehicleFeatures: features.map((feature: VehicleFeatureDto) => ({ type: feature.type, deck: feature.deck,
            position: feature.position, side: feature.side })) as Prisma.InputJsonValue, blockedSeats: blocked }
        const trip = id
          ? await tx.trip.update({ where: { id, companyId: scope.companyId, status: 'DRAFT' }, data: values, select: fields })
          : await tx.trip.create({ data: { ...values, companyId: scope.companyId }, select: fields })
        await tx.authAuditEvent.create({ data: { userId,
          eventType: id ? 'OPS_COMPANY_TRIP_UPDATED' : 'OPS_COMPANY_TRIP_CREATED',
          metadata: { companyId: scope.companyId, tripId: trip.id, fields: Object.keys(provided) } } })
        return trip
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('Viagem não encontrada')
      throw error
    }
  }
}
