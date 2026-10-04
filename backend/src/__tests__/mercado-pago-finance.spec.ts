import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  PurchasePaymentMethod,
  PurchaseStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import {
  Order,
  Payment,
  PaymentRefund,
  WebhookSignatureValidator,
} from 'mercadopago'
import { AdminService } from '../admin/admin.service'
import { PortalService } from '../portal/portal.service'
import { PrismaService } from '../prisma/prisma.service'

describe('Mercado Pago: webhook e reconciliação', () => {
  const prisma = new PrismaService()
  const suffix = randomUUID().slice(0, 8)
  const actorId = `mp-admin-${suffix}`
  const pixClientId = `mp-pix-client-${suffix}`
  const pixTripId = `mp-pix-trip-${suffix}`
  const pixReservationId = `mp-pix-reservation-${suffix}`
  const cardClientId = `mp-card-client-${suffix}`
  const cardTripId = `mp-card-trip-${suffix}`
  const cardReservationId = `mp-card-reservation-${suffix}`

  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'mp-finance-test-secret',
    MERCADO_PAGO_WEBHOOK_SECRET: 'mp-webhook-test-secret',
  })

  const paymentConnection = {
    status: async () => ({ readyForPayments: true }),
    getAccessToken: async () => 'fake-access-token',
  }

  const portal = new PortalService(
    prisma,
    new JwtService(),
    config,
    paymentConnection as never,
  )
  const admin = new AdminService(
    prisma,
    paymentConnection as never,
  )

  const originalSignatureValidate = WebhookSignatureValidator.validate
  const originalPaymentGet = Payment.prototype.get
  const originalRefundList = PaymentRefund.prototype.list
  const originalOrderGet = Order.prototype.get

  before(async () => {
    await prisma.$connect()

    await prisma.user.create({
      data: {
        id: actorId,
        email: `mp-admin-${suffix}@example.com`,
        passwordHash: 'test-hash',
        role: UserRole.ADMIN,
      },
    })

    await prisma.client.createMany({
      data: [
        {
          id: pixClientId,
          fullName: 'Cliente PIX',
          email: `mp-pix-${suffix}@example.com`,
        },
        {
          id: cardClientId,
          fullName: 'Cliente Cartão',
          email: `mp-card-${suffix}@example.com`,
        },
      ],
    })

    await prisma.trip.createMany({
      data: [
        {
          id: pixTripId,
          title: 'Viagem PIX',
          origin: 'Fortaleza',
          destination: 'Recife',
          departureDate: new Date(Date.now() + 15 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 10,
          priceCents: 25_000,
        },
        {
          id: cardTripId,
          title: 'Viagem Cartão',
          origin: 'Fortaleza',
          destination: 'Natal',
          departureDate: new Date(Date.now() + 16 * 86_400_000),
          status: TripStatus.SCHEDULED,
          capacity: 10,
          priceCents: 30_000,
        },
      ],
    })

    await prisma.reservation.createMany({
      data: [
        {
          id: pixReservationId,
          clientId: pixClientId,
          tripId: pixTripId,
          status: ReservationStatus.PENDING,
          passengerCount: 1,
        },
        {
          id: cardReservationId,
          clientId: cardClientId,
          tripId: cardTripId,
          status: ReservationStatus.PENDING,
          passengerCount: 1,
        },
      ],
    })

    await prisma.purchaseOrder.createMany({
      data: [
        {
          id: `mp-pix-order-${suffix}`,
          reservationId: pixReservationId,
          status: PurchaseStatus.PENDING_PAYMENT,
          paymentMethod: PurchasePaymentMethod.PIX,
          unitPriceCents: 25_000,
          passengerCount: 1,
          totalCents: 25_000,
          providerPaymentId: `mp-payment-${suffix}`,
        },
        {
          id: `mp-card-order-${suffix}`,
          reservationId: cardReservationId,
          status: PurchaseStatus.PENDING_PAYMENT,
          paymentMethod: PurchasePaymentMethod.CARD,
          unitPriceCents: 30_000,
          passengerCount: 1,
          totalCents: 30_000,
          providerOrderId: `mp-order-${suffix}`,
        },
      ],
    })

    await prisma.seatAssignment.createMany({
      data: [
        {
          tripId: pixTripId,
          reservationId: pixReservationId,
          seatNumber: 1,
        },
        {
          tripId: cardTripId,
          reservationId: cardReservationId,
          seatNumber: 2,
        },
      ],
    })

    WebhookSignatureValidator.validate = (() => undefined) as typeof WebhookSignatureValidator.validate
  })

  after(async () => {
    WebhookSignatureValidator.validate = originalSignatureValidate
    Payment.prototype.get = originalPaymentGet
    PaymentRefund.prototype.list = originalRefundList
    Order.prototype.get = originalOrderGet

    await prisma.authAuditEvent.deleteMany({
      where: { userId: actorId },
    })
    await prisma.purchaseOrder.deleteMany({
      where: { reservationId: { in: [pixReservationId, cardReservationId] } },
    })
    await prisma.seatAssignment.deleteMany({
      where: { reservationId: { in: [pixReservationId, cardReservationId] } },
    })
    await prisma.reservation.deleteMany({
      where: { id: { in: [pixReservationId, cardReservationId] } },
    })
    await prisma.trip.deleteMany({
      where: { id: { in: [pixTripId, cardTripId] } },
    })
    await prisma.client.deleteMany({
      where: { id: { in: [pixClientId, cardClientId] } },
    })
    await prisma.user.deleteMany({ where: { id: actorId } })
    await prisma.$disconnect()
  })

  it('rejeita webhook com assinatura inválida sem alterar o financeiro', async () => {
    WebhookSignatureValidator.validate = (() => {
      throw new RangeError('invalid signature')
    }) as typeof WebhookSignatureValidator.validate

    await assert.rejects(
      () =>
        portal.handlePaymentWebhook({
          type: 'payment',
          dataId: `mp-payment-${suffix}`,
          xSignature: 'ts=1,v1=invalid',
          xRequestId: 'request-invalid',
        }),
      (error: unknown) => error instanceof UnauthorizedException,
    )

    const order = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { reservationId: pixReservationId },
    })
    assert.equal(order.status, PurchaseStatus.PENDING_PAYMENT)

    WebhookSignatureValidator.validate = (() => undefined) as typeof WebhookSignatureValidator.validate
  })

  it('ignora webhook com valor divergente', async () => {
    Payment.prototype.get = (async () => ({
      id: `mp-payment-${suffix}`,
      external_reference: `mp-pix-order-${suffix}`,
      transaction_amount: 249.99,
      status: 'approved',
    })) as unknown as typeof Payment.prototype.get

    const result = await portal.handlePaymentWebhook({
      type: 'payment',
      dataId: `mp-payment-${suffix}`,
      xSignature: 'valid',
      xRequestId: 'request-amount-mismatch',
    })

    assert.deepEqual(result, {
      ignored: true,
      reason: 'amount_mismatch',
    })

    const order = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { reservationId: pixReservationId },
    })
    assert.equal(order.status, PurchaseStatus.PENDING_PAYMENT)
  })

  it('confirma PIX aprovado e mantém a poltrona', async () => {
    Payment.prototype.get = (async () => ({
      id: `mp-payment-${suffix}`,
      external_reference: `mp-pix-order-${suffix}`,
      transaction_amount: 250,
      status: 'approved',
    })) as unknown as typeof Payment.prototype.get

    const result = await portal.handlePaymentWebhook({
      type: 'payment',
      dataId: `mp-payment-${suffix}`,
      xSignature: 'valid',
      xRequestId: 'request-approved',
    })

    if (!('updated' in result) || result.updated !== true) {
      assert.fail('Webhook deveria atualizar a compra')
    }
    assert.equal(result.status, PurchaseStatus.PAID)

    const order = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { reservationId: pixReservationId },
    })
    assert.equal(order.status, PurchaseStatus.PAID)
    assert.equal(order.providerPaymentId, `mp-payment-${suffix}`)
    assert.equal(order.providerStatus, 'approved')
    assert.ok(order.paidAt)
    assert.ok(order.lastReconciledAt)

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: pixReservationId },
    })
    assert.equal(reservation.status, ReservationStatus.CONFIRMED)
    assert.equal(
      await prisma.seatAssignment.count({
        where: { reservationId: pixReservationId },
      }),
      1,
    )
  })

  it('processa cartão aprovado pelo webhook de order', async () => {
    Order.prototype.get = (async () => ({
      id: `mp-order-${suffix}`,
      external_reference: `mp-card-order-${suffix}`,
      total_amount: '300.00',
      status: 'processed',
      status_detail: 'accredited',
      transactions: {
        payments: [{ id: `mp-card-payment-${suffix}` }],
        refunds: [],
      },
    })) as unknown as typeof Order.prototype.get

    const result = await portal.handlePaymentWebhook({
      type: 'order',
      dataId: `mp-order-${suffix}`,
      xSignature: 'valid',
      xRequestId: 'request-card-approved',
    })

    if (!('updated' in result) || result.updated !== true) {
      assert.fail('Webhook deveria atualizar a compra')
    }
    assert.equal(result.status, PurchaseStatus.PAID)

    const order = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { reservationId: cardReservationId },
    })
    assert.equal(order.status, PurchaseStatus.PAID)
    assert.equal(order.providerOrderId, `mp-order-${suffix}`)
    assert.equal(order.providerStatus, 'processed:accredited')

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: cardReservationId },
    })
    assert.equal(reservation.status, ReservationStatus.CONFIRMED)
  })

  it('reconcilia estorno parcial sem cancelar a viagem', async () => {
    Payment.prototype.get = (async () => ({
      id: `mp-payment-${suffix}`,
      status: 'approved',
      date_approved: new Date().toISOString(),
    })) as unknown as typeof Payment.prototype.get

    PaymentRefund.prototype.list = (async () => [
      { id: `refund-partial-${suffix}`, amount: 100 },
    ]) as unknown as typeof PaymentRefund.prototype.list

    const result = await admin.reconcileReservationPayment(
      pixReservationId,
      actorId,
    )

    assert.equal(
      result.purchaseOrder?.status,
      PurchaseStatus.PARTIALLY_REFUNDED,
    )
    assert.equal(result.purchaseOrder?.refundedCents, 10_000)
    assert.equal(result.reservation.status, ReservationStatus.CONFIRMED)

    const audit = await prisma.authAuditEvent.findFirst({
      where: {
        userId: actorId,
        eventType: 'OPS_PAYMENT_RECONCILED',
      },
      orderBy: { createdAt: 'desc' },
    })
    assert.ok(audit)
  })

  it('reconcilia estorno total, cancela reserva e libera a poltrona', async () => {
    Payment.prototype.get = (async () => ({
      id: `mp-payment-${suffix}`,
      status: 'refunded',
      date_approved: new Date().toISOString(),
    })) as unknown as typeof Payment.prototype.get

    PaymentRefund.prototype.list = (async () => [
      { id: `refund-total-${suffix}`, amount: 250 },
    ]) as unknown as typeof PaymentRefund.prototype.list

    const result = await admin.reconcileReservationPayment(
      pixReservationId,
      actorId,
    )

    assert.equal(result.purchaseOrder?.status, PurchaseStatus.REFUNDED)
    assert.equal(result.purchaseOrder?.refundedCents, 25_000)
    assert.equal(result.reservation.status, ReservationStatus.CANCELLED)
    assert.equal(
      await prisma.seatAssignment.count({
        where: { reservationId: pixReservationId },
      }),
      0,
    )
  })
})
