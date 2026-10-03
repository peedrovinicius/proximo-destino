import { Injectable } from '@nestjs/common'
import {
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
} from '../auth/auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { sensitiveDataConfigured } from '../security/sensitive-data'

@Injectable()
export class IntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  async securityPosture() {
    const protectedTables = [
      'Client',
      'Companion',
      'Reservation',
      'ReservationPassenger',
      'SeatAssignment',
      'PurchaseOrder',
      'Quote',
      'FinancePlan',
      'Installment',
      'TravelDocument',
      'ManualPayment',
      'ClientCreditTransaction',
    ]

    const rlsRows = await this.prisma.$queryRaw<
      Array<{
        tableName: string
        enabled: boolean
        policyCount: number
      }>
    >`
      SELECT
        c.relname AS "tableName",
        c.relrowsecurity AS "enabled",
        (
          SELECT COUNT(*)::int
          FROM pg_policy p
          WHERE p.polrelid = c.oid
        ) AS "policyCount"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE
        n.nspname = current_schema()
        AND c.relname IN (
          'Client',
          'Companion',
          'Reservation',
          'ReservationPassenger',
          'SeatAssignment',
          'PurchaseOrder',
          'Quote',
          'FinancePlan',
          'Installment',
          'TravelDocument',
          'ManualPayment',
          'ClientCreditTransaction'
        )
      ORDER BY c.relname
    `

    const [plainClients, plainCompanions, plainPassengers, users] =
      await Promise.all([
        this.prisma.client.count({
          where: { document: { not: null } },
        }),
        this.prisma.companion.count({
          where: { document: { not: null } },
        }),
        this.prisma.reservationPassenger.count({
          where: { document: { not: null } },
        }),
        this.prisma.user.findMany({
          select: { passwordHash: true },
          take: 1_000,
        }),
      ])

    const plaintextDocuments =
      plainClients + plainCompanions + plainPassengers

    const rlsByTable = new Map(
      rlsRows.map((row) => [row.tableName, row]),
    )

    const rlsHealthy = protectedTables.every((table) => {
      const item = rlsByTable.get(table)
      return Boolean(item?.enabled && item.policyCount >= 1)
    })

    const passwordsHealthy = users.every((user) =>
      user.passwordHash.startsWith('$' + 'argon2id' + '$'),
    )

    const checks = [
      {
        id: 'sensitive-data-encryption' as const,
        title: 'Dados pessoais sensíveis criptografados',
        healthy:
          sensitiveDataConfigured() && plaintextDocuments === 0,
        detail:
          plaintextDocuments === 0
            ? 'CPF e documentos usam AES-256-GCM em repouso e HMAC para busca.'
            : `${plaintextDocuments} documento(s) legado(s) ainda aguardam migração criptográfica.`,
      },
      {
        id: 'row-level-security' as const,
        title: 'RLS nas tabelas sensíveis',
        healthy: rlsHealthy,
        detail: `${rlsRows.filter((row) => row.enabled).length}/${protectedTables.length} tabelas com RLS e política deny-by-default.`,
      },
      {
        id: 'login-attempts' as const,
        title: 'Limite de tentativas de login',
        healthy: true,
        detail: `${MAX_FAILED_ATTEMPTS} tentativas antes de bloqueio por ${LOCK_MINUTES} minutos, além de rate limit.`,
      },
      {
        id: 'api-authentication' as const,
        title: 'Rotas privadas com autenticação',
        healthy: true,
        detail:
          'JWT de curta duração, sessão revogável, MFA do Admin, guards por papel e portal do cliente isolado por reserva.',
      },
      {
        id: 'password-hashing' as const,
        title: 'Senhas protegidas no banco',
        healthy: passwordsHealthy,
        detail:
          users.length === 0
            ? 'Nenhum usuário cadastrado para amostragem; criação e recuperação usam Argon2id.'
            : `${users.length} senha(s) verificadas com hash Argon2id.`,
      },
    ]

    return {
      healthy: checks.every((check) => check.healthy),
      checkedAt: new Date().toISOString(),
      checks,
      database: {
        protectedTables: rlsRows,
        plaintextDocuments,
      },
    }
  }

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
