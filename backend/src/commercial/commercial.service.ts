import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  InstallmentStatus,
  Prisma,
  QuoteStatus,
  ReservationServiceStatus,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { buildInstallmentSchedule } from './finance-math'
import {
  AddQuoteItemDto,
  CreateFinancePlanDto,
  CreateQuoteDto,
} from './dto/quote.dto'

@Injectable()
export class CommercialService {
  constructor(private readonly prisma: PrismaService) {}

  private async recordAudit(
    actorUserId: string | undefined,
    eventType: string,
    metadata: Prisma.InputJsonObject,
  ) {
    if (!actorUserId) return
    await this.prisma.authAuditEvent.create({
      data: {
        userId: actorUserId,
        eventType,
        metadata,
      },
    })
  }

  listQuotes(reservationId?: string) {
    return this.prisma.quote.findMany({
      where: reservationId ? { reservationId } : undefined,
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        reservation: {
          select: {
            id: true,
            status: true,
            passengerCount: true,
            client: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
            trip: {
              select: {
                id: true,
                title: true,
                origin: true,
                destination: true,
                departureDate: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    })
  }

  async createQuote(data: CreateQuoteDto, actorUserId?: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: data.reservationId },
      select: { id: true },
    })

    if (!reservation) throw new NotFoundException('Reserva não encontrada')

    const aggregate = await this.prisma.quote.aggregate({
      where: { reservationId: data.reservationId },
      _max: { revision: true },
    })

    const quote = await this.prisma.quote.create({
      data: {
        reservationId: data.reservationId,
        revision: (aggregate._max.revision ?? 0) + 1,
        title: data.title.trim(),
        validUntil: data.validUntil,
        notes: data.notes?.trim(),
        discountCents: data.discountCents ?? 0,
      },
      include: {
        items: true,
        reservation: {
          select: {
            id: true,
            client: { select: { fullName: true, email: true } },
            trip: { select: { title: true, destination: true } },
          },
        },
      },
    })

    await this.recordAudit(actorUserId, 'OPS_QUOTE_CREATED', {
      quoteId: quote.id,
      reservationId: data.reservationId,
      revision: quote.revision,
      discountCents: quote.discountCents,
    })

    return quote
  }

  async addQuoteItem(
    quoteId: string,
    data: AddQuoteItemDto,
    actorUserId?: string,
  ) {
    await this.assertDraftQuote(quoteId)

    const totalCostCents = data.unitCostCents * data.quantity
    const totalSaleCents = data.unitSaleCents * data.quantity

    const item = await this.prisma.quoteItem.create({
      data: {
        quoteId,
        category: data.category,
        description: data.description.trim(),
        supplier: data.supplier?.trim(),
        quantity: data.quantity,
        unitCostCents: data.unitCostCents,
        unitSaleCents: data.unitSaleCents,
        totalCostCents,
        totalSaleCents,
      },
    })

    const quote = await this.recalculateQuote(quoteId)
    await this.recordAudit(actorUserId, 'OPS_QUOTE_ITEM_ADDED', {
      quoteId,
      itemId: item.id,
      reservationId: quote.reservationId,
      category: data.category,
      quantity: data.quantity,
      totalSaleCents,
    })

    return quote
  }

  async removeQuoteItem(
    quoteId: string,
    itemId: string,
    actorUserId?: string,
  ) {
    await this.assertDraftQuote(quoteId)

    const item = await this.prisma.quoteItem.findFirst({
      where: { id: itemId, quoteId },
      select: { id: true },
    })

    if (!item) throw new NotFoundException('Item da cotação não encontrado')

    await this.prisma.quoteItem.delete({ where: { id: itemId } })
    const quote = await this.recalculateQuote(quoteId)
    await this.recordAudit(actorUserId, 'OPS_QUOTE_ITEM_REMOVED', {
      quoteId,
      itemId,
      reservationId: quote.reservationId,
    })
    return quote
  }

  async sendQuote(quoteId: string, actorUserId?: string) {
    await this.recalculateQuote(quoteId)

    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    })

