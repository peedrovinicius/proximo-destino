import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ReservationStatus,
  TravelDocumentType,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { DocumentsService } from '../documents/documents.service'
import { PrismaService } from '../prisma/prisma.service'

describe('escopo de documentos por papel administrativo', () => {
  const prisma = new PrismaService()
  const documents = new DocumentsService(
    prisma,
    new ConfigService({
      FRONTEND_ORIGIN: 'http://localhost:5173',
    }),
  )
  const suffix = randomUUID().slice(0, 8)
  const clientId = `doc-role-client-${suffix}`
  const tripId = `doc-role-trip-${suffix}`
  const reservationId = `doc-role-reservation-${suffix}`
  const voucherId = `doc-role-voucher-${suffix}`
  const receiptId = `doc-role-receipt-${suffix}`

  before(async () => {
    await prisma.$connect()

    await prisma.client.create({
      data: {
        id: clientId,
        fullName: 'Cliente Documento',
        email: `doc-role-${suffix}@example.com`,
      },
    })

    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem Documento',
        origin: 'Fortaleza',
        destination: 'Recife',
        departureDate: new Date(Date.now() + 20 * 86_400_000),
        status: TripStatus.SCHEDULED,
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

    await prisma.travelDocument.createMany({
      data: [
        {
          id: voucherId,
          reservationId,
          type: TravelDocumentType.TRAVEL_VOUCHER,
          version: 1,
          documentNumber: `PD-VCH-ROLE-${suffix}`,
          verificationCode: `VCHROLE${suffix}`.toUpperCase(),
          snapshot: { kind: 'TRAVEL_VOUCHER' },
        },
        {
          id: receiptId,
          reservationId,
          type: TravelDocumentType.PURCHASE_RECEIPT,
          version: 1,
          documentNumber: `PD-CMP-ROLE-${suffix}`,
          verificationCode: `CMPROLE${suffix}`.toUpperCase(),
          snapshot: { kind: 'PURCHASE_RECEIPT' },
        },
      ],
    })
  })

  after(async () => {
    await prisma.travelDocument.deleteMany({
      where: { id: { in: [voucherId, receiptId] } },
    })
    await prisma.reservation.deleteMany({ where: { id: reservationId } })
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.client.deleteMany({ where: { id: clientId } })
    await prisma.$disconnect()
  })

  it('admin vê voucher e comprovante', async () => {
    const list = await documents.listByReservation(
      reservationId,
      UserRole.ADMIN,
    )

    assert.deepEqual(
      new Set(list.map((item) => item.type)),
      new Set([
        TravelDocumentType.TRAVEL_VOUCHER,
        TravelDocumentType.PURCHASE_RECEIPT,
      ]),
    )
  })

  it('agente vê apenas voucher de viagem', async () => {
    const list = await documents.listByReservation(
      reservationId,
      UserRole.AGENT,
    )

    assert.equal(list.length, 1)
    assert.equal(list[0].type, TravelDocumentType.TRAVEL_VOUCHER)

    await assert.rejects(
      () => documents.renderAdminPdf(receiptId, UserRole.AGENT),
      (error: unknown) => error instanceof NotFoundException,
    )
  })

  it('financeiro vê apenas comprovante de compra', async () => {
    const list = await documents.listByReservation(
      reservationId,
      UserRole.FINANCE,
    )

    assert.equal(list.length, 1)
    assert.equal(list[0].type, TravelDocumentType.PURCHASE_RECEIPT)

    await assert.rejects(
      () => documents.renderAdminPdf(voucherId, UserRole.FINANCE),
      (error: unknown) => error instanceof NotFoundException,
    )
  })
})
