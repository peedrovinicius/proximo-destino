import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { BadRequestException, ConflictException } from '@nestjs/common'
import {
  BoardingStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('lista de embarque administrativa', () => {
  const prisma = new PrismaService()
  const trips = new TripsService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const tripId = `boarding-trip-${suffix}`
  const clientId = `boarding-client-${suffix}`
  const reservationId = `boarding-reservation-${suffix}`
  const actorUserId = `boarding-actor-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.user.create({
      data: {
        id: actorUserId,
        email: `boarding-admin-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Titular Embarque',
        email: `boarding-${suffix}@example.com`,
        phone: '85999999999',
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem lista de embarque',
        origin: 'Fortaleza',
        destination: 'Natal',
        departureDate: new Date(Date.now() + 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 4,
      },
    })

    await prisma.reservation.create({
      data: {
        id: reservationId,
        clientId,
        tripId,
        passengerCount: 2,
      },
    })

    await prisma.seatAssignment.createMany({
      data: [
        { reservationId, tripId, seatNumber: 1 },
        { reservationId, tripId, seatNumber: 2 },
      ],
    })
  })

  after(async () => {
    await prisma.reservation.deleteMany({ where: { id: reservationId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.authAuditEvent.deleteMany({ where: { userId: actorUserId } })
    await prisma.user.deleteMany({ where: { id: actorUserId } })
    await prisma.$disconnect()
  })

  it('reconstrói passageiros legados e atualiza o embarque', async () => {
    const initial = await trips.boardingList(tripId)

    assert.equal(initial.summary.total, 2)
    assert.equal(initial.summary.pending, 2)
    assert.equal(initial.summary.boarded, 0)
    assert.equal(initial.passengers[0]?.seatAssignment?.seatNumber, 1)
    assert.equal(initial.passengers[1]?.seatAssignment?.seatNumber, 2)

    const first = initial.passengers[0]
    const second = initial.passengers[1]
    assert.ok(first)
    assert.ok(second)

    await assert.rejects(
      () => trips.completeTrip(tripId),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('aguardando definição de embarque'),
    )

    const bulkBoarded = await trips.bulkUpdateBoardingStatus(
      tripId,
      [first.id, second.id],
      BoardingStatus.BOARDED,
      actorUserId,
    )

    assert.equal(bulkBoarded.summary.boarded, 2)
    assert.equal(bulkBoarded.summary.pending, 0)
    assert.ok(bulkBoarded.passengers.every((passenger) => passenger.boardedAt))

    await assert.rejects(
      () =>
        trips.bulkUpdateBoardingStatus(
          tripId,
          [first.id, 'passageiro-de-outra-viagem'],
          BoardingStatus.ABSENT,
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes('outra viagem'),
    )

    const reset = await trips.bulkUpdateBoardingStatus(
      tripId,
      [first.id, second.id],
      BoardingStatus.PENDING,
      actorUserId,
    )
    assert.equal(reset.summary.pending, 2)
    assert.equal(reset.summary.boarded, 0)

    const boarded = await trips.updateBoardingStatus(
      tripId,
      first.id,
      BoardingStatus.BOARDED,
      actorUserId,
    )

    assert.equal(boarded.summary.boarded, 1)
    assert.equal(boarded.summary.pending, 1)
    assert.equal(
      boarded.passengers.find((passenger) => passenger.id === first.id)
        ?.boardingStatus,
      BoardingStatus.BOARDED,
    )
    assert.ok(
      boarded.passengers.find((passenger) => passenger.id === first.id)
        ?.boardedAt,
    )

    const absent = await trips.updateBoardingStatus(
      tripId,
      second.id,
      BoardingStatus.ABSENT,
      actorUserId,
    )

    assert.equal(absent.summary.boarded, 1)
    assert.equal(absent.summary.absent, 1)
    assert.equal(absent.summary.pending, 0)

    const completed = await trips.completeTrip(tripId, actorUserId)
    assert.equal(completed?.status, TripStatus.COMPLETED)

    const completedReservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { status: true },
    })
    assert.equal(completedReservation?.status, ReservationStatus.COMPLETED)

    const audit = await trips.operationalAudit(tripId)
    assert.ok(
      audit.events.some(
        (event) =>
          event.eventType === 'OPS_BOARDING_BULK_UPDATED' &&
          event.user?.id === actorUserId,
      ),
    )
    assert.ok(
      audit.events.some(
        (event) => event.eventType === 'OPS_BOARDING_UPDATED',
      ),
    )
    assert.ok(
      audit.events.some(
        (event) => event.eventType === 'OPS_TRIP_COMPLETED',
      ),
    )

    await assert.rejects(
      () =>
        trips.updateBoardingStatus(
          tripId,
          first.id,
          BoardingStatus.PENDING,
        ),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('não pode ser alterado'),
    )
  })
})
