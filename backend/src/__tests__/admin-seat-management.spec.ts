import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConflictException } from '@nestjs/common'
import { ReservationStatus, TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('gestão administrativa de assentos', () => {
  const prisma = new PrismaService()
  const trips = new TripsService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const tripId = `admin-seat-${suffix}`
  const clientId = `admin-seat-client-${suffix}`
  const reservationId = `admin-seat-reservation-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Passageiro do assento 1',
        email: `admin-seat-${suffix}@example.com`,
        phone: '85999999999',
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem para gestão de assentos',
        origin: 'Fortaleza',
        destination: 'Natal',
        departureDate: new Date(Date.now() + 7 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 4,
        busTemplate: 'CUSTOM',
        seatLayout: 'TWO_BY_TWO',
        deckCount: 1,
        blockedSeats: [],
      },
    })

    await prisma.reservation.create({
      data: {
        id: reservationId,
        clientId,
        tripId,
        status: ReservationStatus.CONFIRMED,
        passengerCount: 1,
      },
    })

    await prisma.seatAssignment.create({
      data: {
        tripId,
        reservationId,
        seatNumber: 1,
      },
    })
  })

  after(async () => {
    await prisma.seatAssignment.deleteMany({ where: { tripId } })
    await prisma.reservation.deleteMany({ where: { id: reservationId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.$disconnect()
  })

  it('mostra o ocupante e permite bloquear e liberar apenas lugares livres', async () => {
    const initial = await trips.findAdminSeatMap(tripId)

    assert.equal(initial.enabled, true)
    assert.deepEqual(initial.occupiedSeats, [1])
    assert.equal(initial.assignments[0]?.reservation.client.fullName, 'Passageiro do assento 1')

    const blocked = await trips.setSeatBlocked(tripId, 2, true)
    assert.deepEqual(blocked.blockedSeats, [2])
    assert.equal(blocked.availableCount, 2)

    await assert.rejects(
      () => trips.setSeatBlocked(tripId, 1, true),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('ocupado'),
    )

    const released = await trips.setSeatBlocked(tripId, 2, false)
    assert.deepEqual(released.blockedSeats, [])
    assert.equal(released.availableCount, 3)
  })
})
