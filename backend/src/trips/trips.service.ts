import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ReservationStatus, TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTripDto, UpdateTripDto } from './dto/admin-trip.dto'
import {
  describeBus,
  isSeatLayout,
  listBusTemplates,
  resolveBusTemplate,
} from './bus-templates'

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  busTemplates() {
    return listBusTemplates()
  }

  async searchPublic(origin?: string, destination?: string, departureDate?: string) {
    let dateFilter: { gte: Date; lt?: Date }

    if (departureDate) {
      const start = new Date(`${departureDate}T00:00:00.000Z`)
      if (Number.isNaN(start.getTime())) {
        throw new BadRequestException('Data de ida inválida')
      }

      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 1)
      dateFilter = { gte: start, lt: end }
    } else {
      dateFilter = { gte: new Date() }
    }

    return this.prisma.trip.findMany({
      where: {
        status: { in: [TripStatus.ACTIVE, TripStatus.SCHEDULED] },
        departureDate: dateFilter,
        ...(origin?.trim()
          ? { origin: { equals: origin.trim(), mode: 'insensitive' } }
          : {}),
        ...(destination?.trim()
          ? { destination: { equals: destination.trim(), mode: 'insensitive' } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        origin: true,
        destination: true,
        departureDate: true,
        returnDate: true,
        capacity: true,
        busTemplate: true,
        seatLayout: true,
        priceCents: true,
        summary: true,
        imageUrl: true,
        status: true,
      },
      orderBy: [{ departureDate: 'asc' }, { destination: 'asc' }],
      take: 100,
    })
  }

  async findPublicSeatMap(id: string) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id,
        status: { in: [TripStatus.ACTIVE, TripStatus.SCHEDULED] },
        departureDate: { gte: new Date() },
      },
      select: {
        id: true,
        capacity: true,
        busTemplate: true,
        seatLayout: true,
      },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')

    const capacity = trip.capacity

    const seatLayout = isSeatLayout(trip.seatLayout)
      ? trip.seatLayout
      : 'TWO_BY_TWO'
    const busLabel = describeBus(trip.busTemplate, capacity)

    if (capacity === null || capacity < 1 || capacity > 80) {
      return {
        enabled: false,
        capacity,
        busTemplate: trip.busTemplate,
        busLabel,
        seatLayout,
        occupiedSeats: [] as number[],
        availableCount: capacity,
      }
    }

    const assignments = await this.prisma.seatAssignment.findMany({
      where: {
        tripId: trip.id,
        reservation: {
          status: { not: ReservationStatus.CANCELLED },
        },
      },
      select: { seatNumber: true },
      orderBy: { seatNumber: 'asc' },
    })

    const occupiedSeats = assignments.map((assignment) => assignment.seatNumber)

    return {
      enabled: true,
      capacity,
      busTemplate: trip.busTemplate,
      busLabel,
      seatLayout,
      occupiedSeats,
      availableCount: Math.max(0, capacity - occupiedSeats.length),
    }
  }

  async findPublicById(id: string) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id,
        status: { in: [TripStatus.ACTIVE, TripStatus.SCHEDULED] },
      },
      select: {
        id: true,
        title: true,
        origin: true,
        destination: true,
        departureDate: true,
        returnDate: true,
        capacity: true,
        busTemplate: true,
        seatLayout: true,
        priceCents: true,
        summary: true,
        imageUrl: true,
        status: true,
      },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')
    return trip
  }

  listAdmin(query?: string) {
    const q = query?.trim()

    return this.prisma.trip.findMany({
      where: q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { origin: { contains: q, mode: 'insensitive' } },
              { destination: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: { _count: { select: { reservations: true } } },
      orderBy: { departureDate: 'asc' },
      take: 100,
    })
  }

  create(data: CreateTripDto) {
    const busConfig = data.busTemplate
      ? resolveBusTemplate(data.busTemplate, data.capacity, data.seatLayout)
      : {
          busTemplate: null,
          capacity: data.capacity,
          seatLayout: data.seatLayout ?? null,
        }

    return this.prisma.trip.create({
      data: {
        title: data.title.trim(),
        origin: data.origin.trim(),
        destination: data.destination.trim(),
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        status: data.status ?? TripStatus.DRAFT,
        capacity: busConfig.capacity,
        busTemplate: busConfig.busTemplate,
        seatLayout: busConfig.seatLayout,
        priceCents: data.priceCents,
        summary: data.summary?.trim(),
        imageUrl: data.imageUrl?.trim(),
      },
    })
  }

  async update(id: string, data: UpdateTripDto) {
    const existing = await this.prisma.trip.findUnique({
      where: { id },
      select: {
        id: true,
        capacity: true,
        busTemplate: true,
        seatLayout: true,
      },
    })

    if (!existing) throw new NotFoundException('Viagem não encontrada')

    const busTouched =
      data.busTemplate !== undefined ||
      data.capacity !== undefined ||
      data.seatLayout !== undefined

    let busData: {
      capacity?: number | null
      busTemplate?: string | null
      seatLayout?: string | null
    } = {}

    if (busTouched) {
      if (data.busTemplate !== undefined) {
        if (data.busTemplate === null) {
          const capacity =
            data.capacity !== undefined ? data.capacity : existing.capacity
          const seatLayout =
            data.seatLayout !== undefined ? data.seatLayout : existing.seatLayout

          busData = capacity === null
            ? { capacity: null, busTemplate: null, seatLayout: null }
            : { capacity, busTemplate: null, seatLayout }
        } else {
          const config = resolveBusTemplate(
            data.busTemplate,
            data.capacity !== undefined ? data.capacity : existing.capacity,
            data.seatLayout !== undefined ? data.seatLayout : existing.seatLayout,
          )
          busData = {
            capacity: config.capacity,
            busTemplate: config.busTemplate,
            seatLayout: config.seatLayout,
          }
        }
      } else {
        const capacity =
          data.capacity !== undefined ? data.capacity : existing.capacity
        const seatLayout =
          data.seatLayout !== undefined ? data.seatLayout : existing.seatLayout

        if (capacity === null) {
          busData = { capacity: null, busTemplate: null, seatLayout: null }
        } else if (existing.busTemplate) {
          const config = resolveBusTemplate(
            'CUSTOM',
            capacity,
            seatLayout ?? 'TWO_BY_TWO',
          )
          busData = {
            capacity: config.capacity,
            busTemplate: config.busTemplate,
            seatLayout: config.seatLayout,
          }
        } else {
          busData = {
            capacity,
            busTemplate: null,
            seatLayout: isSeatLayout(seatLayout) ? seatLayout : null,
          }
        }
      }
    }

    return this.prisma.trip.update({
      where: { id },
      data: {
        title: data.title?.trim(),
        origin: data.origin?.trim(),
        destination: data.destination?.trim(),
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        status: data.status,
        ...busData,
        priceCents: data.priceCents,
        summary: data.summary?.trim(),
        imageUrl: data.imageUrl?.trim(),
      },
    })
  }
}
