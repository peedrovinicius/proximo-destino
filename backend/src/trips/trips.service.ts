import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  BoardingStatus,
  Prisma,
  ReservationStatus,
  TripStatus,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  AssignSeatClientDto,
  CreateTripDto,
  UpdateTripDto,
  VehicleFeatureDto,
} from './dto/admin-trip.dto'
import {
  describeBus,
  isSeatLayout,
  listBusTemplates,
  resolveBusTemplate,
  type VehicleFeature,
  VEHICLE_FEATURE_POSITIONS,
  VEHICLE_FEATURE_SIDES,
  VEHICLE_FEATURE_TYPES,
} from './bus-templates'

function isVehicleFeature(value: unknown): value is VehicleFeature {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>

  return (
    typeof item.type === 'string' &&
    VEHICLE_FEATURE_TYPES.includes(item.type as VehicleFeature['type']) &&
    (item.deck === 1 || item.deck === 2) &&
    typeof item.position === 'string' &&
    VEHICLE_FEATURE_POSITIONS.includes(
      item.position as VehicleFeature['position'],
    ) &&
    typeof item.side === 'string' &&
    VEHICLE_FEATURE_SIDES.includes(item.side as VehicleFeature['side'])
  )
}

function parseStoredFeatures(value: Prisma.JsonValue | null): VehicleFeature[] {
  if (!Array.isArray(value)) return []
  return value.filter(isVehicleFeature)
}

function normalizeFeatures(
  features: VehicleFeatureDto[] | null | undefined,
  deckCount: number,
): VehicleFeature[] {
  const normalized = (features ?? []).map((feature) => ({
    type: feature.type as VehicleFeature['type'],
    deck: feature.deck as 1 | 2,
    position: feature.position as VehicleFeature['position'],
    side: feature.side as VehicleFeature['side'],
  }))

  if (normalized.some((feature) => feature.deck > deckCount)) {
    throw new BadRequestException(
      'Há uma instalação posicionada em um andar inexistente',
    )
  }

  return normalized
}

