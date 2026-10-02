import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { TripStatus, UserRole } from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('fluxo de escolha de assentos', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const tripId = `seat-test-${suffix}`
  const firstEmail = `seat-first-${suffix}@example.com`
  const secondEmail = `seat-second-${suffix}@example.com`
  const thirdEmail = `seat-third-${suffix}@example.com`
  const actorUserId = `seat-admin-${suffix}`

  const portal = new PortalService(
    prisma,
    new JwtService(),
    new ConfigService({
      JWT_ACCESS_SECRET: 'seat-flow-test-secret',
    }),
  )
  const trips = new TripsService(prisma)
  const admin = new AdminService(prisma)

  before(async () => {
    await prisma.$connect()
    await prisma.user.create({
      data: {
        id: actorUserId,
        email: `seat-admin-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Teste automatizado de assentos',
        origin: 'Origem de teste',
        destination: 'Destino de teste',
        departureDate: new Date(Date.now() + 7 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 4,
        priceCents: 10_000,
      },
    })
  })

  after(async () => {
    await prisma.seatAssignment.deleteMany({ where: { tripId } })
    await prisma.reservation.deleteMany({ where: { tripId } })
    await prisma.client.deleteMany({
      where: { email: { in: [firstEmail, secondEmail, thirdEmail] } },
    })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.authAuditEvent.deleteMany({ where: { userId: actorUserId } })
    await prisma.user.deleteMany({ where: { id: actorUserId } })
    await prisma.$disconnect()
  })

  it('reserva, bloqueia concorrência, libera no cancelamento e permite nova reserva', async () => {
    const initialMap = await trips.findPublicSeatMap(tripId)
    assert.equal(initialMap.enabled, true)
    assert.equal(initialMap.capacity, 4)
    assert.equal(initialMap.availableCount, 4)
    assert.deepEqual(initialMap.occupiedSeats, [])

    const first = await portal.requestReservation({
      tripId,
      fullName: 'Primeiro passageiro',
      email: firstEmail,
      phone: '85999999999',
      passengerCount: 2,
      selectedSeats: [1, 2],
    })

    assert.deepEqual(first.selectedSeats, [1, 2])

    const firstClient = await prisma.client.findUniqueOrThrow({
      where: { email: firstEmail },
      select: { id: true },
    })

    const changedSeats = await portal.updateClientSeats(
      firstClient.id,
      first.reservation.id,
      { selectedSeats: [1, 4] },
    )
    assert.equal(changedSeats.canChangeSeats, true)
    assert.deepEqual(
      changedSeats.seatAssignments.map((seat) => seat.seatNumber),
      [1, 4],
    )

    const changedMap = await trips.findPublicSeatMap(tripId)
    assert.deepEqual(changedMap.occupiedSeats, [1, 4])

    const restoredSeats = await portal.updateClientSeats(
      firstClient.id,
      first.reservation.id,
      { selectedSeats: [1, 2] },
    )
    assert.deepEqual(
      restoredSeats.seatAssignments.map((seat) => seat.seatNumber),
      [1, 2],
    )

    const occupiedMap = await trips.findPublicSeatMap(tripId)
    assert.equal(occupiedMap.availableCount, 2)
    assert.deepEqual(occupiedMap.occupiedSeats, [1, 2])

    await assert.rejects(
      () =>
        portal.requestReservation({
          tripId,
          fullName: 'Segundo passageiro',
          email: secondEmail,
          phone: '85888888888',
          passengerCount: 1,
          selectedSeats: [2],
        }),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('assento'),
    )

    const second = await portal.requestReservation({
      tripId,
      fullName: 'Segundo passageiro',
      email: secondEmail,
      phone: '85888888888',
      passengerCount: 1,
      selectedSeats: [3],
    })

    assert.deepEqual(second.selectedSeats, [3])

    const threeOccupied = await trips.findPublicSeatMap(tripId)
    assert.equal(threeOccupied.availableCount, 1)
    assert.deepEqual(threeOccupied.occupiedSeats, [1, 2, 3])

    await admin.cancelReservation(
      first.reservation.id,
      false,
      'Cancelamento do teste de assentos',
      actorUserId,
    )

    const afterCancellation = await trips.findPublicSeatMap(tripId)
    assert.equal(afterCancellation.availableCount, 3)
    assert.deepEqual(afterCancellation.occupiedSeats, [3])

    const third = await portal.requestReservation({
      tripId,
      fullName: 'Terceiro passageiro',
      email: thirdEmail,
      phone: '85777777777',
      passengerCount: 2,
      selectedSeats: [1, 2],
    })

    assert.deepEqual(third.selectedSeats, [1, 2])

    const finalMap = await trips.findPublicSeatMap(tripId)
    assert.equal(finalMap.availableCount, 1)
    assert.deepEqual(finalMap.occupiedSeats, [1, 2, 3])

    const thirdClient = await prisma.client.findUniqueOrThrow({
      where: { email: thirdEmail },
      select: { id: true },
    })

    await prisma.trip.update({
      where: { id: tripId },
      data: { departureDate: new Date(Date.now() + 12 * 60 * 60 * 1000) },
    })

    await assert.rejects(
      () =>
        portal.updateClientSeats(
          thirdClient.id,
          third.reservation.id,
          { selectedSeats: [1, 4] },
        ),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('24 horas'),
    )
  })
})
