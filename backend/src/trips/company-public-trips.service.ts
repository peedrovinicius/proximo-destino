import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { describeBus, isSeatLayout, VEHICLE_FEATURE_TYPES, VEHICLE_FEATURE_POSITIONS, VEHICLE_FEATURE_SIDES } from './bus-templates'

const publicFields = { id: true, title: true, origin: true, destination: true, departureDate: true,
  returnDate: true, priceCents: true, summary: true, imageUrl: true, capacity: true } as const

@Injectable()
export class CompanyPublicTripsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async read<T>(slug: string, callback: (tx: Prisma.TransactionClient, company: { id: string; slug: string; tradeName: string }) => Promise<T>) {
    if (this.config.get<string>('COMPANY_FOUNDATION_ENABLED') !== 'true') throw new NotFoundException('Empresa não encontrada')
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) throw new NotFoundException('Empresa não encontrada')
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "slug" = ${slug} AND "status" = 'ACTIVE' FOR SHARE`
      const company = await tx.company.findFirst({ where: { slug, status: 'ACTIVE' }, select: { id: true, slug: true, tradeName: true } })
      if (!company) throw new NotFoundException('Empresa não encontrada')
      return callback(tx, company)
    }, { isolationLevel: 'RepeatableRead' })
  }

  catalog(slug: string, query: { origin?: unknown; destination?: unknown; departureDate?: unknown }) {
    const filter: Prisma.TripWhereInput = { status: { in: ['ACTIVE', 'SCHEDULED'] }, departureDate: { gte: new Date() } }
    for (const key of ['origin', 'destination'] as const) {
      const value = query[key]
      if (value !== undefined && (typeof value !== 'string' || value.length > 160)) throw new BadRequestException('Filtro inválido')
      if (typeof value === 'string' && value.trim()) filter[key] = { equals: value.trim(), mode: 'insensitive' }
    }
    if (query.departureDate !== undefined) {
      const value = query.departureDate
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Data inválida')
      const date = new Date(value + 'T00:00:00.000Z')
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Data inválida')
      const end = new Date(date); end.setUTCDate(end.getUTCDate() + 1)
      filter.departureDate = { gte: date > new Date() ? date : new Date(), lt: end }
    }
    return this.read(slug, async (tx, company) => {
      const rows = await tx.trip.findMany({ where: { ...filter, companyId: company.id }, select: publicFields,
        orderBy: [{ departureDate: 'asc' }, { id: 'asc' }], take: 101 })
      return { company: { slug: company.slug, tradeName: company.tradeName }, trips: rows.slice(0, 100),
        limit: 100, hasMore: rows.length > 100, readOnly: true }
    })
  }

  detail(slug: string, id: string) {
    return this.read(slug, async (tx, company) => {
      const trip = await tx.trip.findFirst({ where: { id, companyId: company.id,
        status: { in: ['ACTIVE', 'SCHEDULED'] }, departureDate: { gte: new Date() } }, select: publicFields })
      if (!trip) throw new NotFoundException('Viagem não encontrada')
      return { company: { slug: company.slug, tradeName: company.tradeName }, trip, readOnly: true }
    })
  }

  seats(slug: string, id: string) {
    return this.read(slug, async (tx, company) => {
      const trip = await tx.trip.findFirst({ where: { id, companyId: company.id,
        status: { in: ['ACTIVE', 'SCHEDULED'] }, departureDate: { gte: new Date() } },
        select: { capacity: true, busTemplate: true, seatLayout: true, deckCount: true,
          lowerDeckCapacity: true, vehicleFeatures: true, blockedSeats: true } })
      if (!trip) throw new NotFoundException('Viagem não encontrada')
      const assignments = await tx.seatAssignment.findMany({ where: { tripId: id, reservation: {
        companyId: company.id, tripId: id, client: { companyId: company.id }, status: { not: 'CANCELLED' },
      } }, select: { seatNumber: true }, orderBy: { seatNumber: 'asc' } })
      const total = await tx.seatAssignment.count({ where: { tripId: id, reservation: { status: { not: 'CANCELLED' } } } })
      const capacity = trip.capacity
      if (total !== assignments.length || assignments.some(row => !capacity || row.seatNumber < 1 || row.seatNumber > capacity)) {
        throw new ConflictException('Mapa contém vínculos inconsistentes')
      }
      if (!capacity || capacity < 1 || capacity > 80) return { enabled: false, capacity, readOnly: true }
      const deckCount = trip.deckCount === 2 ? 2 : 1
      const features = Array.isArray(trip.vehicleFeatures) ? trip.vehicleFeatures.flatMap(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const feature = value as Record<string, unknown>
        if (!VEHICLE_FEATURE_TYPES.includes(feature.type as never) || !VEHICLE_FEATURE_POSITIONS.includes(feature.position as never) ||
          !VEHICLE_FEATURE_SIDES.includes(feature.side as never) || (feature.deck !== 1 && feature.deck !== 2) || feature.deck > deckCount) return []
        return [{ type: feature.type, position: feature.position, side: feature.side, deck: feature.deck }]
      }) : []
      const blockedSeats = [...new Set(trip.blockedSeats.filter(n => n >= 1 && n <= capacity))].sort((a, b) => a - b)
      const occupiedSeats = assignments.map(row => row.seatNumber)
      return { enabled: true, readOnly: true, capacity, busTemplate: trip.busTemplate,
        busLabel: describeBus(trip.busTemplate, capacity), seatLayout: isSeatLayout(trip.seatLayout) ? trip.seatLayout : 'TWO_BY_TWO',
        deckCount, lowerDeckCapacity: deckCount === 2 && trip.lowerDeckCapacity && trip.lowerDeckCapacity > 0 && trip.lowerDeckCapacity < capacity ? trip.lowerDeckCapacity : null,
        vehicleFeatures: features, blockedSeats, occupiedSeats, availableCount: capacity - new Set([...blockedSeats, ...occupiedSeats]).size }
    })
  }
}
