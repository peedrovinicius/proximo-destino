import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { TripStatus } from '@prisma/client'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'

describe('correção de passageiros no portal do cliente', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const futureTripId = `client-passenger-future-${suffix}`
  const pastTripId = `client-passenger-past-${suffix}`
  const clientId = `client-passenger-client-${suffix}`
  const futureReservationId = `client-passenger-reservation-${suffix}`
  const pastReservationId = `client-passenger-past-reservation-${suffix}`

  const portal = new PortalService(
    prisma,
    new JwtService(),
    new ConfigService({
      JWT_ACCESS_SECRET: 'client-passenger-test-secret',
    }),
  )

  before(async () => {
    await prisma.$connect()

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Titular Original',
        email: `client-passenger-${suffix}@example.com`,
        phone: '85999999999',
      },
    })

    await prisma.trip.createMany({
      data: [
        {
          id: futureTripId,
          title: 'Viagem futura',
          origin: 'Fortaleza',
          destination: 'Natal',
          departureDate: new Date(Date.now() + 7 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 4,
        },
        {
          id: pastTripId,
          title: 'Viagem passada',
          origin: 'Fortaleza',
          destination: 'Recife',
          departureDate: new Date(Date.now() - 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 4,
        },
      ],
    })

    await prisma.reservation.createMany({
      data: [
        {
          id: futureReservationId,
          clientId,
          tripId: futureTripId,
          passengerCount: 2,
        },
        {
          id: pastReservationId,
          clientId,
          tripId: pastTripId,
          passengerCount: 1,
        },
      ],
    })

    await prisma.seatAssignment.createMany({
      data: [
        {
          reservationId: futureReservationId,
          tripId: futureTripId,
          seatNumber: 1,
        },
        {
          reservationId: futureReservationId,
          tripId: futureTripId,
          seatNumber: 2,
        },
      ],
    })
  })

  after(async () => {
    await prisma.reservation.deleteMany({
      where: { id: { in: [futureReservationId, pastReservationId] } },
    })
    await prisma.trip.deleteMany({
      where: { id: { in: [futureTripId, pastTripId] } },
    })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.$disconnect()
  })

  it('permite revisar passageiros antes da viagem e sincroniza o titular', async () => {
    const initial = await portal.getPortal(clientId, futureReservationId)

    assert.equal(initial.canEditPassengers, true)
    assert.equal(initial.passengers.length, 2)
    assert.equal(initial.passengers[0]?.seatAssignment?.seatNumber, 1)
    assert.equal(initial.passengers[1]?.seatAssignment?.seatNumber, 2)

    const updated = await portal.updateClientPassengers(
      clientId,
      futureReservationId,
      {
        passengers: [
          {
            id: initial.passengers[0]!.id,
            fullName: 'Titular Corrigido',
            document: '11122233344',
            birthDate: new Date('1995-05-20T12:00:00.000Z'),
          },
          {
            id: initial.passengers[1]!.id,
            fullName: 'Acompanhante Corrigido',
            document: '55566677788',
            birthDate: new Date('1998-09-10T12:00:00.000Z'),
          },
        ],
      },
    )

    assert.equal(updated.client.fullName, 'Titular Corrigido')
    assert.equal(updated.passengers[0]?.fullName, 'Titular Corrigido')
    assert.equal(updated.passengers[0]?.document, '11122233344')
    assert.equal(updated.passengers[1]?.fullName, 'Acompanhante Corrigido')
    assert.equal(updated.passengers[1]?.seatAssignment?.seatNumber, 2)
  })

  it('bloqueia alteração depois do início da viagem', async () => {
    const initial = await portal.getPortal(clientId, pastReservationId)
    assert.equal(initial.canEditPassengers, false)

    await assert.rejects(
      () =>
        portal.updateClientPassengers(clientId, pastReservationId, {
          passengers: [
            {
              id: initial.passengers[0]!.id,
              fullName: 'Tentativa tardia',
            },
          ],
        }),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('não podem mais ser alterados'),
    )
  })
})
