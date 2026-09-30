import { Injectable, NotFoundException } from '@nestjs/common'
import { ReservationStatus, TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateReservationDto } from './dto/reservation.dto'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
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
        this.prisma.client.findMany({
          where: { birthDate: { not: null } },
          select: { id: true, fullName: true, phone: true, birthDate: true },
        }),
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

  listReservations() {
    return this.prisma.reservation.findMany({
      select: {
        id: true,
        status: true,
        passengerCount: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, fullName: true, email: true, phone: true } },
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
  }

  async createReservation(data: CreateReservationDto) {
    const [client, trip] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } }),
      this.prisma.trip.findUnique({ where: { id: data.tripId }, select: { id: true } }),
    ])
    if (!client) throw new NotFoundException('Cliente não encontrado')
    if (!trip) throw new NotFoundException('Viagem não encontrada')

    return this.prisma.reservation.create({
      data: {
        clientId: data.clientId,
        tripId: data.tripId,
      },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        createdAt: true,
        client: { select: { id: true, fullName: true, email: true, phone: true } },
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
  }

  async updateReservationStatus(id: string, status: ReservationStatus) {
    const exists = await this.prisma.reservation.count({ where: { id } })
    if (!exists) throw new NotFoundException('Reserva não encontrada')

    return this.prisma.reservation.update({
      where: { id },
      data: { status },
    })
  }

  async search(rawQuery: string) {
    const query = rawQuery.trim()
    if (query.length < 2) return { clients: [], trips: [], reservations: [] }

    const [clients, trips, reservations] = await Promise.all([
      this.prisma.client.findMany({
        where: {
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, fullName: true, email: true, phone: true },
        take: 8,
      }),
      this.prisma.trip.findMany({
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
      }),
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
