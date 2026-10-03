import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  InstallmentStatus,
  ManualPaymentStatus,
  PurchaseStatus,
  QuoteStatus,
  ReservationStatus,
  TravelDocumentType,
} from '@prisma/client'
import { randomBytes } from 'node:crypto'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { PrismaService } from '../prisma/prisma.service'
import {
  IssuePurchaseReceiptDto,
  IssueTravelVoucherDto,
} from './dto/document.dto'

type TravelVoucherSnapshot = {
  kind: 'TRAVEL_VOUCHER'
  agency: { name: string }
  documentNumber: string
  verificationCode: string
  issuedAt: string
  issuedBy: string | null
  reservation: {
    id: string
    status: string
    passengerCount: number
  }
  traveler: {
    fullName: string
    email: string | null
    phone: string | null
  }
  passengers: Array<{
    sequence: number
    fullName: string
    document: string | null
    seatNumber: number | null
  }>
  trip: {
    title: string
    origin: string
    destination: string
    departureDate: string
    returnDate: string | null
  }
  flight: {
    airline: string | null
    flightNumber: string | null
    bookingCode: string | null
    seat: string | null
    baggage: string | null
    departureLocation: string
    arrivalLocation: string
    departureAt: string
    arrivalAt: string | null
    departureTerminal: string | null
    arrivalTerminal: string | null
  }
  services: Array<{
    category: string
    description: string
    supplier: string | null
    amountCents: number
    status: string
  }>
  approvedTotalCents: number | null
  notes: string | null
}

type PurchaseReceiptSnapshot = {
  kind: 'PURCHASE_RECEIPT'
  agency: { name: string }
  documentNumber: string
  verificationCode: string
  issuedAt: string
  issuedBy: string | null
  reservation: {
    id: string
    status: string
    passengerCount: number
  }
  buyer: {
    fullName: string
    email: string | null
    phone: string | null
  }
  passengers: Array<{
    sequence: number
    fullName: string
    document: string | null
    seatNumber: number | null
  }>
  trip: {
    title: string
    origin: string
    destination: string
    departureDate: string
    returnDate: string | null
  }
  quote: {
    id: string
    revision: number
    title: string
    subtotalSaleCents: number
    discountCents: number
    totalCents: number
    approvedAt: string | null
  }
  finance: {
    totalCents: number
    paidCents: number
    outstandingCents: number
    installments: Array<{
      sequence: number
      dueDate: string
      amountCents: number
      status: string
      paidAt: string | null
      paymentMethod: string | null
    }>
  } | null
  notes: string | null
}

