import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { lockCompanyWrite } from './company-write-lock'
import { CreateTripDto, UpdateTripDto, VehicleFeatureDto } from '../trips/dto/admin-trip.dto'
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
    const trip = await this.prisma.trip.findFirst({ where: { id, companyId: scope.companyId },
      select: { ...fields, _count: { select: { seatAssignments: true } } } })
    if (!trip) throw new NotFoundException('Viagem não encontrada')
    if (trip.status !== 'DRAFT' || trip._count.seatAssignments) {
      throw new ConflictException('Mapa operacional ainda não habilitado para empresas')
    }
    const enabled = trip.capacity !== null && trip.capacity >= 1 && trip.capacity <= 80
    const blockedSeats = enabled ? trip.blockedSeats.filter(s => s >= 1 && s <= trip.capacity!) : []
    return { enabled, trip: { id: trip.id, title: trip.title, origin: trip.origin,
      destination: trip.destination, departureDate: trip.departureDate }, capacity: trip.capacity,
      busLabel: describeBus(trip.busTemplate, trip.capacity), seatLayout: trip.seatLayout ?? 'TWO_BY_TWO',
      deckCount: trip.deckCount ?? 1, lowerDeckCapacity: trip.lowerDeckCapacity,
      vehicleFeatures: trip.vehicleFeatures ?? [], blockedSeats, occupiedSeats: [], assignments: [],
      availableCount: enabled ? trip.capacity! - new Set(blockedSeats).size : trip.capacity }
  }

  setSeatBlocked(userId: string, sessionId: string, id: string, seatNumber: number, blocked: boolean) {
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 80 || typeof blocked !== 'boolean') {
      throw new BadRequestException('Assento ou bloqueio inválido')
    }
    return this.write(userId, sessionId, {}, id, { seatNumber, blocked })
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