function normalizeBlockedSeats(
  blockedSeats: number[] | undefined,
  capacity: number,
) {
  const normalized = [...new Set(blockedSeats ?? [])].sort((a, b) => a - b)

  if (normalized.some((seat) => seat < 1 || seat > capacity)) {
    throw new BadRequestException(
      'Há um assento bloqueado fora da capacidade do veículo',
    )
  }

  return normalized
}

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
        deckCount: true,
        lowerDeckCapacity: true,
        vehicleFeatures: true,
        blockedSeats: true,
      },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')

    const capacity = trip.capacity
    const seatLayout = isSeatLayout(trip.seatLayout)
      ? trip.seatLayout
      : 'TWO_BY_TWO'
    const busLabel = describeBus(trip.busTemplate, capacity)
    const deckCount = trip.deckCount === 2 ? 2 : 1
    const lowerDeckCapacity =
      deckCount === 2 &&
      trip.lowerDeckCapacity !== null &&
      capacity !== null &&
      trip.lowerDeckCapacity > 0 &&
      trip.lowerDeckCapacity < capacity
        ? trip.lowerDeckCapacity
        : null
    const vehicleFeatures = parseStoredFeatures(trip.vehicleFeatures)
      .filter((feature) => feature.deck <= deckCount)

    if (capacity === null || capacity < 1 || capacity > 80) {
      return {
        enabled: false,
        capacity,
        busTemplate: trip.busTemplate,
        busLabel,
        seatLayout,
        deckCount,
        lowerDeckCapacity,
        vehicleFeatures,
        blockedSeats: [] as number[],
        occupiedSeats: [] as number[],
        availableCount: capacity,
      }
    }

    const blockedSeats = trip.blockedSeats
      .filter((seat) => seat >= 1 && seat <= capacity)
      .sort((a, b) => a - b)

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
    const unavailableSeats = new Set([...occupiedSeats, ...blockedSeats])

    return {
      enabled: true,
      capacity,
      busTemplate: trip.busTemplate,
      busLabel,
      seatLayout,
      deckCount,
      lowerDeckCapacity,
      vehicleFeatures,
      blockedSeats,
      occupiedSeats,
      availableCount: Math.max(0, capacity - unavailableSeats.size),
    }
  }

  async findAdminSeatMap(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        origin: true,
        destination: true,
        departureDate: true,
        capacity: true,
        busTemplate: true,
        seatLayout: true,
        deckCount: true,
        lowerDeckCapacity: true,
        vehicleFeatures: true,
        blockedSeats: true,
      },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')

    const capacity = trip.capacity
    const seatLayout = isSeatLayout(trip.seatLayout)
      ? trip.seatLayout
      : 'TWO_BY_TWO'
    const deckCount = trip.deckCount === 2 ? 2 : 1
    const lowerDeckCapacity =
      deckCount === 2 &&
      trip.lowerDeckCapacity !== null &&
      capacity !== null &&
      trip.lowerDeckCapacity > 0 &&
      trip.lowerDeckCapacity < capacity
        ? trip.lowerDeckCapacity
        : null
    const vehicleFeatures = parseStoredFeatures(trip.vehicleFeatures)
      .filter((feature) => feature.deck <= deckCount)

    if (capacity === null || capacity < 1 || capacity > 80) {
      return {
        enabled: false,
        trip: {
          id: trip.id,
          title: trip.title,
          origin: trip.origin,
          destination: trip.destination,
          departureDate: trip.departureDate,
        },
        capacity,
        busLabel: describeBus(trip.busTemplate, capacity),
        seatLayout,
        deckCount,
        lowerDeckCapacity,
        vehicleFeatures,
        blockedSeats: [] as number[],
        occupiedSeats: [] as number[],
        assignments: [],
        availableCount: capacity,
      }
    }

    const blockedSeats = trip.blockedSeats
      .filter((seat) => seat >= 1 && seat <= capacity)
      .sort((a, b) => a - b)

    const assignments = await this.prisma.seatAssignment.findMany({
      where: {
        tripId: trip.id,
        reservation: { status: { not: ReservationStatus.CANCELLED } },
      },
      select: {
        seatNumber: true,
        passenger: {
          select: {
            id: true,
            sequence: true,
            fullName: true,
            document: true,
          },
        },
        reservation: {
          select: {
            id: true,
            status: true,
            passengerCount: true,
            accessCodeHash: true,
            purchaseOrder: { select: { id: true } },
            client: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { seatNumber: 'asc' },
    })

    const normalizedAssignments = assignments.map((assignment) => ({
      seatNumber: assignment.seatNumber,
      passenger: assignment.passenger,
      reservation: {
        id: assignment.reservation.id,
        status: assignment.reservation.status,
        passengerCount: assignment.reservation.passengerCount,
        client: assignment.reservation.client,
      },
      source: assignment.reservation.purchaseOrder
        ? 'ONLINE_PURCHASE'
        : assignment.reservation.accessCodeHash
          ? 'PUBLIC_RESERVATION'
          : 'ADMIN_RESERVATION',
    }))
    const occupiedSeats = normalizedAssignments.map((assignment) => assignment.seatNumber)
    const unavailableSeats = new Set([...blockedSeats, ...occupiedSeats])

    return {
      enabled: true,
      trip: {
        id: trip.id,
        title: trip.title,
        origin: trip.origin,
        destination: trip.destination,
        departureDate: trip.departureDate,
      },
      capacity,
      busLabel: describeBus(trip.busTemplate, capacity),
      seatLayout,
      deckCount,
      lowerDeckCapacity,
      vehicleFeatures,
      blockedSeats,
      occupiedSeats,
      assignments: normalizedAssignments,
      availableCount: Math.max(0, capacity - unavailableSeats.size),
    }
  }

  async assignClientToSeat(
    id: string,
    seatNumber: number,
    data: AssignSeatClientDto,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        capacity: true,
        blockedSeats: true,
      },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')
    if (trip.status === TripStatus.CANCELLED || trip.status === TripStatus.COMPLETED) {
      throw new ConflictException('Não é possível cadastrar passageiros nesta viagem')
    }
    if (trip.capacity === null || trip.capacity < 1 || trip.capacity > 80) {
      throw new BadRequestException('Esta viagem não possui mapa de assentos ativo')
    }
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > trip.capacity) {
      throw new BadRequestException('Assento fora da capacidade do veículo')
    }
    if (!data.clientId && !data.fullName?.trim()) {
      throw new BadRequestException('Selecione um cliente ou informe o nome completo')
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const occupied = await tx.seatAssignment.findUnique({
          where: {
            tripId_seatNumber: {
              tripId: id,
              seatNumber,
            },
          },
          select: {
            reservation: {
              select: {
                status: true,
                purchaseOrder: { select: { id: true } },
              },
            },
          },
        })

        if (occupied && occupied.reservation.status !== ReservationStatus.CANCELLED) {
          if (occupied.reservation.purchaseOrder) {
            throw new ConflictException(
              'Esta poltrona foi comprada diretamente pelo site e está protegida',
            )
          }
          throw new ConflictException('Esta poltrona já está ocupada')
        }

        let client:
          | {
              id: string
              fullName: string
              email: string | null
              phone: string | null
              document: string | null
              birthDate: Date | null
            }
          | null = null

        if (data.clientId) {
          client = await tx.client.findUnique({
            where: { id: data.clientId },
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              document: true,
              birthDate: true,
            },
          })
          if (!client) throw new NotFoundException('Cliente não encontrado')
        } else {
          const email = data.email?.trim().toLowerCase() || null
          if (email) {
            client = await tx.client.findUnique({
              where: { email },
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                document: true,
                birthDate: true,
              },
            })
          }

          if (client) {
            client = await tx.client.update({
              where: { id: client.id },
              data: {
                fullName: data.fullName?.trim() || client.fullName,
                phone: data.phone?.trim() || client.phone,
                document: data.document?.trim() || client.document,
                birthDate: data.birthDate ?? client.birthDate,
              },
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                document: true,
                birthDate: true,
              },
            })
          } else {
            client = await tx.client.create({
              data: {
                fullName: data.fullName!.trim(),
                email,
                phone: data.phone?.trim() || null,
                document: data.document?.trim() || null,
                birthDate: data.birthDate ?? null,
              },
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                document: true,
                birthDate: true,
              },
            })
          }
        }

        const existing = await tx.reservation.findUnique({
          where: {
            clientId_tripId: {
              clientId: client.id,
              tripId: id,
            },
          },
          select: {
            id: true,
            status: true,
            accessCodeHash: true,
            purchaseOrder: { select: { id: true } },
            seatAssignments: { select: { seatNumber: true } },
          },
        })

        if (existing?.purchaseOrder) {
          throw new ConflictException(
            'Este cliente já possui uma compra online nesta viagem',
          )
        }
        if (existing?.accessCodeHash) {
          throw new ConflictException(
            'Este cliente já possui uma solicitação feita pelo site nesta viagem',
          )
        }
        if (
          existing &&
          existing.status !== ReservationStatus.CANCELLED &&
          existing.seatAssignments.length
        ) {
          throw new ConflictException(
            `Este cliente já está na poltrona ${existing.seatAssignments[0].seatNumber}`,
          )
        }

        let reservationId: string

        if (existing) {
          reservationId = existing.id
          await tx.reservation.update({
            where: { id: existing.id },
            data: {
              status: ReservationStatus.CONFIRMED,
              passengerCount: 1,
            },
          })
          await tx.reservationPassenger.deleteMany({
            where: { reservationId: existing.id },
          })
        } else {
          const reservation = await tx.reservation.create({
            data: {
              clientId: client.id,
              tripId: id,
              status: ReservationStatus.CONFIRMED,
              passengerCount: 1,
            },
            select: { id: true },
          })
          reservationId = reservation.id
        }

        const passenger = await tx.reservationPassenger.create({
          data: {
            reservationId,
            sequence: 1,
            fullName: client.fullName,
            document: client.document,
            birthDate: client.birthDate,
            isPrimary: true,
          },
          select: { id: true },
        })

        await tx.seatAssignment.create({
          data: {
            tripId: id,
            reservationId,
            passengerId: passenger.id,
            seatNumber,
          },
        })

        if (trip.blockedSeats.includes(seatNumber)) {
          await tx.trip.update({
            where: { id },
            data: {
              blockedSeats: trip.blockedSeats.filter((seat) => seat !== seatNumber),
            },
          })
        }
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A poltrona acabou de ser ocupada. Atualize o mapa e escolha outra.',
        )
      }
      throw error
    }

    return this.findAdminSeatMap(id)
  }

  async setSeatBlocked(id: string, seatNumber: number, blocked: boolean) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: { capacity: true, blockedSeats: true },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')
    if (trip.capacity === null || trip.capacity < 1 || trip.capacity > 80) {
      throw new BadRequestException('Esta viagem não possui mapa de assentos ativo')
    }
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > trip.capacity) {
      throw new BadRequestException('Assento fora da capacidade do veículo')
    }

    if (blocked) {
      const occupied = await this.prisma.seatAssignment.findFirst({
        where: {
          tripId: id,
          seatNumber,
          reservation: { status: { not: ReservationStatus.CANCELLED } },
        },
        select: { reservationId: true },
      })
      if (occupied) {
        throw new ConflictException('Não é possível bloquear um assento ocupado')
      }
    }

    const nextBlocked = blocked
      ? [...new Set([...trip.blockedSeats, seatNumber])].sort((a, b) => a - b)
      : trip.blockedSeats.filter((seat) => seat !== seatNumber)

    await this.prisma.trip.update({
      where: { id },
      data: { blockedSeats: nextBlocked },
    })

    return this.findAdminSeatMap(id)
  }

  private async ensureTripPassengers(id: string) {
    const reservations = await this.prisma.reservation.findMany({
      where: {
        tripId: id,
        status: { not: ReservationStatus.CANCELLED },
      },
      select: {
        id: true,
        passengerCount: true,
        client: { select: { fullName: true } },
      },
    })

    for (const reservation of reservations) {
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
            select: { id: true },
            orderBy: { sequence: 'asc' },
          }),
          tx.seatAssignment.findMany({
            where: { reservationId: reservation.id },
            select: { id: true, passengerId: true },
            orderBy: { seatNumber: 'asc' },
          }),
        ])

        const usedPassengerIds = new Set(
          assignments
            .map((assignment) => assignment.passengerId)
            .filter((value): value is string => Boolean(value)),
        )
        const freePassengers = passengers.filter(
          (passenger) => !usedPassengerIds.has(passenger.id),
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
  }

  async boardingList(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        origin: true,
        destination: true,
        departureDate: true,
        returnDate: true,
        status: true,
      },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')

    await this.ensureTripPassengers(id)

    const passengers = await this.prisma.reservationPassenger.findMany({
      where: {
        reservation: {
          tripId: id,
          status: { not: ReservationStatus.CANCELLED },
        },
      },
      select: {
        id: true,
        sequence: true,
        fullName: true,
        document: true,
        birthDate: true,
        isPrimary: true,
        boardingStatus: true,
        boardedAt: true,
        seatAssignment: {
          select: { seatNumber: true },
        },
        reservation: {
          select: {
            id: true,
            status: true,
            client: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    })

    const sortedPassengers = [...passengers].sort((a, b) => {
      const seatA = a.seatAssignment?.seatNumber ?? Number.MAX_SAFE_INTEGER
      const seatB = b.seatAssignment?.seatNumber ?? Number.MAX_SAFE_INTEGER
      if (seatA !== seatB) return seatA - seatB
      const reservationCompare = a.reservation.id.localeCompare(b.reservation.id)
      if (reservationCompare !== 0) return reservationCompare
      return a.sequence - b.sequence
    })

    const total = sortedPassengers.length
    const boarded = sortedPassengers.filter(
      (passenger) => passenger.boardingStatus === BoardingStatus.BOARDED,
    ).length
    const absent = sortedPassengers.filter(
      (passenger) => passenger.boardingStatus === BoardingStatus.ABSENT,
    ).length

    return {
      trip,
      canUpdate:
        trip.status !== TripStatus.CANCELLED &&
        trip.status !== TripStatus.COMPLETED,
      summary: {
        total,
        boarded,
        absent,
        pending: Math.max(0, total - boarded - absent),
      },
      passengers: sortedPassengers,
    }
  }

  async updateBoardingStatus(
    id: string,
    passengerId: string,
    status: BoardingStatus,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: { status: true },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')
    if (
      trip.status === TripStatus.CANCELLED ||
      trip.status === TripStatus.COMPLETED
    ) {
      throw new ConflictException(
        'O embarque não pode ser alterado nesta viagem',
      )
    }

    await this.ensureTripPassengers(id)

    const passenger = await this.prisma.reservationPassenger.findFirst({
      where: {
        id: passengerId,
        reservation: {
          tripId: id,
          status: { not: ReservationStatus.CANCELLED },
        },
      },
      select: {
        id: true,
        boardedAt: true,
      },
    })

    if (!passenger) {
      throw new NotFoundException('Passageiro não encontrado nesta viagem')
    }

    await this.prisma.reservationPassenger.update({
      where: { id: passenger.id },
      data: {
        boardingStatus: status,
        boardedAt:
          status === BoardingStatus.BOARDED
            ? passenger.boardedAt ?? new Date()
            : null,
      },
    })

    return this.boardingList(id)
  }

  async bulkUpdateBoardingStatus(
    id: string,
    passengerIds: string[],
    status: BoardingStatus,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: { status: true },
    })

    if (!trip) throw new NotFoundException('Viagem não encontrada')
    if (
      trip.status === TripStatus.CANCELLED ||
      trip.status === TripStatus.COMPLETED
    ) {
      throw new ConflictException(
        'O embarque não pode ser alterado nesta viagem',
      )
    }

    await this.ensureTripPassengers(id)

    const validPassengers = await this.prisma.reservationPassenger.count({
      where: {
        id: { in: passengerIds },
        reservation: {
          tripId: id,
          status: { not: ReservationStatus.CANCELLED },
        },
      },
    })

    if (validPassengers !== passengerIds.length) {
      throw new BadRequestException(
        'Há passageiros inválidos ou de outra viagem na seleção',
      )
    }

    await this.prisma.reservationPassenger.updateMany({
      where: { id: { in: passengerIds } },
      data: {
        boardingStatus: status,
        boardedAt:
          status === BoardingStatus.BOARDED
            ? new Date()
            : null,
      },
    })

    return this.boardingList(id)
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
      ? resolveBusTemplate(
          data.busTemplate,
          data.capacity,
          data.seatLayout,
          data.deckCount,
          data.lowerDeckCapacity,
        )
      : data.capacity
        ? resolveBusTemplate(
            'CUSTOM',
            data.capacity,
            data.seatLayout,
            data.deckCount,
            data.lowerDeckCapacity,
          )
        : null

    const capacity = busConfig?.capacity ?? null
    const deckCount = busConfig?.deckCount ?? null
    const features = busConfig
      ? normalizeFeatures(
          data.vehicleFeatures ?? busConfig.defaultFeatures,
          busConfig.deckCount,
        )
      : []
    const blockedSeats = capacity
      ? normalizeBlockedSeats(data.blockedSeats, capacity)
      : []

    return this.prisma.trip.create({
      data: {
        title: data.title.trim(),
        origin: data.origin.trim(),
        destination: data.destination.trim(),
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        status: data.status ?? TripStatus.DRAFT,
        capacity,
        busTemplate: busConfig?.busTemplate ?? null,
        seatLayout: busConfig?.seatLayout ?? null,
        deckCount,
        lowerDeckCapacity: busConfig?.lowerDeckCapacity ?? null,
        vehicleFeatures: features as Prisma.InputJsonValue,
        blockedSeats,
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
        deckCount: true,
        lowerDeckCapacity: true,
        vehicleFeatures: true,
        blockedSeats: true,
      },
    })

    if (!existing) throw new NotFoundException('Viagem não encontrada')

    const busCoreTouched =
      data.busTemplate !== undefined ||
      data.capacity !== undefined ||
      data.seatLayout !== undefined ||
      data.deckCount !== undefined ||
      data.lowerDeckCapacity !== undefined

    let target = {
      capacity: existing.capacity,
      busTemplate: existing.busTemplate,
      seatLayout: existing.seatLayout,
      deckCount: existing.deckCount,
      lowerDeckCapacity: existing.lowerDeckCapacity,
      defaultFeatures: parseStoredFeatures(existing.vehicleFeatures),
    }

    if (busCoreTouched) {
      const requestedTemplate =
        data.busTemplate !== undefined
          ? data.busTemplate
          : existing.busTemplate ?? (existing.capacity ? 'CUSTOM' : null)

      if (requestedTemplate === null || data.capacity === null) {
        target = {
          capacity: null,
          busTemplate: null,
          seatLayout: null,
          deckCount: null,
          lowerDeckCapacity: null,
          defaultFeatures: [],
        }
      } else {
        const templateChanged =
          data.busTemplate !== undefined &&
          data.busTemplate !== existing.busTemplate
        const resolved = resolveBusTemplate(
          requestedTemplate ?? 'CUSTOM',
          data.capacity !== undefined ? data.capacity : existing.capacity,
          data.seatLayout !== undefined ? data.seatLayout : existing.seatLayout,
          data.deckCount !== undefined ? data.deckCount : existing.deckCount,
          data.lowerDeckCapacity !== undefined
            ? data.lowerDeckCapacity
            : existing.lowerDeckCapacity,
        )

        target = {
          capacity: resolved.capacity,
          busTemplate: resolved.busTemplate,
          seatLayout: resolved.seatLayout,
          deckCount: resolved.deckCount,
          lowerDeckCapacity: resolved.lowerDeckCapacity,
          defaultFeatures: templateChanged
            ? resolved.defaultFeatures
            : parseStoredFeatures(existing.vehicleFeatures),
        }
      }
    }

    const capacity = target.capacity
    let features: VehicleFeature[] = []
    let blockedSeats: number[] = []

    if (capacity !== null) {
      const decks = target.deckCount === 2 ? 2 : 1
      features = normalizeFeatures(
        data.vehicleFeatures !== undefined
          ? data.vehicleFeatures
          : target.defaultFeatures,
        decks,
      )
      blockedSeats = normalizeBlockedSeats(
        data.blockedSeats !== undefined ? data.blockedSeats : existing.blockedSeats,
        capacity,
      )

      const occupied = await this.prisma.seatAssignment.findMany({
        where: {
          tripId: id,
          reservation: { status: { not: ReservationStatus.CANCELLED } },
        },
        select: { seatNumber: true },
      })

      const outOfRange = occupied
        .map((assignment) => assignment.seatNumber)
        .filter((seat) => seat > capacity)

      if (outOfRange.length) {
        throw new BadRequestException(
          `Não é possível reduzir a lotação: há reserva ativa no(s) assento(s) ${outOfRange.join(', ')}`,
        )
      }

      const blockedOccupied = occupied
        .map((assignment) => assignment.seatNumber)
        .filter((seat) => blockedSeats.includes(seat))

      if (blockedOccupied.length) {
        throw new BadRequestException(
          `Não é possível bloquear assento(s) com reserva ativa: ${blockedOccupied.join(', ')}`,
        )
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
        capacity: target.capacity,
        busTemplate: target.busTemplate,
        seatLayout: target.seatLayout,
        deckCount: target.deckCount,
        lowerDeckCapacity: target.lowerDeckCapacity,
        vehicleFeatures: features as Prisma.InputJsonValue,
        blockedSeats,
        priceCents: data.priceCents,
        summary: data.summary?.trim(),
        imageUrl: data.imageUrl?.trim(),
      },
    })
  }
}