type DocumentSnapshot = TravelVoucherSnapshot | PurchaseReceiptSnapshot

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issueTravelVoucher(
    reservationId: string,
    issuedByUserId: string,
    data: IssueTravelVoucherDto,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        client: {
          select: {
            fullName: true,
            email: true,
            phone: true,
          },
        },
        passengers: {
          select: {
            sequence: true,
            fullName: true,
            document: true,
            seatAssignment: { select: { seatNumber: true } },
          },
          orderBy: { sequence: 'asc' },
        },
        trip: {
          select: {
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
            returnDate: true,
          },
        },
        services: {
          select: {
            category: true,
            description: true,
            supplier: true,
            amountCents: true,
            status: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        quotes: {
          where: { status: QuoteStatus.APPROVED },
          select: { totalCents: true },
          orderBy: { revision: 'desc' },
          take: 1,
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    if (
      reservation.status !== ReservationStatus.CONFIRMED &&
      reservation.status !== ReservationStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'A passagem/voucher só pode ser emitida para reserva confirmada',
      )
    }

    const issuer = await this.prisma.user.findUnique({
      where: { id: issuedByUserId },
      select: { email: true },
    })

    const issuedAt = new Date()
    return this.createDocument(
      reservationId,
      TravelDocumentType.TRAVEL_VOUCHER,
      issuedByUserId,
      (identity) =>
        ({
          kind: 'TRAVEL_VOUCHER',
          agency: { name: 'Próximo Destino Turismo e Viagens' },
          documentNumber: identity.documentNumber,
          verificationCode: identity.verificationCode,
          issuedAt: issuedAt.toISOString(),
          issuedBy: issuer?.email ?? null,
          reservation: {
            id: reservation.id,
            status: reservation.status,
            passengerCount: reservation.passengerCount,
          },
          traveler: reservation.client,
          passengers: reservation.passengers.map((passenger) => ({
            sequence: passenger.sequence,
            fullName:
              passenger.fullName ||
              (passenger.sequence === 1
                ? reservation.client.fullName
                : 'Passageiro não identificado'),
            document: passenger.document,
            seatNumber: passenger.seatAssignment?.seatNumber ?? null,
          })),
          trip: {
            title: reservation.trip.title,
            origin: reservation.trip.origin,
            destination: reservation.trip.destination,
            departureDate: reservation.trip.departureDate.toISOString(),
            returnDate: reservation.trip.returnDate?.toISOString() ?? null,
          },
          flight: {
            airline:
              data.airline?.trim() ||
              reservation.services.find((service) => service.category === 'FLIGHT')
                ?.supplier ||
              null,
            flightNumber: data.flightNumber?.trim() || null,
            bookingCode: data.bookingCode?.trim() || null,
            seat: data.seat?.trim() || null,
            baggage: data.baggage?.trim() || null,
            departureLocation:
              data.departureLocation?.trim() || reservation.trip.origin,
            arrivalLocation:
              data.arrivalLocation?.trim() || reservation.trip.destination,
            departureAt: (
              data.departureAt ?? reservation.trip.departureDate
            ).toISOString(),
            arrivalAt: data.arrivalAt?.toISOString() ?? null,
            departureTerminal: data.departureTerminal?.trim() || null,
            arrivalTerminal: data.arrivalTerminal?.trim() || null,
          },
          services: reservation.services.map((service) => ({
            category: service.category,
            description: service.description,
            supplier: service.supplier,
            amountCents: service.amountCents,
            status: service.status,
          })),
          approvedTotalCents: reservation.quotes[0]?.totalCents ?? null,
          notes: data.notes?.trim() || null,
        }) satisfies TravelVoucherSnapshot,
      issuedAt,
    )
  }

  async issuePurchaseReceipt(
    reservationId: string,
    issuedByUserId: string,
    data: IssuePurchaseReceiptDto,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        passengerCount: true,
        client: {
          select: {
            fullName: true,
            email: true,
            phone: true,
          },
        },
        passengers: {
          select: {
            sequence: true,
            fullName: true,
            document: true,
            seatAssignment: { select: { seatNumber: true } },
          },
          orderBy: { sequence: 'asc' },
        },
        trip: {
          select: {
            title: true,
            origin: true,
            destination: true,
            departureDate: true,
            returnDate: true,
          },
        },
        quotes: {
          where: { status: QuoteStatus.APPROVED },
          select: {
            id: true,
            revision: true,
            title: true,
            subtotalSaleCents: true,
            discountCents: true,
            totalCents: true,
            approvedAt: true,
          },
          orderBy: { revision: 'desc' },
          take: 1,
        },
        financePlan: {
          select: {
            totalCents: true,
            installments: {
              select: {
                id: true,
                sequence: true,
                dueDate: true,
                amountCents: true,
                status: true,
                paidAt: true,
                paymentMethod: true,
              },
              orderBy: { sequence: 'asc' },
            },
          },
        },
        purchaseOrder: {
          select: {
            status: true,
            totalCents: true,
            refundedCents: true,
            paymentMethod: true,
            paidAt: true,
          },
        },
        manualPayments: {
          select: {
            installmentId: true,
            status: true,
            amountCents: true,
            method: true,
            paidAt: true,
          },
          orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    const quote = reservation.quotes[0]
    if (!quote) {
      throw new BadRequestException(
        'O comprovante de compra exige uma cotação aprovada',
      )
    }

    const issuer = await this.prisma.user.findUnique({
      where: { id: issuedByUserId },
      select: { email: true },
    })

    const finance = reservation.financePlan
    const manualInstallmentIds = new Set(
      reservation.manualPayments
        .map((payment) => payment.installmentId)
        .filter((value): value is string => Boolean(value)),
    )
    const legacyInstallmentPaidCents =
      finance?.installments
        .filter(
          (item) =>
            item.status === InstallmentStatus.PAID &&
            !manualInstallmentIds.has(item.id),
        )
        .reduce((sum, item) => sum + item.amountCents, 0) ?? 0

    const manualPaidCents = reservation.manualPayments
      .filter((payment) => payment.status === ManualPaymentStatus.RECEIVED)
      .reduce((sum, payment) => sum + payment.amountCents, 0)

    const onlineGrossCents =
      reservation.purchaseOrder &&
      [
        PurchaseStatus.PAID,
        PurchaseStatus.PARTIALLY_REFUNDED,
        PurchaseStatus.REFUNDED,
      ].includes(reservation.purchaseOrder.status)
        ? reservation.purchaseOrder.totalCents
        : 0
    const onlineNetCents = Math.max(
      onlineGrossCents -
        (reservation.purchaseOrder?.refundedCents ?? 0),
      0,
    )

    const paidCents =
      onlineNetCents + manualPaidCents + legacyInstallmentPaidCents
    const financialTotalCents =
      reservation.purchaseOrder?.totalCents ??
      finance?.totalCents ??
      quote.totalCents
    const hasFinance =
      Boolean(reservation.purchaseOrder) ||
      Boolean(finance) ||
      reservation.manualPayments.length > 0

    const issuedAt = new Date()
    return this.createDocument(
      reservationId,
      TravelDocumentType.PURCHASE_RECEIPT,
      issuedByUserId,
      (identity) =>
        ({
          kind: 'PURCHASE_RECEIPT',
          agency: { name: 'Próximo Destino Turismo e Viagens' },
          documentNumber: identity.documentNumber,
          verificationCode: identity.verificationCode,
          issuedAt: issuedAt.toISOString(),
          issuedBy: issuer?.email ?? null,
          reservation: {
            id: reservation.id,
            status: reservation.status,
            passengerCount: reservation.passengerCount,
          },
          buyer: reservation.client,
          passengers: reservation.passengers.map((passenger) => ({
            sequence: passenger.sequence,
            fullName:
              passenger.fullName ||
              (passenger.sequence === 1
                ? reservation.client.fullName
                : 'Passageiro não identificado'),
            document: passenger.document,
            seatNumber: passenger.seatAssignment?.seatNumber ?? null,
          })),
          trip: {
            title: reservation.trip.title,
            origin: reservation.trip.origin,
            destination: reservation.trip.destination,
            departureDate: reservation.trip.departureDate.toISOString(),
            returnDate: reservation.trip.returnDate?.toISOString() ?? null,
          },
          quote: {
            id: quote.id,
            revision: quote.revision,
            title: quote.title,
            subtotalSaleCents: quote.subtotalSaleCents,
            discountCents: quote.discountCents,
            totalCents: quote.totalCents,
            approvedAt: quote.approvedAt?.toISOString() ?? null,
          },
          finance: hasFinance
            ? {
                totalCents: financialTotalCents,
                paidCents,
                outstandingCents: Math.max(
                  financialTotalCents - paidCents,
                  0,
                ),
                installments:
                  finance?.installments.map((item) => ({
                    sequence: item.sequence,
                    dueDate: item.dueDate.toISOString(),
                    amountCents: item.amountCents,
                    status: item.status,
                    paidAt: item.paidAt?.toISOString() ?? null,
                    paymentMethod: item.paymentMethod,
                  })) ?? [],
              }
            : null,
          notes: data.notes?.trim() || null,
        }) satisfies PurchaseReceiptSnapshot,
      issuedAt,
    )
  }

  listByReservation(reservationId: string) {
    return this.prisma.travelDocument.findMany({
      where: { reservationId },
      select: {
        id: true,
        type: true,
        version: true,
        documentNumber: true,
        verificationCode: true,
        issuedAt: true,
      },
      orderBy: { issuedAt: 'desc' },
    })
  }

  async listForClient(reservationId: string, clientId: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, clientId },
      select: { id: true },
    })
    if (!reservation) throw new NotFoundException('Reserva não encontrada')
    return this.listByReservation(reservationId)
  }

  async renderAdminPdf(documentId: string) {
    const document = await this.requireDocument(documentId)
    return {
      filename: this.filename(document.type, document.documentNumber),
      buffer: await this.renderPdf(document.snapshot as unknown as DocumentSnapshot),
    }
  }

  async renderClientPdf(
    documentId: string,
    reservationId: string,
    clientId: string,
  ) {
    const document = await this.prisma.travelDocument.findFirst({
      where: {
        id: documentId,
        reservationId,
        reservation: { clientId },
      },
      select: {
        type: true,
        documentNumber: true,
        snapshot: true,
      },
    })
    if (!document) throw new NotFoundException('Documento não encontrado')

    return {
      filename: this.filename(document.type, document.documentNumber),
      buffer: await this.renderPdf(document.snapshot as unknown as DocumentSnapshot),
    }
  }

  async verify(verificationCode: string) {
    const document = await this.prisma.travelDocument.findUnique({
      where: { verificationCode: verificationCode.trim().toUpperCase() },
      select: {
        type: true,
        version: true,
        documentNumber: true,
        verificationCode: true,
        issuedAt: true,
        reservation: {
          select: {
            id: true,
            trip: {
              select: {
                origin: true,
                destination: true,
                departureDate: true,
              },
            },
          },
        },
      },
    })

    if (!document) throw new NotFoundException('Documento não encontrado')

    return {
      valid: true,
      type: document.type,
      version: document.version,
      documentNumber: document.documentNumber,
      verificationCode: document.verificationCode,
      issuedAt: document.issuedAt,
      reservationId: document.reservation.id,
      route: {
        origin: document.reservation.trip.origin,
        destination: document.reservation.trip.destination,
        departureDate: document.reservation.trip.departureDate,
      },
    }
  }

  private async requireDocument(documentId: string) {
    const document = await this.prisma.travelDocument.findUnique({
      where: { id: documentId },
      select: {
        type: true,
        documentNumber: true,
        snapshot: true,
      },
    })
    if (!document) throw new NotFoundException('Documento não encontrado')
    return document
  }

  private async createDocument(
    reservationId: string,
    type: TravelDocumentType,
    issuedByUserId: string,
    makeSnapshot: (identity: {
      documentNumber: string
      verificationCode: string
    }) => DocumentSnapshot,
    issuedAt: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.travelDocument.aggregate({
        where: { reservationId, type },
        _max: { version: true },
      })
      const version = (aggregate._max.version ?? 0) + 1
      const identity = this.identity(type, issuedAt)
      const snapshot = makeSnapshot(identity)

      return tx.travelDocument.create({
        data: {
          reservationId,
          type,
          version,
          documentNumber: identity.documentNumber,
          verificationCode: identity.verificationCode,
          snapshot,
          issuedByUserId,
          issuedAt,
        },
        select: {
          id: true,
          type: true,
          version: true,
          documentNumber: true,
          verificationCode: true,
          issuedAt: true,
        },
      })
    })
  }

  private identity(type: TravelDocumentType, issuedAt: Date) {
    const datePart = issuedAt.toISOString().slice(0, 10).replace(/-/g, '')
    const suffix = randomBytes(3).toString('hex').toUpperCase()
    const prefix =
      type === TravelDocumentType.TRAVEL_VOUCHER ? 'VCH' : 'CMP'
    return {
      documentNumber: `PD-${prefix}-${datePart}-${suffix}`,
      verificationCode: randomBytes(8).toString('hex').toUpperCase(),
    }
  }

  private filename(type: TravelDocumentType, documentNumber: string) {
    const prefix =
      type === TravelDocumentType.TRAVEL_VOUCHER
        ? 'passagem-voucher'
        : 'comprovante-compra'
    return `${prefix}-${documentNumber}.pdf`
  }

  private async renderPdf(snapshot: DocumentSnapshot) {
    const verificationUrl = this.verificationUrl(snapshot.verificationCode)
    const qr = await QRCode.toBuffer(verificationUrl, {
      type: 'png',
      width: 130,
      margin: 1,
      errorCorrectionLevel: 'M',
    })

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 42, right: 44, bottom: 46, left: 44 },
        info: {
          Title:
            snapshot.kind === 'TRAVEL_VOUCHER'
              ? 'Passagem - Voucher de viagem'
              : 'Comprovante de compra',
          Author: snapshot.agency.name,
          Subject: snapshot.documentNumber,
        },
      })
      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      this.drawHeader(doc, snapshot, qr)

      if (snapshot.kind === 'TRAVEL_VOUCHER') {
        this.drawVoucher(doc, snapshot)
      } else {
        this.drawReceipt(doc, snapshot)
      }

      this.drawFooter(doc, snapshot)
      doc.end()
    })
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    snapshot: DocumentSnapshot,
    qr: Buffer,
  ) {
    doc
      .fillColor('#163A5F')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('PRÓXIMO DESTINO', 44, 42)
    doc
      .fillColor('#60798E')
      .font('Helvetica')
      .fontSize(8)
      .text('Turismo e Viagens', 44, 64)

    doc.image(qr, 472, 38, { width: 78, height: 78 })

    const title =
      snapshot.kind === 'TRAVEL_VOUCHER'
        ? 'PASSAGEM / VOUCHER DE VIAGEM'
        : 'COMPROVANTE DE COMPRA'
    doc
      .fillColor('#172B3D')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(title, 44, 108)

    doc
      .fillColor('#6E8191')
      .font('Helvetica')
      .fontSize(8)
      .text(
        `Documento ${snapshot.documentNumber}  |  Verificação ${snapshot.verificationCode}`,
        44,
        136,
      )

    doc
      .moveTo(44, 158)
      .lineTo(551, 158)
      .strokeColor('#DCE5EB')
      .lineWidth(1)
      .stroke()
  }

  private drawVoucher(
    doc: PDFKit.PDFDocument,
    snapshot: TravelVoucherSnapshot,
  ) {
    const startY = 178
    doc
      .fillColor('#6C7E8D')
      .font('Helvetica')
      .fontSize(7)
      .text('PASSAGEIRO', 44, startY)
    doc
      .fillColor('#172B3D')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(snapshot.traveler.fullName, 44, startY + 12)

    doc
      .fillColor('#6C7E8D')
      .font('Helvetica')
      .fontSize(7)
      .text('VIAJANTES', 385, startY)
    doc
      .fillColor('#172B3D')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(String(snapshot.reservation.passengerCount), 385, startY + 12)

    const routeY = 230
    doc.roundedRect(44, routeY, 507, 92, 12).fill('#F4F8FB')

    doc
      .fillColor('#718493')
      .font('Helvetica')
      .fontSize(7)
      .text('ORIGEM', 62, routeY + 18)
    doc
      .fillColor('#163A5F')
      .font('Helvetica-Bold')
      .fontSize(17)
      .text(snapshot.flight.departureLocation, 62, routeY + 32, { width: 190 })

    doc
      .fillColor('#92A1AC')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('>', 286, routeY + 38)

    doc
      .fillColor('#718493')
      .font('Helvetica')
      .fontSize(7)
      .text('DESTINO', 342, routeY + 18)
    doc
      .fillColor('#163A5F')
      .font('Helvetica-Bold')
      .fontSize(17)
      .text(snapshot.flight.arrivalLocation, 342, routeY + 32, { width: 185 })

    doc
      .fillColor('#50687B')
      .font('Helvetica')
      .fontSize(8)
      .text(this.formatDateTime(snapshot.flight.departureAt), 62, routeY + 62)

    if (snapshot.flight.arrivalAt) {
      doc.text(this.formatDateTime(snapshot.flight.arrivalAt), 342, routeY + 62)
    }

    let y = 344
    y = this.drawPassengers(doc, snapshot.passengers, y)
    y += 16

    const details: Array<[string, string]> = [
      ['Companhia / fornecedor', snapshot.flight.airline || 'A confirmar'],
      ['Voo', snapshot.flight.flightNumber || 'A confirmar'],
      ['Localizador', snapshot.flight.bookingCode || 'A confirmar'],
      ['Assento', snapshot.flight.seat || 'A confirmar'],
      ['Bagagem', snapshot.flight.baggage || 'Conforme serviço contratado'],
      ['Terminal de saída', snapshot.flight.departureTerminal || 'A confirmar'],
      ['Terminal de chegada', snapshot.flight.arrivalTerminal || 'A confirmar'],
      ['Retorno', snapshot.trip.returnDate ? this.formatDate(snapshot.trip.returnDate) : 'A confirmar'],
    ]
    this.drawKeyValueGrid(doc, details, y)
    y += 116

    if (snapshot.services.length) {
      doc
        .fillColor('#172B3D')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('SERVIÇOS VINCULADOS À RESERVA', 44, y)
      y += 18
      for (const service of snapshot.services.slice(0, 7)) {
        y = this.ensureSpace(doc, y, 34)
        doc
          .fillColor('#243B4E')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(service.description, 44, y, { width: 300 })
        doc
          .fillColor('#728493')
          .font('Helvetica')
          .fontSize(7)
          .text(service.supplier || service.category, 44, y + 12, { width: 300 })
        doc
          .fillColor('#243B4E')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(this.money(service.amountCents), 430, y, {
            width: 121,
            align: 'right',
          })
        y += 30
      }
    }

    if (snapshot.notes) {
      y = this.ensureSpace(doc, y, 55)
      doc
        .fillColor('#172B3D')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('OBSERVAÇÕES', 44, y)
      doc
        .fillColor('#657B8D')
        .font('Helvetica')
        .fontSize(8)
        .text(snapshot.notes, 44, y + 14, { width: 507 })
    }
  }

  private drawReceipt(
    doc: PDFKit.PDFDocument,
    snapshot: PurchaseReceiptSnapshot,
  ) {
    let y = 178
    doc
      .fillColor('#6C7E8D')
      .font('Helvetica')
      .fontSize(7)
      .text('COMPRADOR', 44, y)
    doc
      .fillColor('#172B3D')
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(snapshot.buyer.fullName, 44, y + 12)
    doc
      .fillColor('#6C7E8D')
      .font('Helvetica')
      .fontSize(8)
      .text(snapshot.buyer.email || 'E-mail não informado', 44, y + 34)

    y += 70
    doc.roundedRect(44, y, 507, 84, 12).fill('#F4F8FB')
    doc
      .fillColor('#718493')
      .font('Helvetica')
      .fontSize(7)
      .text('VIAGEM', 62, y + 16)
    doc
      .fillColor('#163A5F')
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(
        `${snapshot.trip.origin} > ${snapshot.trip.destination}`,
        62,
        y + 29,
      )
    doc
      .fillColor('#5D7385')
      .font('Helvetica')
      .fontSize(8)
      .text(
        `${snapshot.trip.title}  |  Embarque ${this.formatDate(snapshot.trip.departureDate)}`,
        62,
        y + 52,
      )

    y += 105
    y = this.drawPassengers(doc, snapshot.passengers, y)
    y += 16
    this.drawKeyValueGrid(
      doc,
      [
        ['Cotação', `${snapshot.quote.title} - revisão ${snapshot.quote.revision}`],
        ['Subtotal', this.money(snapshot.quote.subtotalSaleCents)],
        ['Desconto', this.money(snapshot.quote.discountCents)],
        ['Total da compra', this.money(snapshot.quote.totalCents)],
      ],
      y,
    )
    y += 76

    const paid = snapshot.finance?.paidCents ?? 0
    const outstanding =
      snapshot.finance?.outstandingCents ?? snapshot.quote.totalCents

    doc.roundedRect(44, y, 507, 76, 12).fill('#EEF6FD')
    doc
      .fillColor('#5C7488')
      .font('Helvetica')
      .fontSize(7)
      .text('TOTAL DA COMPRA', 62, y + 15)
    doc
      .fillColor('#174D84')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(this.money(snapshot.quote.totalCents), 62, y + 28)

    doc
      .fillColor('#5C7488')
      .font('Helvetica')
      .fontSize(7)
      .text('PAGO', 270, y + 15)
    doc
      .fillColor('#1F805F')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(this.money(paid), 270, y + 30)

    doc
      .fillColor('#5C7488')
      .font('Helvetica')
      .fontSize(7)
      .text('SALDO', 420, y + 15)
    doc
      .fillColor('#172B3D')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(this.money(outstanding), 420, y + 30)

    y += 98

    if (snapshot.finance?.installments.length) {
      doc
        .fillColor('#172B3D')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('PAGAMENTOS E PARCELAS', 44, y)
      y += 18

      for (const item of snapshot.finance.installments) {
        y = this.ensureSpace(doc, y, 33)
        doc
          .fillColor('#243B4E')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(item.sequence === 0 ? 'Entrada' : `Parcela ${item.sequence}`, 44, y)
        doc
          .fillColor('#728493')
          .font('Helvetica')
          .fontSize(7)
          .text(this.formatDate(item.dueDate), 135, y)
        doc
          .fillColor('#243B4E')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(this.money(item.amountCents), 270, y)
        doc
          .fillColor(item.status === 'PAID' ? '#1F805F' : '#6F8190')
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(this.installmentLabel(item.status), 390, y)
        if (item.paymentMethod) {
          doc
            .fillColor('#728493')
            .font('Helvetica')
            .fontSize(7)
            .text(item.paymentMethod, 455, y, { width: 96, align: 'right' })
        }
        y += 27
      }
    }

    if (snapshot.notes) {
      y = this.ensureSpace(doc, y, 50)
      doc
        .fillColor('#172B3D')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('OBSERVAÇÕES', 44, y)
      doc
        .fillColor('#657B8D')
        .font('Helvetica')
        .fontSize(8)
        .text(snapshot.notes, 44, y + 14, { width: 507 })
    }
  }

  private drawPassengers(
    doc: PDFKit.PDFDocument,
    passengers: Array<{
      sequence: number
      fullName: string
      document: string | null
      seatNumber: number | null
    }>,
    startY: number,
  ) {
    let y = this.ensureSpace(doc, startY, 42)

    doc
      .fillColor('#172B3D')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('PASSAGEIROS E ASSENTOS', 44, y)
    y += 18

    for (const passenger of passengers) {
      y = this.ensureSpace(doc, y, 30)
      doc
        .fillColor('#243B4E')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(
          `${passenger.sequence}. ${passenger.fullName}`,
          44,
          y,
          { width: 300 },
        )
      doc
        .fillColor('#718493')
        .font('Helvetica')
        .fontSize(7)
        .text(
          passenger.document
            ? `Documento ${passenger.document}`
            : 'Documento não informado',
          44,
          y + 12,
          { width: 300 },
        )
      doc
        .fillColor('#174D84')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(
          passenger.seatNumber
            ? `Poltrona ${passenger.seatNumber}`
            : 'Poltrona a definir',
          415,
          y,
          { width: 136, align: 'right' },
        )
      y += 28
    }

    return y
  }

  private drawKeyValueGrid(
    doc: PDFKit.PDFDocument,
    items: Array<[string, string]>,
    y: number,
  ) {
    const width = 245
    items.forEach(([label, value], index) => {
      const col = index % 2
      const row = Math.floor(index / 2)
      const x = 44 + col * 262
      const top = y + row * 38
      doc
        .fillColor('#718493')
        .font('Helvetica')
        .fontSize(7)
        .text(label.toUpperCase(), x, top)
      doc
        .fillColor('#203A50')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(value, x, top + 12, { width })
    })
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    snapshot: DocumentSnapshot,
  ) {
    const bottom = doc.page.height - 70
    doc
      .moveTo(44, bottom - 12)
      .lineTo(551, bottom - 12)
      .strokeColor('#DCE5EB')
      .lineWidth(1)
      .stroke()

    const disclaimer =
      snapshot.kind === 'TRAVEL_VOUCHER'
        ? 'Voucher emitido pela agência. Quando houver transporte aéreo, não substitui bilhete eletrônico ou cartão de embarque emitido pela transportadora.'
        : 'Este comprovante registra a compra junto à agência e não substitui documento fiscal quando exigível.'

    doc
      .fillColor('#728493')
      .font('Helvetica')
      .fontSize(6.7)
      .text(disclaimer, 44, bottom, { width: 390, lineGap: 2 })

    doc
      .fillColor('#536A7D')
      .font('Helvetica-Bold')
      .fontSize(6.7)
      .text(
        `Verificação: ${snapshot.verificationCode}`,
        430,
        bottom,
        { width: 121, align: 'right' },
      )
  }

  private ensureSpace(
    doc: PDFKit.PDFDocument,
    y: number,
    needed: number,
  ) {
    if (y + needed <= doc.page.height - 100) return y

    doc.addPage()
    doc
      .fillColor('#163A5F')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('PRÓXIMO DESTINO', 44, 42)
    doc
      .fillColor('#718493')
      .font('Helvetica')
      .fontSize(7)
      .text('Continuação do documento', 44, 58)
    doc
      .moveTo(44, 76)
      .lineTo(551, 76)
      .strokeColor('#DCE5EB')
      .lineWidth(1)
      .stroke()
    return 94
  }

  private verificationUrl(code: string) {
    const base = this.config
      .get<string>('PUBLIC_API_URL', '')
      .replace(/\/$/, '')
    return base
      ? `${base}/public/documents/verify/${code}`
      : `PD-VERIFY:${code}`
  }

  private money(cents: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100)
  }

  private formatDate(value: string) {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(value))
  }

  private formatDateTime(value: string) {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Fortaleza',
    }).format(new Date(value))
  }

  private installmentLabel(status: string) {
    const labels: Record<string, string> = {
      OPEN: 'Em aberto',
      PAID: 'Pago',
      OVERDUE: 'Vencido',
      CANCELLED: 'Cancelado',
    }
    return labels[status] ?? status
  }
}
