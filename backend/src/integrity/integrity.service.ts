import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class IntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    const [quotes, plans] = await Promise.all([
      this.prisma.quote.findMany({
        select: {
          id: true,
          reservationId: true,
          subtotalCostCents: true,
          subtotalSaleCents: true,
          discountCents: true,
          totalCents: true,
          marginCents: true,
          items: {
            select: {
              totalCostCents: true,
              totalSaleCents: true,
            },
          },
        },
        take: 5_000,
      }),
      this.prisma.financePlan.findMany({
        select: {
          id: true,
          reservationId: true,
          totalCents: true,
          quote: { select: { totalCents: true } },
          installments: {
            select: { amountCents: true, status: true },
          },
        },
        take: 5_000,
      }),
    ])

    const quoteMismatches = quotes
      .filter((quote) => {
        const cost = quote.items.reduce(
          (sum, item) => sum + item.totalCostCents,
          0,
        )
        const sale = quote.items.reduce(
          (sum, item) => sum + item.totalSaleCents,
          0,
        )
        const total = sale - quote.discountCents
        const margin = total - cost

        return (
          cost !== quote.subtotalCostCents ||
          sale !== quote.subtotalSaleCents ||
          total !== quote.totalCents ||
          margin !== quote.marginCents
        )
      })
      .map((quote) => ({
        quoteId: quote.id,
        reservationId: quote.reservationId,
      }))

    const financeMismatches = plans
      .filter((plan) => {
        const installmentsTotal = plan.installments.reduce(
          (sum, installment) => sum + installment.amountCents,
          0,
        )

        return (
          plan.totalCents !== plan.quote.totalCents ||
          installmentsTotal !== plan.totalCents
        )
      })
      .map((plan) => ({
        financePlanId: plan.id,
        reservationId: plan.reservationId,
      }))

    return {
      healthy:
        quoteMismatches.length === 0 &&
        financeMismatches.length === 0,
      checkedAt: new Date().toISOString(),
      scanned: {
        quotes: quotes.length,
        financePlans: plans.length,
      },
      mismatches: {
        quotes: quoteMismatches,
        financePlans: financeMismatches,
      },
    }
  }
}
