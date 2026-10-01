import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { BoardingStatus, TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('lista de embarque administrativa', () => {
  const prisma = new PrismaService()
  const trips = new TripsService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const tripId = `boarding-trip-${suffix}`
  const clientId = `boarding-client-${suffix}`
  const reservationId = `boarding-reservation-${suffix}`

  before(async () => {
    await prisma.$connect()

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

    const bulkBoarded = await trips.bulkUpdateBoardingStatus(
      tripId,
      [first.id, second.id],
      BoardingStatus.BOARDED,
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
    )
    assert.equal(reset.summary.pending, 2)
    assert.equal(reset.summary.boarded, 0)

    const boarded = await trips.updateBoardingStatus(
      tripId,
      first.id,
      BoardingStatus.BOARDED,
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
    )

    assert.equal(absent.summary.boarded, 1)
    assert.equal(absent.summary.absent, 1)
    assert.equal(absent.summary.pending, 0)

    await prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.COMPLETED },
    })

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
