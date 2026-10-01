import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { TripStatus } from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { PrismaService } from '../prisma/prisma.service'

describe('passageiros por reserva no admin', () => {
  const prisma = new PrismaService()
  const admin = new AdminService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const clientId = `passenger-client-${suffix}`
  const tripId = `passenger-trip-${suffix}`
  const reservationId = `passenger-reservation-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Titular da Reserva',
        email: `passenger-${suffix}@example.com`,
        phone: '85999999999',
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem com passageiros',
        origin: 'Fortaleza',
        destination: 'Recife',
        departureDate: new Date(Date.now() + 7 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 4,
        busTemplate: 'CUSTOM',
        seatLayout: 'TWO_BY_TWO',
        deckCount: 1,
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

  it('cria slots legados e permite identificar e trocar assentos', async () => {
    const initial = await admin.reservationPassengers(reservationId)

    assert.equal(initial.passengers.length, 2)
    assert.equal(initial.passengers[0]?.fullName, 'Titular da Reserva')
    assert.equal(initial.passengers[0]?.isPrimary, true)
    assert.equal(initial.passengers[0]?.seatAssignment?.seatNumber, 1)
    assert.equal(initial.passengers[1]?.seatAssignment?.seatNumber, 2)

    const first = initial.passengers[0]
    const second = initial.passengers[1]
    assert.ok(first)
    assert.ok(second)

    const updated = await admin.updateReservationPassengers(reservationId, {
      passengers: [
        {
          id: first.id,
          fullName: 'Titular Atualizado',
          document: '11122233344',
          seatNumber: 2,
        },
        {
          id: second.id,
          fullName: 'Acompanhante Identificado',
          document: '55566677788',
          seatNumber: 1,
        },
      ],
    })

    assert.equal(updated.passengers[0]?.fullName, 'Titular Atualizado')
    assert.equal(updated.passengers[0]?.document, '11122233344')
    assert.equal(updated.passengers[0]?.seatAssignment?.seatNumber, 2)
    assert.equal(updated.passengers[1]?.fullName, 'Acompanhante Identificado')
    assert.equal(updated.passengers[1]?.seatAssignment?.seatNumber, 1)
  })
})
