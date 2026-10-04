import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { NotFoundException } from '@nestjs/common'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'

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