    if (!quote) throw new NotFoundException('Cotação não encontrada')
    if (quote.status !== QuoteStatus.DRAFT) {
      throw new ConflictException('Somente cotações em rascunho podem ser enviadas')
    }
    if (!quote.items.length) {
      throw new BadRequestException('Adicione pelo menos um serviço à cotação')
    }
    if (quote.totalCents <= 0) {
      throw new BadRequestException('O valor final da cotação deve ser maior que zero')
    }
    if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
      throw new BadRequestException('A validade da cotação já expirou')
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.quote.updateMany({
        where: {
          reservationId: quote.reservationId,
          status: QuoteStatus.SENT,
          id: { not: quote.id },
        },
        data: { status: QuoteStatus.EXPIRED },
      })

      const sent = await tx.quote.update({
        where: { id: quoteId },
        data: {
          status: QuoteStatus.SENT,
          sentAt: new Date(),
        },
        include: {
          items: true,
          reservation: {
            select: {
              client: { select: { fullName: true, email: true } },
              trip: { select: { title: true, destination: true } },
            },
          },
        },
      })

      if (actorUserId) {
        await tx.authAuditEvent.create({
          data: {
            userId: actorUserId,
            eventType: 'OPS_QUOTE_SENT',
            metadata: {
              quoteId,
              reservationId: quote.reservationId,
              beforeStatus: quote.status,
              afterStatus: QuoteStatus.SENT,
              totalCents: quote.totalCents,
            },
          },
        })
      }

