import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { TripStatus } from '@prisma/client'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('layout avançado do ônibus', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const tripId = `advanced-seat-${suffix}`
  const email = `advanced-seat-${suffix}@example.com`

  const trips = new TripsService(prisma)
  const portal = new PortalService(
    prisma,
    new JwtService(),
    new ConfigService({
      JWT_ACCESS_SECRET: 'advanced-seat-test-secret',
    }),
  )

  before(async () => {
    await prisma.$connect()
    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Double Decker de teste',
        origin: 'Origem',
        destination: 'Destino',
        departureDate: new Date(Date.now() + 7 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 6,
        busTemplate: 'CUSTOM',
        seatLayout: 'TWO_BY_TWO',
        deckCount: 2,
        lowerDeckCapacity: 2,
        vehicleFeatures: [
          { type: 'STAIRS', deck: 1, position: 'MIDDLE', side: 'CENTER' },
          { type: 'RESTROOM', deck: 1, position: 'REAR', side: 'RIGHT' },
        ],
        blockedSeats: [6],
        priceCents: 10_000,
      },
    })
  })

  after(async () => {
    await prisma.seatAssignment.deleteMany({ where: { tripId } })
    await prisma.reservation.deleteMany({ where: { tripId } })
    await prisma.client.deleteMany({ where: { email } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.$disconnect()
  })

  it('expõe pisos, instalações e assentos bloqueados no mapa público', async () => {
    const map = await trips.findPublicSeatMap(tripId)

    assert.equal(map.enabled, true)
    assert.equal(map.deckCount, 2)
    assert.equal(map.lowerDeckCapacity, 2)
    assert.deepEqual(map.blockedSeats, [6])
    assert.equal(map.availableCount, 5)
    assert.equal(map.vehicleFeatures.length, 2)
    assert.equal(
      map.vehicleFeatures.some((feature) => feature.type === 'STAIRS'),
      true,
    )
  })

  it('não permite reservar um assento bloqueado', async () => {
    await assert.rejects(
      () =>
        portal.requestReservation({
          tripId,
          fullName: 'Passageiro bloqueado',
          email,
          phone: '85999999999',
          passengerCount: 1,
          selectedSeats: [6],
        }),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('bloqueado'),
    )
  })

  it('não permite bloquear um assento que já possui reserva ativa', async () => {
    const reservation = await portal.requestReservation({
      tripId,
      fullName: 'Passageiro válido',
      email,
      phone: '85999999999',
      passengerCount: 1,
      selectedSeats: [1],
    })

    assert.deepEqual(reservation.selectedSeats, [1])

    await assert.rejects(
      () => trips.update(tripId, { blockedSeats: [1, 6] }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes('reserva ativa'),
    )
  })
})
