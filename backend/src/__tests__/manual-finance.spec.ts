import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import {
  InstallmentStatus,
  ManualPaymentMethod,
  ManualPaymentStatus,
  QuoteStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { PrismaService } from '../prisma/prisma.service'

describe('financeiro manual auditável', () => {
  const prisma = new PrismaService()
  const admin = new AdminService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const actorId = `manual-finance-user-${suffix}`
  const clientId = `manual-finance-client-${suffix}`
  const tripId = `manual-finance-trip-${suffix}`
  const reservationId = `manual-finance-reservation-${suffix}`
  const quoteId = `manual-finance-quote-${suffix}`
  const planId = `manual-finance-plan-${suffix}`
  const firstInstallmentId = `manual-finance-installment-a-${suffix}`
  const secondInstallmentId = `manual-finance-installment-b-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.user.create({
      data: {
        id: actorId,
        email: `manual-finance-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Cliente Financeiro Manual',
        email: `manual-client-${suffix}@example.com`,
        phone: '85999997777',
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem Financeiro Manual',
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
      },
    })

    await prisma.quote.create({
      data: {
        id: quoteId,
        reservationId,
        revision: 1,
        status: QuoteStatus.APPROVED,
        title: 'Plano manual',
        subtotalSaleCents: 60000,
        totalCents: 60000,
        marginCents: 60000,
        approvedAt: new Date(),
      },
    })

    await prisma.financePlan.create({
      data: {
        id: planId,
        reservationId,
        quoteId,
        totalCents: 60000,
        installmentCount: 2,
        installments: {
          create: [
            {
              id: firstInstallmentId,
              sequence: 1,
              dueDate: new Date(Date.now() + 7 * 86_400_000),
              amountCents: 30000,
            },
            {
              id: secondInstallmentId,
              sequence: 2,
              dueDate: new Date(Date.now() + 14 * 86_400_000),
              amountCents: 30000,
            },
          ],
        },
      },
    })
  })

  after(async () => {
    await prisma.manualPayment.deleteMany({
      where: { reservationId },
    })
    await prisma.authAuditEvent.deleteMany({
      where: { userId: actorId },
    })
    await prisma.financePlan.deleteMany({
      where: { id: planId },
    })
    await prisma.quote.deleteMany({
      where: { id: quoteId },
    })
    await prisma.reservation.deleteMany({
      where: { id: reservationId },
    })
    await prisma.trip.deleteMany({
      where: { id: tripId },
    })
    await prisma.client.deleteMany({
      where: { id: clientId },
    })
    await prisma.user.deleteMany({
      where: { id: actorId },
    })
    await prisma.$disconnect()
  })

  it('aceita pagamento parcial e quita a parcela somente ao completar o valor', async () => {
    const partial = await admin.registerManualPayment(
      reservationId,
      {
        amountCents: 10000,
        method: ManualPaymentMethod.CASH,
        installmentId: firstInstallmentId,
        reference: 'REC-001',
      },
      actorId,
    )

    assert.equal(partial.summary.grossPaidCents, 10000)
    assert.equal(partial.summary.outstandingCents, 50000)
    assert.equal(partial.manualPayments.length, 1)

    let installment = await prisma.installment.findUniqueOrThrow({
      where: { id: firstInstallmentId },
    })
    assert.equal(installment.status, InstallmentStatus.OPEN)

    const completed = await admin.registerManualPayment(
      reservationId,
      {
        amountCents: 20000,
        method: ManualPaymentMethod.TRANSFER,
        installmentId: firstInstallmentId,
        reference: 'TED-ABC-002',
        note: 'Complemento da primeira parcela',
      },
      actorId,
    )

    assert.equal(completed.summary.grossPaidCents, 30000)
    assert.equal(completed.summary.outstandingCents, 30000)

    installment = await prisma.installment.findUniqueOrThrow({
      where: { id: firstInstallmentId },
    })
    assert.equal(installment.status, InstallmentStatus.PAID)
    assert.equal(installment.paymentMethod, ManualPaymentMethod.TRANSFER)
    assert.ok(installment.paidAt)
  })

  it('registra boleto e inclui todos os recebimentos na central de pagamentos', async () => {
    const finance = await admin.registerManualPayment(
      reservationId,
      {
        amountCents: 30000,
        method: ManualPaymentMethod.BOLETO,
        installmentId: secondInstallmentId,
        reference: 'BOLETO-778899',
      },
      actorId,
    )

    assert.equal(finance.summary.grossPaidCents, 60000)
    assert.equal(finance.summary.outstandingCents, 0)

    const dashboard = await admin.paymentsDashboard()
    const scoped = dashboard.manualPayments.filter(
      (item) => item.reservation.id === reservationId,
    )

    assert.equal(scoped.length, 3)
    assert.ok(
      scoped.some((item) => item.method === ManualPaymentMethod.CASH),
    )
    assert.ok(
      scoped.some((item) => item.method === ManualPaymentMethod.TRANSFER),
    )
    assert.ok(
      scoped.some((item) => item.method === ManualPaymentMethod.BOLETO),
    )
    assert.ok(dashboard.summary.manualReceivedCents >= 60000)
  })

  it('estorna sem apagar o lançamento e reabre a parcela quando necessário', async () => {
    const transfer = await prisma.manualPayment.findFirstOrThrow({
      where: {
        reservationId,
        method: ManualPaymentMethod.TRANSFER,
        status: ManualPaymentStatus.RECEIVED,
      },
    })

    const result = await admin.reverseManualPayment(
      reservationId,
      transfer.id,
      'Transferência devolvida ao cliente',
      actorId,
    )

    assert.equal(result.summary.refundedCents, 20000)
    assert.equal(result.summary.netPaidCents, 40000)
    assert.equal(result.summary.outstandingCents, 20000)

    const reversed = await prisma.manualPayment.findUniqueOrThrow({
      where: { id: transfer.id },
    })
    assert.equal(reversed.status, ManualPaymentStatus.REVERSED)
    assert.match(
      reversed.reversedReason ?? '',
      /devolvida ao cliente/i,
    )

    const installment = await prisma.installment.findUniqueOrThrow({
      where: { id: firstInstallmentId },
    })
    assert.equal(installment.status, InstallmentStatus.OPEN)
    assert.equal(installment.paidAt, null)

    const events = await prisma.authAuditEvent.findMany({
      where: {
        userId: actorId,
        eventType: {
          in: [
            'OPS_MANUAL_PAYMENT_RECEIVED',
            'OPS_MANUAL_PAYMENT_REVERSED',
          ],
        },
      },
    })
    assert.equal(events.length, 4)
  })
})