      return sent
    })
  }

  async reviseQuote(quoteId: string, actorUserId?: string) {
    const source = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    })

    if (!source) throw new NotFoundException('Cotação não encontrada')
    if (source.status === QuoteStatus.DRAFT) {
      throw new ConflictException('A cotação já está em rascunho')
    }
    if (source.status === QuoteStatus.APPROVED) {
      throw new ConflictException('Cotação aprovada não pode ser revisada')
    }

    const aggregate = await this.prisma.quote.aggregate({
      where: { reservationId: source.reservationId },
      _max: { revision: true },
    })

    const revised = await this.prisma.quote.create({
      data: {
        reservationId: source.reservationId,
        revision: (aggregate._max.revision ?? source.revision) + 1,
        title: source.title,
        validUntil: source.validUntil,
        notes: source.notes,
        discountCents: source.discountCents,
        subtotalCostCents: source.subtotalCostCents,
        subtotalSaleCents: source.subtotalSaleCents,
        totalCents: source.totalCents,
        marginCents: source.marginCents,
        items: {
          create: source.items.map((item) => ({
            category: item.category,
            description: item.description,
            supplier: item.supplier,
            quantity: item.quantity,
            unitCostCents: item.unitCostCents,
            unitSaleCents: item.unitSaleCents,
            totalCostCents: item.totalCostCents,
            totalSaleCents: item.totalSaleCents,
          })),
        },
      },
      include: { items: true },
    })

    await this.recordAudit(actorUserId, 'OPS_QUOTE_REVISED', {
      sourceQuoteId: quoteId,
      quoteId: revised.id,
      reservationId: source.reservationId,
      beforeRevision: source.revision,
      afterRevision: revised.revision,
    })

    return revised
  }

  listServices(reservationId?: string) {
    return this.prisma.reservationService.findMany({
      where: reservationId ? { reservationId } : undefined,
      select: {
        id: true,
        reservationId: true,
        category: true,
        description: true,
        supplier: true,
        amountCents: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        reservation: {
          select: {
            client: { select: { fullName: true } },
            trip: { select: { title: true, destination: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  async updateServiceStatus(
    id: string,
    status: ReservationServiceStatus,
    actorUserId?: string,
  ) {
    const current = await this.prisma.reservationService.findUnique({
      where: { id },
      select: { id: true, reservationId: true, status: true },
    })
    if (!current) throw new NotFoundException('Serviço não encontrado')

    const updated = await this.prisma.reservationService.update({
      where: { id },
      data: { status },
    })

    if (current.status !== status) {
      await this.recordAudit(actorUserId, 'OPS_SERVICE_STATUS_CHANGED', {
        serviceId: id,
        reservationId: current.reservationId,
        beforeStatus: current.status,
        afterStatus: status,
      })
    }

    return updated
  }

  listFinancePlans() {
    return this.prisma.financePlan.findMany({
      include: {
        quote: {
          select: {
            id: true,
            title: true,
            revision: true,
            status: true,
          },
        },
        reservation: {
          select: {
            id: true,
            status: true,
            client: { select: { id: true, fullName: true, email: true } },
            trip: {
              select: {
                id: true,
                title: true,
                destination: true,
                departureDate: true,
              },
            },
          },
        },
        installments: { orderBy: { sequence: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  async createFinancePlan(
    data: CreateFinancePlanDto,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.financePlan.findUnique({
      where: { reservationId: data.reservationId },
      select: { id: true },
    })
    if (existing) {
      throw new ConflictException('Esta reserva já possui um plano financeiro')
    }

    const quote = await this.prisma.quote.findFirst({
      where: {
        reservationId: data.reservationId,
        status: QuoteStatus.APPROVED,
      },
      orderBy: { revision: 'desc' },
      select: {
        id: true,
        totalCents: true,
      },
    })

    if (!quote) {
      throw new BadRequestException('A reserva precisa ter uma cotação aprovada')
    }

    const downPaymentCents = data.downPaymentCents ?? 0
    if (downPaymentCents >= quote.totalCents) {
      throw new BadRequestException('A entrada deve ser menor que o valor total')
    }

    const installments = buildInstallmentSchedule(
      quote.totalCents,
      downPaymentCents,
      data.installmentCount,
      data.firstDueDate,
    )

    const plan = await this.prisma.financePlan.create({
      data: {
        reservationId: data.reservationId,
        quoteId: quote.id,
        totalCents: quote.totalCents,
        downPaymentCents,
        installmentCount: data.installmentCount,
        installments: { create: installments },
      },
      include: {
        quote: true,
        reservation: {
          select: {
            client: { select: { fullName: true, email: true } },
            trip: { select: { title: true, destination: true } },
          },
        },
        installments: { orderBy: { sequence: 'asc' } },
      },
    })

    await this.recordAudit(actorUserId, 'OPS_FINANCE_PLAN_CREATED', {
      financePlanId: plan.id,
      reservationId: data.reservationId,
      quoteId: quote.id,
      totalCents: quote.totalCents,
      downPaymentCents,
      installmentCount: data.installmentCount,
    })

    return plan
  }

  async updateInstallment(
    id: string,
    status: InstallmentStatus,
    paymentMethod?: string,
    actorUserId?: string,
  ) {
    const installment = await this.prisma.installment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        financePlan: {
          select: { reservationId: true },
        },
      },
    })

    if (!installment) throw new NotFoundException('Parcela não encontrada')

    if (
      status === InstallmentStatus.PAID ||
      installment.status === InstallmentStatus.PAID
    ) {
      throw new BadRequestException(
        'Pagamentos e estornos devem ser registrados no centro financeiro da reserva',
      )
    }

    const updated = await this.prisma.installment.update({
      where: { id },
      data: {
        status,
        paidAt: null,
        paymentMethod: null,
      },
    })

    if (installment.status !== status) {
      await this.recordAudit(actorUserId, 'OPS_INSTALLMENT_STATUS_CHANGED', {
        installmentId: id,
        reservationId: installment.financePlan.reservationId,
        beforeStatus: installment.status,
        afterStatus: status,
      })
    }

    return updated
  }

  private async assertDraftQuote(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      select: { id: true, status: true },
    })

    if (!quote) throw new NotFoundException('Cotação não encontrada')
    if (quote.status !== QuoteStatus.DRAFT) {
      throw new ConflictException('Cotação enviada é imutável. Crie uma nova revisão.')
    }
  }

  private async recalculateQuote(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    })

    if (!quote) throw new NotFoundException('Cotação não encontrada')

    const subtotalCostCents = quote.items.reduce(
      (sum, item) => sum + item.totalCostCents,
      0,
    )
    const subtotalSaleCents = quote.items.reduce(
      (sum, item) => sum + item.totalSaleCents,
      0,
    )

    if (quote.discountCents > subtotalSaleCents) {
      throw new BadRequestException('O desconto não pode superar o valor da cotação')
    }

    const totalCents = subtotalSaleCents - quote.discountCents
    const marginCents = totalCents - subtotalCostCents

    return this.prisma.quote.update({
      where: { id: quoteId },
      data: {
        subtotalCostCents,
        subtotalSaleCents,
        totalCents,
        marginCents,
      },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        reservation: {
          select: {
            client: { select: { fullName: true, email: true } },
            trip: { select: { title: true, destination: true } },
          },
        },
      },
    })
  }
}
