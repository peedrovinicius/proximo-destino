import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { TripStatus } from '@prisma/client'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'

describe('compra pública da viagem', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const purchaseTripId = `purchase-trip-${suffix}`
  const reservationTripId = `reservation-trip-${suffix}`
  const purchaseEmail = `purchase-${suffix}@example.com`
  const reservationEmail = `reservation-${suffix}@example.com`

  const portal = new PortalService(
    prisma,
    new JwtService(),
    new ConfigService({
      JWT_ACCESS_SECRET: 'purchase-flow-test-secret',
    }),
  )

  before(async () => {
    await prisma.$connect()
    await prisma.trip.createMany({
      data: [
        {
          id: purchaseTripId,
          title: 'Compra de teste',
          origin: 'Origem',
          destination: 'Destino',
          departureDate: new Date(Date.now() + 7 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 4,
          priceCents: 12_500,
        },
        {
          id: reservationTripId,
          title: 'Reserva de teste',
          origin: 'Origem',
          destination: 'Destino',
          departureDate: new Date(Date.now() + 8 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 4,
          priceCents: 12_500,
        },
      ],
    })
  })

  after(async () => {
    await prisma.purchaseOrder.deleteMany({
      where: {
        reservation: {
          tripId: { in: [purchaseTripId, reservationTripId] },
        },
      },
    })
    await prisma.seatAssignment.deleteMany({
      where: { tripId: { in: [purchaseTripId, reservationTripId] } },
    })
    await prisma.reservation.deleteMany({
      where: { tripId: { in: [purchaseTripId, reservationTripId] } },
    })
    await prisma.client.deleteMany({
      where: { email: { in: [purchaseEmail, reservationEmail] } },
    })
    await prisma.trip.deleteMany({
      where: { id: { in: [purchaseTripId, reservationTripId] } },
    })
    await prisma.$disconnect()
  })

  it('cria pedido pendente com total calculado pela quantidade de passageiros', async () => {
    const result = await portal.requestReservation({
      tripId: purchaseTripId,
      fullName: 'Cliente comprador',
      email: purchaseEmail,
      phone: '85999999999',
      passengerCount: 2,
      selectedSeats: [1, 2],
      intent: 'PURCHASE',
      paymentMethod: 'PIX',
    })

    assert.ok(result.purchaseOrder)
    assert.equal(result.purchaseOrder?.status, 'PENDING_PAYMENT')
    assert.equal(result.purchaseOrder?.paymentMethod, 'PIX')
    assert.equal(result.purchaseOrder?.unitPriceCents, 12_500)
    assert.equal(result.purchaseOrder?.passengerCount, 2)
    assert.equal(result.purchaseOrder?.totalCents, 25_000)
    assert.deepEqual(result.selectedSeats, [1, 2])
  })

  it('mantém a solicitação de reserva sem criar pedido de compra', async () => {
    const result = await portal.requestReservation({
      tripId: reservationTripId,
      fullName: 'Cliente reserva',
      email: reservationEmail,
      phone: '85888888888',
      passengerCount: 1,
      selectedSeats: [3],
      intent: 'RESERVATION',
    })

    assert.equal(result.purchaseOrder, null)

    const count = await prisma.purchaseOrder.count({
      where: { reservationId: result.reservation.id },
    })
    assert.equal(count, 0)
  })
})
