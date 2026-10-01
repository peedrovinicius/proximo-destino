import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ReservationStatus, TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTripDto, UpdateTripDto } from './dto/admin-trip.dto'

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')

    const enabled =
      trip.capacity !== null &&
      trip.capacity >= 1 &&
      trip.capacity <= 80

    if (!enabled) {
      return {
        enabled: false,
        capacity: trip.capacity,
        occupiedSeats: [] as number[],
        availableCount: trip.capacity,
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
      capacity: trip.capacity,
      occupiedSeats,
      availableCount: Math.max(0, trip.capacity - occupiedSeats.length),
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
    return this.prisma.trip.create({
      data: {
        title: data.title.trim(),
        origin: data.origin.trim(),
        destination: data.destination.trim(),
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        status: data.status ?? TripStatus.DRAFT,
        capacity: data.capacity,
        priceCents: data.priceCents,
        summary: data.summary?.trim(),
        imageUrl: data.imageUrl?.trim(),
      },
    })
  }

  async update(id: string, data: UpdateTripDto) {
    const exists = await this.prisma.trip.count({ where: { id } })
    if (!exists) throw new NotFoundException('Viagem não encontrada')

    return this.prisma.trip.update({
      where: { id },
      data: {
        title: data.title?.trim(),
        origin: data.origin?.trim(),
        destination: data.destination?.trim(),
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        status: data.status,
        capacity: data.capacity,
        priceCents: data.priceCents,
        summary: data.summary?.trim(),
        imageUrl: data.imageUrl?.trim(),
      },
    })
  }
}
