import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, ReservationStatus, TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTripDto, UpdateTripDto, VehicleFeatureDto } from './dto/admin-trip.dto'
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
        assignments: [] as Array<unknown>,
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
        reservation: {
          select: {
            id: true,
            status: true,
            passengerCount: true,
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

    const occupiedSeats = assignments.map((assignment) => assignment.seatNumber)
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
      assignments,
      availableCount: Math.max(0, capacity - unavailableSeats.size),
    }
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
