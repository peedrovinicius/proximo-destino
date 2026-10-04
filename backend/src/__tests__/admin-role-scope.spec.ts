import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import {
  ClientCreditTransactionType,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { PrismaService } from '../prisma/prisma.service'

describe('escopo de dados por papel administrativo', () => {
  const prisma = new PrismaService()
  const admin = new AdminService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const clientId = `role-client-${suffix}`
  const tripId = `role-trip-${suffix}`
  const reservationId = `role-reservation-${suffix}`

  before(async () => {
    await prisma.$connect()

    const today = new Date()
    await prisma.client.create({
      data: {
        id: clientId,
        fullName: `Cliente Escopo ${suffix}`,
        email: `scope-${suffix}@example.com`,
        phone: '85999990000',
        birthDate: new Date(
          Date.UTC(
            today.getUTCFullYear() - 30,
            today.getUTCMonth(),
            today.getUTCDate(),
          ),
        ),
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: `Viagem Escopo ${suffix}`,
        origin: 'Fortaleza',
        destination: 'Recife',
        departureDate: new Date(Date.now() + 30 * 86_400_000),
        status: TripStatus.SCHEDULED,
        capacity: 30,
      },
    })

    await prisma.reservation.create({
      data: {
        id: reservationId,
        clientId,
        tripId,
        status: ReservationStatus.CONFIRMED,
        cancellationRequestReason: 'Motivo privado do passageiro',
        cancellationRequestResolutionNote: 'Nota interna da operação',
      },
    })

    await prisma.clientCreditTransaction.create({
      data: {
        clientId,
        reservationId,
        type: ClientCreditTransactionType.CANCELLATION_CREDIT,
        amountCents: 12_345,
        sourceKey: `role-credit-${suffix}`,
      },
    })
  })

  after(async () => {
    await prisma.reservation.deleteMany({ where: { id: reservationId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.$disconnect()
  })

  it('não entrega aniversários ao financeiro', async () => {
    const finance = await admin.dashboard(UserRole.FINANCE)
    assert.equal(finance.birthdays.length, 0)

    const agent = await admin.dashboard(UserRole.AGENT)
    assert.ok(
      agent.birthdays.some((item) => item.id === clientId),
      'Agente deve continuar recebendo aniversários para relacionamento',
    )
  })

  it('minimiza dados pessoais e de relacionamento na reserva do financeiro', async () => {
    const financeReservations =
      await admin.listReservations(UserRole.FINANCE)
    const financeReservation = financeReservations.find(
      (item) => item.id === reservationId,
    )

    assert.ok(financeReservation)
    assert.equal(financeReservation.client.fullName, `Cliente Escopo ${suffix}`)
    assert.equal(financeReservation.client.email, null)
    assert.equal(financeReservation.client.phone, null)
    assert.equal(financeReservation.client.bonusBalanceCents, 0)
    assert.equal(financeReservation.cancellationRequestReason, null)
    assert.equal(
      financeReservation.cancellationRequestResolutionNote,
      null,
    )

    const agentReservations =
      await admin.listReservations(UserRole.AGENT)
    const agentReservation = agentReservations.find(
      (item) => item.id === reservationId,
    )

    assert.ok(agentReservation)
    assert.equal(agentReservation.client.email, `scope-${suffix}@example.com`)
    assert.equal(agentReservation.client.phone, '85999990000')
    assert.equal(agentReservation.client.bonusBalanceCents, 12_345)
    assert.equal(
      agentReservation.cancellationRequestReason,
      'Motivo privado do passageiro',
    )
  })

  it('limita a busca do financeiro a reservas', async () => {
    const finance = await admin.search(suffix, UserRole.FINANCE)

    assert.equal(finance.clients.length, 0)
    assert.equal(finance.trips.length, 0)
    assert.ok(
      finance.reservations.some((item) => item.id === reservationId),
      'Financeiro deve localizar a reserva sem navegar pela base operacional',
    )
  })

  it('mantém clientes viagens e reservas disponíveis ao agente', async () => {
    const agent = await admin.search(suffix, UserRole.AGENT)

    assert.ok(agent.clients.some((item) => item.id === clientId))
    assert.ok(agent.trips.some((item) => item.id === tripId))
    assert.ok(
      agent.reservations.some((item) => item.id === reservationId),
    )
  })
})
