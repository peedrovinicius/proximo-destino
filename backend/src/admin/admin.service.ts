import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ReservationStatus, TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateReservationDto, UpdateReservationPassengersDto } from './dto/reservation.dto'

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
        seatAssignments: {
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        },
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

  private async ensureReservationPassengers(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        passengerCount: true,
        client: { select: { fullName: true } },
        passengers: {
          select: { id: true, sequence: true },
          orderBy: { sequence: 'asc' },
        },
        seatAssignments: {
          select: { id: true, seatNumber: true, passengerId: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')

    await this.prisma.$transaction(async (tx) => {
      for (let sequence = 1; sequence <= reservation.passengerCount; sequence += 1) {
        await tx.reservationPassenger.upsert({
          where: {
            reservationId_sequence: {
              reservationId: reservation.id,
              sequence,
            },
          },
          update: {},
          create: {
            reservationId: reservation.id,
            sequence,
            fullName: sequence === 1 ? reservation.client.fullName : null,
            isPrimary: sequence === 1,
          },
        })
      }

      const [passengers, assignments] = await Promise.all([
        tx.reservationPassenger.findMany({
          where: { reservationId: reservation.id },
          select: { id: true, sequence: true },
          orderBy: { sequence: 'asc' },
        }),
        tx.seatAssignment.findMany({
          where: { reservationId: reservation.id },
          select: { id: true, passengerId: true },
          orderBy: { seatNumber: 'asc' },
        }),
      ])

      const assignedPassengerIds = new Set(
        assignments
          .map((assignment) => assignment.passengerId)
          .filter((value): value is string => Boolean(value)),
      )
      const freePassengers = passengers.filter(
        (passenger) => !assignedPassengerIds.has(passenger.id),
      )
      const freeAssignments = assignments.filter(
        (assignment) => assignment.passengerId === null,
      )

      for (let index = 0; index < freeAssignments.length; index += 1) {
        const passenger = freePassengers[index]
        if (!passenger) break
        await tx.seatAssignment.update({
          where: { id: freeAssignments[index].id },
          data: { passengerId: passenger.id },
        })
      }
    })
  }

  async reservationPassengers(id: string) {
    await this.ensureReservationPassengers(id)

    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        client: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        trip: {
          select: {
            id: true,
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
          },
        },
        passengers: {
          select: {
            id: true,
            sequence: true,
            fullName: true,
            document: true,
            birthDate: true,
            isPrimary: true,
            seatAssignment: { select: { seatNumber: true } },
          },
          orderBy: { sequence: 'asc' },
        },
        seatAssignments: {
          select: { seatNumber: true, passengerId: true },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    return reservation
  }

  async updateReservationPassengers(
    id: string,
    data: UpdateReservationPassengersDto,
  ) {
    const current = await this.reservationPassengers(id)

    if (data.passengers.length !== current.passengerCount) {
      throw new BadRequestException(
        `A reserva exige exatamente ${current.passengerCount} passageiro(s)`,
      )
    }

    const expectedIds = new Set(current.passengers.map((passenger) => passenger.id))
    if (
      new Set(data.passengers.map((passenger) => passenger.id)).size !==
        data.passengers.length ||
      data.passengers.some((passenger) => !expectedIds.has(passenger.id))
    ) {
      throw new BadRequestException('A lista de passageiros não pertence a esta reserva')
    }

    const seatNumbers = data.passengers
      .map((passenger) => passenger.seatNumber)
      .filter((seat): seat is number => seat !== null && seat !== undefined)

    if (new Set(seatNumbers).size !== seatNumbers.length) {
      throw new BadRequestException('Um assento não pode ser atribuído a dois passageiros')
    }

    const reservationSeats = new Set(
      current.seatAssignments.map((assignment) => assignment.seatNumber),
    )
    if (seatNumbers.some((seat) => !reservationSeats.has(seat))) {
      throw new BadRequestException('Só é possível vincular assentos desta reserva')
    }

    const primary = current.passengers.find((passenger) => passenger.isPrimary)
    const primaryInput = primary
      ? data.passengers.find((passenger) => passenger.id === primary.id)
      : null
    if (!primaryInput?.fullName?.trim()) {
      throw new BadRequestException('O passageiro titular deve ter nome')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.seatAssignment.updateMany({
        where: { reservationId: id },
        data: { passengerId: null },
      })

      for (const passenger of data.passengers) {
        await tx.reservationPassenger.update({
          where: { id: passenger.id },
          data: {
            fullName: passenger.fullName?.trim() || null,
            document: passenger.document?.trim() || null,
            birthDate: passenger.birthDate ?? null,
          },
        })

        if (passenger.seatNumber !== null && passenger.seatNumber !== undefined) {
          await tx.seatAssignment.update({
            where: {
              reservationId_seatNumber: {
                reservationId: id,
                seatNumber: passenger.seatNumber,
              },
            },
            data: { passengerId: passenger.id },
          })
        }
      }
    })

    return this.reservationPassengers(id)
  }

  async paymentsDashboard() {
    const orders = await this.prisma.purchaseOrder.findMany({
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        unitPriceCents: true,
        passengerCount: true,
        totalCents: true,
        createdAt: true,
        updatedAt: true,
        reservation: {
          select: {
            id: true,
            status: true,
            seatAssignments: {
              select: { seatNumber: true },
              orderBy: { seatNumber: 'asc' },
            },
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
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const summary = orders.reduce(
      (acc, order) => {
        acc.totalOrders += 1
        if (order.status === 'PAID') {
          acc.paidOrders += 1
          acc.paidCents += order.totalCents
        } else if (order.status === 'PENDING_PAYMENT') {
          acc.pendingOrders += 1
          acc.pendingCents += order.totalCents
        } else if (order.status === 'CANCELLED') {
          acc.cancelledOrders += 1
        } else if (order.status === 'EXPIRED') {
          acc.expiredOrders += 1
        }
        return acc
      },
      {
        totalOrders: 0,
        paidOrders: 0,
        pendingOrders: 0,
        cancelledOrders: 0,
        expiredOrders: 0,
        paidCents: 0,
        pendingCents: 0,
      },
    )

    return { summary, orders }
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
        seatAssignments: {
          select: { seatNumber: true },
          orderBy: { seatNumber: 'asc' },
        },
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

    if (status === ReservationStatus.CANCELLED) {
      return this.prisma.$transaction(async (tx) => {
        await tx.seatAssignment.deleteMany({ where: { reservationId: id } })
        return tx.reservation.update({
          where: { id },
          data: { status },
        })
      })
    }

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
