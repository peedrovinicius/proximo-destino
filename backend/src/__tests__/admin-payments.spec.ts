import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import {
  PurchasePaymentMethod,
  PurchaseStatus,
  ReservationStatus,
  TripStatus,
} from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { PrismaService } from '../prisma/prisma.service'

describe('central de pagamentos do admin', () => {
  const prisma = new PrismaService()
  const admin = new AdminService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const clientIds = [1, 2, 3].map((n) => `payments-client-${suffix}-${n}`)
  const tripIds = [1, 2, 3].map((n) => `payments-trip-${suffix}-${n}`)
  const reservationIds = [1, 2, 3].map((n) => `payments-reservation-${suffix}-${n}`)

  before(async () => {
    await prisma.$connect()

    for (let i = 0; i < 3; i += 1) {
      await prisma.client.create({
        data: {
          id: clientIds[i],
          fullName: `Cliente Pagamento ${i + 1}`,
          email: `payment-${suffix}-${i + 1}@example.com`,
        },
      })

      await prisma.trip.create({
        data: {
          id: tripIds[i],
          title: `Viagem Pagamento ${i + 1}`,
          origin: 'Fortaleza',
          destination: 'Recife',
          departureDate: new Date(Date.now() + (i + 2) * 86_400_000),
          status: TripStatus.SCHEDULED,
          priceCents: 10_000 + i * 5_000,
        },
      })

      await prisma.reservation.create({
        data: {
          id: reservationIds[i],
          clientId: clientIds[i],
          tripId: tripIds[i],
          status: i === 0 ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING,
          passengerCount: 1,
        },
      })
    }

    await prisma.purchaseOrder.createMany({
      data: [
        {
          reservationId: reservationIds[0],
          status: PurchaseStatus.PAID,
          paymentMethod: PurchasePaymentMethod.PIX,
          unitPriceCents: 10_000,
          passengerCount: 1,
          totalCents: 10_000,
        },
        {
          reservationId: reservationIds[1],
          status: PurchaseStatus.PENDING_PAYMENT,
          paymentMethod: PurchasePaymentMethod.CARD,
          unitPriceCents: 15_000,
          passengerCount: 1,
          totalCents: 15_000,
        },
        {
          reservationId: reservationIds[2],
          status: PurchaseStatus.CANCELLED,
          paymentMethod: PurchasePaymentMethod.PIX,
          unitPriceCents: 20_000,
          passengerCount: 1,
          totalCents: 20_000,
        },
      ],
    })
  })

  after(async () => {
    await prisma.purchaseOrder.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.seatAssignment.deleteMany({
      where: { reservationId: { in: reservationIds } },
    })
    await prisma.reservation.deleteMany({
      where: { id: { in: reservationIds } },
    })
    await prisma.trip.deleteMany({
      where: { id: { in: tripIds } },
    })
    await prisma.client.deleteMany({
      where: { id: { in: clientIds } },
    })
    await prisma.$disconnect()
  })

  it('resume valores e relaciona cada pedido à reserva real', async () => {
    const result = await admin.paymentsDashboard()
    const ownOrders = result.orders.filter((order) =>
      reservationIds.includes(order.reservation.id),
    )

    assert.equal(ownOrders.length, 3)
    assert.ok(result.summary.paidOrders >= 1)
    assert.ok(result.summary.pendingOrders >= 1)
    assert.ok(result.summary.cancelledOrders >= 1)
    assert.ok(result.summary.paidCents >= 10_000)
    assert.ok(result.summary.pendingCents >= 15_000)

    const paid = ownOrders.find((order) => order.status === PurchaseStatus.PAID)
    assert.ok(paid)
    assert.equal(paid?.paymentMethod, PurchasePaymentMethod.PIX)
    assert.equal(paid?.totalCents, 10_000)
    assert.equal(paid?.reservation.client.fullName, 'Cliente Pagamento 1')
    assert.equal(paid?.reservation.trip.title, 'Viagem Pagamento 1')
  })
})
