import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { NotFoundException } from '@nestjs/common'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'
import { PurchasePaymentMethod, QuoteStatus, TripStatus } from '@prisma/client'

// Real service authorization with simulated persistence; no production records.
describe('isolamento do portal por cliente e reserva', () => {
  const operations = [
    ['portal', (s: PortalService, c: string, r: string) => s.getPortal(c, r)],
    ['passageiros', (s: PortalService, c: string, r: string) => s.updateClientPassengers(c, r, { passengers: [] })],
    ['assentos', (s: PortalService, c: string, r: string) => s.updateClientSeats(c, r, { selectedSeats: [1] })],
    ['cancelamento', (s: PortalService, c: string, r: string) => s.requestCancellation(c, r, 'Teste')],
    ['pagamento', (s: PortalService, c: string, r: string) => s.retryPayment(c, r)],
    ['aprovar cotação', (s: PortalService, c: string, r: string) => s.approveQuote(c, r, 'quote-a')],
    ['recusar cotação', (s: PortalService, c: string, r: string) => s.rejectQuote(c, r, 'quote-a')],
  ] as const

  function fixture() {
    let mutations = 0
    let reads = 0
    const mutate = async () => { mutations++; throw new Error('Unexpected mutation') }
    const prisma = {
      reservation: {
        findFirst: async ({ where }: { where: { id?: string; clientId?: string } }) => {
          reads++
          return (!where.id || where.id === 'reservation-a') &&
            (!where.clientId || where.clientId === 'client-a')
            ? { id: 'reservation-a', clientId: 'client-a' } : null
        },
        update: mutate,
      },
      purchaseOrder: {
        findFirst: async ({ where }: { where: { reservationId?: string; reservation?: { clientId?: string } } }) => {
          reads++
          return (!where.reservationId || where.reservationId === 'reservation-a') &&
            (!where.reservation?.clientId || where.reservation.clientId === 'client-a')
            ? { id: 'purchase-a', status: 'PENDING_PAYMENT' } : null
        },
        update: mutate,
      },
      quote: {
        findFirst: async ({ where }: { where: { id?: string; reservationId?: string; reservation?: { clientId?: string } } }) => {
          reads++
          return (!where.id || where.id === 'quote-a') &&
            (!where.reservationId || where.reservationId === 'reservation-a') &&
            (!where.reservation?.clientId || where.reservation.clientId === 'client-a')
            ? { id: 'quote-a', status: 'SENT', items: [] } : null
        },
        update: mutate,
      },
      $transaction: mutate,
    } as unknown as PrismaService
    const service = new PortalService(prisma, new JwtService(), new ConfigService())
    return { service, counts: () => ({ mutations, reads }) }
  }

  for (const [name, operation] of operations) {
    for (const [scenario, clientId, reservationId] of [
      ['outro cliente', 'client-b', 'reservation-a'],
      ['outra reserva', 'client-a', 'reservation-b'],
    ] as const) {
      it(`${name}: nega ${scenario} antes de mutações ou provedores`, async () => {
        const { service, counts } = fixture()
        await assert.rejects(() => operation(service, clientId, reservationId), NotFoundException)
        assert.equal(counts().reads, 1)
        assert.equal(counts().mutations, 0)
      })
    }
  }
})

describe('isolamento do portal com PostgreSQL de teste', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID()
  const a = `ownership-a-${suffix}`
  const b = `ownership-b-${suffix}`
  const trip = `ownership-trip-${suffix}`
  const reservation = `ownership-reservation-${suffix}`
  const quote = `ownership-quote-${suffix}`
  const portal = new PortalService(prisma, new JwtService(), new ConfigService())
  let connected = false

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test', 'Requires isolated test environment')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    await prisma.$connect()
    connected = true
    await prisma.client.createMany({ data: [a, b].map(id => ({ id, fullName: id, email: `${id}@example.com`, phone: '85999999999' })) })
    await prisma.trip.create({ data: { id: trip, title: 'Isolamento', origin: 'Fortaleza', destination: 'Natal', departureDate: new Date(Date.now() + 7 * 86400000), status: TripStatus.SCHEDULED, capacity: 4 } })
    await prisma.reservation.create({ data: { id: reservation, clientId: a, tripId: trip, passengerCount: 1 } })
    await prisma.purchaseOrder.create({ data: { reservationId: reservation, paymentMethod: PurchasePaymentMethod.PIX, unitPriceCents: 1000, totalCents: 1000, passengerCount: 1 } })
    await prisma.quote.create({ data: { id: quote, reservationId: reservation, revision: 1, title: 'Cotação isolada', status: QuoteStatus.SENT } })
  })

  after(async () => {
    if (!connected) return
    try {
      await prisma.purchaseOrder.deleteMany({ where: { reservationId: reservation } })
      await prisma.quote.deleteMany({ where: { id: quote } })
      await prisma.reservation.deleteMany({ where: { id: reservation } })
      await prisma.trip.deleteMany({ where: { id: trip } })
      await prisma.client.deleteMany({ where: { id: { in: [a, b] } } })
    } finally { await prisma.$disconnect() }
  })

  it('recusa outro cliente em sete operações e mantém os registros intactos', async () => {
    const snapshot = async () => ({
      reservation: await prisma.reservation.findUnique({ where: { id: reservation } }),
      purchase: await prisma.purchaseOrder.findUnique({ where: { reservationId: reservation } }),
      quote: await prisma.quote.findUnique({ where: { id: quote } }),
      passengers: await prisma.reservationPassenger.findMany({ where: { reservationId: reservation } }),
      seats: await prisma.seatAssignment.findMany({ where: { reservationId: reservation } }),
    })
    const initial = await snapshot()
    for (const action of [
      () => portal.getPortal(b, reservation),
      () => portal.updateClientPassengers(b, reservation, { passengers: [] }),
      () => portal.updateClientSeats(b, reservation, { selectedSeats: [1] }),
      () => portal.requestCancellation(b, reservation, 'Teste'),
      () => portal.retryPayment(b, reservation),
      () => portal.approveQuote(b, reservation, quote),
      () => portal.rejectQuote(b, reservation, quote),
    ]) {
      await assert.rejects(action, NotFoundException)
      assert.deepEqual(await snapshot(), initial)
    }
  })

  it('permite ao titular consultar sua própria reserva', async () => {
    const result = await portal.getPortal(a, reservation)
    assert.ok(result)
    assert.equal(await prisma.reservationPassenger.count({ where: { reservationId: reservation } }), 1)
  })
})
