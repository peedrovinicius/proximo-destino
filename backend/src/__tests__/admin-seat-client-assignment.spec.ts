import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConflictException } from '@nestjs/common'
import {
  PurchasePaymentMethod,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('cadastro manual de cliente por poltrona', () => {
  const prisma = new PrismaService()
  const trips = new TripsService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const tripId = `manual-seat-trip-${suffix}`
  const onlineClientId = `manual-seat-online-client-${suffix}`
  const existingClientId = `manual-seat-existing-client-${suffix}`
  const onlineReservationId = `manual-seat-online-reservation-${suffix}`
  const actorUserId = `manual-seat-actor-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem cadastro manual',
        origin: 'Fortaleza',
        destination: 'Natal',
        departureDate: new Date(Date.now() + 3 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 4,
        seatLayout: 'TWO_BY_TWO',
        deckCount: 1,
        blockedSeats: [2],
        priceCents: 15000,
      },
    })

    await prisma.user.create({
      data: {
        id: actorUserId,
        email: `manual-seat-admin-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    await prisma.client.createMany({
      data: [
        {
          id: onlineClientId,
          fullName: 'Cliente Compra Online',
          email: `online-seat-${suffix}@example.com`,
          phone: '85911111111',
        },
        {
          id: existingClientId,
          fullName: 'Cliente Balcão',
          email: `balcao-seat-${suffix}@example.com`,
          phone: '85922222222',
        },
      ],
    })

    await prisma.reservation.create({
      data: {
        id: onlineReservationId,
        clientId: onlineClientId,
        tripId,
        status: ReservationStatus.CONFIRMED,
        passengerCount: 1,
        accessCodeHash: 'hash-publico-teste',
      },
    })

    const onlinePassenger = await prisma.reservationPassenger.create({
      data: {
        reservationId: onlineReservationId,
        sequence: 1,
        fullName: 'Cliente Compra Online',
        isPrimary: true,
      },
    })

    await prisma.seatAssignment.create({
      data: {
        tripId,
        reservationId: onlineReservationId,
        passengerId: onlinePassenger.id,
        seatNumber: 1,
      },
    })

    await prisma.purchaseOrder.create({
      data: {
        reservationId: onlineReservationId,
        paymentMethod: PurchasePaymentMethod.PIX,
        unitPriceCents: 15000,
        passengerCount: 1,
        totalCents: 15000,
      },
    })
  })

  after(async () => {
    await prisma.purchaseOrder.deleteMany({
      where: { reservation: { tripId } },
    })
    await prisma.reservation.deleteMany({ where: { tripId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({
      where: {
        OR: [
          { id: onlineClientId },
          { id: existingClientId },
          { email: `novo-seat-${suffix}@example.com` },
        ],
      },
    })
    await prisma.authAuditEvent.deleteMany({ where: { userId: actorUserId } })
    await prisma.user.deleteMany({ where: { id: actorUserId } })
    await prisma.$disconnect()
  })

  it('permite colocar cliente existente em poltrona livre e libera bloqueio da agência', async () => {
    const map = await trips.assignClientToSeat(
      tripId,
      2,
      { clientId: existingClientId },
      actorUserId,
    )

    const assignment = map.assignments.find((item) => item.seatNumber === 2)
    assert.ok(assignment)
    assert.equal(assignment.source, 'ADMIN_RESERVATION')
    assert.equal(assignment.reservation.client.id, existingClientId)
    assert.equal(assignment.reservation.status, ReservationStatus.CONFIRMED)
    assert.equal(map.blockedSeats.includes(2), false)
  })

  it('permite cadastrar novo cliente diretamente em outra poltrona livre', async () => {
    const map = await trips.assignClientToSeat(
      tripId,
      3,
      {
        fullName: 'Novo Cliente Balcão',
        email: `novo-seat-${suffix}@example.com`,
        phone: '85933333333',
        document: '12345678900',
      },
      actorUserId,
    )

    const assignment = map.assignments.find((item) => item.seatNumber === 3)
    assert.ok(assignment)
    assert.equal(assignment.source, 'ADMIN_RESERVATION')
    assert.equal(assignment.passenger?.fullName, 'Novo Cliente Balcão')
    assert.equal(assignment.passenger?.document, '12345678900')

    await trips.setSeatBlocked(tripId, 4, true, actorUserId)
    await trips.setSeatBlocked(tripId, 4, false, actorUserId)

    const audit = await trips.operationalAudit(tripId)
    assert.ok(
      audit.events.some(
        (event) =>
          event.eventType === 'OPS_SEAT_CLIENT_ASSIGNED' &&
          event.user?.id === actorUserId,
      ),
    )
    assert.ok(
      audit.events.some((event) => event.eventType === 'OPS_SEAT_BLOCKED'),
    )
    assert.ok(
      audit.events.some((event) => event.eventType === 'OPS_SEAT_RELEASED'),
    )
  })

  it('move passageiro para poltrona livre sem recriar a reserva', async () => {
    const before = await trips.findAdminSeatMap(tripId)
    const source = before.assignments.find((item) => item.seatNumber === 2)
    assert.ok(source)

    const moved = await trips.moveSeatAssignment(
      tripId,
      2,
      4,
      actorUserId,
    )

    const target = moved.assignments.find((item) => item.seatNumber === 4)
    assert.ok(target)
    assert.equal(
      moved.assignments.some((item) => item.seatNumber === 2),
      false,
    )
    assert.equal(target.reservation.id, source.reservation.id)
    assert.equal(target.reservation.client.id, existingClientId)
    assert.equal(target.source, 'ADMIN_RESERVATION')

    await assert.rejects(
      () => trips.moveSeatAssignment(tripId, 4, 1, actorUserId),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('compra online'),
    )

    const audit = await trips.operationalAudit(tripId)
    const event = audit.events.find(
      (item) => item.eventType === 'OPS_SEAT_MOVED',
    )
    assert.ok(event)
    assert.equal(event.user?.id, actorUserId)
    assert.equal(event.metadata?.fromSeatNumber, 2)
    assert.equal(event.metadata?.toSeatNumber, 4)
  })

  it('protege poltrona comprada diretamente pelo site', async () => {
    await assert.rejects(
      () =>
        trips.assignClientToSeat(tripId, 1, {
          fullName: 'Tentativa de Sobrescrita',
          email: `tentativa-${suffix}@example.com`,
        }),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes('comprada diretamente pelo site'),
    )

    const map = await trips.findAdminSeatMap(tripId)
    const assignment = map.assignments.find((item) => item.seatNumber === 1)

    assert.ok(assignment)
    assert.equal(assignment.source, 'ONLINE_PURCHASE')
    assert.equal(assignment.reservation.client.id, onlineClientId)
  })
})
