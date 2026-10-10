import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { lockCompanyRead } from './company-write-lock'

const clientFields = { id: true, fullName: true, email: true, phone: true, birthDate: true } as const
const tripFields = { id: true, title: true, origin: true, destination: true,
  departureDate: true, returnDate: true, status: true, priceCents: true } as const
const tripAdminFields = { ...tripFields, summary: true, imageUrl: true,
  capacity: true, busTemplate: true, seatLayout: true, deckCount: true,
  lowerDeckCapacity: true, vehicleFeatures: true, blockedSeats: true } as const

function searchText(query?: string) {
  if (query !== undefined && typeof query !== 'string') throw new BadRequestException('Pesquisa inválida')
  return query?.trim().slice(0, 160) ?? ''
}

function tripSearch(query: string) {
  return { OR: ['title', 'origin', 'destination'].map(field => ({ [field]: { contains: query, mode: 'insensitive' } })) }
}

/** Scoped readers only. Legacy APIs remain unchanged and multi-company activation
 * stays blocked until every operational/public query and write is scoped.
 */
@Injectable()
export class CompanyDataService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: CompanyScopeService) {}

  async paymentsSummary(userId: string, sessionId: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'AGENT') throw new ForbiddenException('Perfil sem acesso ao resumo financeiro')
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const where = { reservation: { companyId: scope.companyId,
        client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } } }
      const invalid = await tx.purchaseOrder.count({ where: { ...where, OR: [
        { totalCents: { lt: 0 } }, { refundedCents: { lt: 0 } },
        { refundedCents: { gt: tx.purchaseOrder.fields.totalCents } },
      ] } })
      if (invalid) throw new ConflictException('Pedidos com valores inconsistentes impedem o resumo financeiro')
      const rows = await tx.purchaseOrder.groupBy({ by: ['status'], where,
        _count: { _all: true }, _sum: { totalCents: true, refundedCents: true } })
      const summary = { totalOrders: 0, paidOrders: 0, pendingOrders: 0, refundedOrders: 0,
        cancelledOrders: 0, expiredOrders: 0, paidCents: 0, pendingCents: 0, refundedCents: 0,
        manualReceivedCount: 0, manualReceivedCents: 0, manualReversedCount: 0, manualReversedCents: 0 }
      for (const row of rows) {
        const count = row._count._all, total = row._sum.totalCents ?? 0, refunded = row._sum.refundedCents ?? 0
        summary.totalOrders += count; summary.refundedCents += refunded
        if (row.status === 'PAID' || row.status === 'PARTIALLY_REFUNDED') {
          summary.paidOrders += count; summary.paidCents += total - refunded
        } else if (row.status === 'PENDING_PAYMENT') {
          summary.pendingOrders += count; summary.pendingCents += total
        } else if (row.status === 'REFUNDED') summary.refundedOrders += count
        else if (row.status === 'CANCELLED') summary.cancelledOrders += count
        else if (row.status === 'EXPIRED') summary.expiredOrders += count
      }
      const manual = await tx.$queryRaw<{ status: string; count: bigint; amount: bigint; invalid: bigint }[]>`
        SELECT m."status"::text AS status, COUNT(*) AS count, SUM(m."amountCents") AS amount,
          COUNT(*) FILTER (WHERE m."amountCents" < 0
            OR (m."financePlanId" IS NOT NULL AND (p."reservationId" IS DISTINCT FROM m."reservationId"
              OR pq."reservationId" IS DISTINCT FROM m."reservationId"))
            OR (m."installmentId" IS NOT NULL AND (ip."reservationId" IS DISTINCT FROM m."reservationId"
              OR iq."reservationId" IS DISTINCT FROM m."reservationId"
              OR (m."financePlanId" IS NOT NULL AND i."financePlanId" IS DISTINCT FROM m."financePlanId")))) AS invalid
        FROM "ManualPayment" m
        JOIN "Reservation" r ON r."id" = m."reservationId"
        JOIN "Client" c ON c."id" = r."clientId"
        JOIN "Trip" t ON t."id" = r."tripId"
        LEFT JOIN "FinancePlan" p ON p."id" = m."financePlanId"
        LEFT JOIN "Quote" pq ON pq."id" = p."quoteId"
        LEFT JOIN "Installment" i ON i."id" = m."installmentId"
        LEFT JOIN "FinancePlan" ip ON ip."id" = i."financePlanId"
        LEFT JOIN "Quote" iq ON iq."id" = ip."quoteId"
        WHERE r."companyId" = ${scope.companyId} AND c."companyId" = ${scope.companyId} AND t."companyId" = ${scope.companyId}
        GROUP BY m."status"`
      for (const row of manual) {
        if (row.invalid > 0n) throw new ConflictException('Recebimentos com valores ou vínculos inconsistentes impedem o resumo financeiro')
        const count = Number(row.count), amount = Number(row.amount)
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(amount)) throw new ConflictException('Resumo financeiro excede o limite seguro')
        if (row.status === 'RECEIVED') {
          summary.manualReceivedCount += count; summary.manualReceivedCents += amount; summary.paidCents += amount
        } else if (row.status === 'REVERSED') {
          summary.manualReversedCount += count; summary.manualReversedCents += amount; summary.refundedCents += amount
        }
      }
      if (Object.values(summary).some(value => !Number.isSafeInteger(value))) {
        throw new ConflictException('Valores excedem o limite seguro do resumo financeiro')
      }
      return { summaryOnly: true, coverage: 'ONLINE_AND_MANUAL_PAYMENTS' as const, summary, orders: [], manualPayments: [] }
    }, { isolationLevel: 'RepeatableRead' })
  }


  /** Page-scoped discrepancy review. No provider access, payment changes or PII. */
  async financeDiscrepancyReport(userId: string, sessionId: string, after?: unknown) {
    if (after !== undefined && (typeof after !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(after))) {
      throw new BadRequestException('Cursor de paginação inválido')
    }
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'AGENT') throw new ForbiddenException('Perfil sem acesso ao relatório financeiro')
    const cursor = (after as string | undefined) ?? ''
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      type ReportRow = {
        reservationId: string; reservationPassengers: number; orderStatus: string | null
        orderTotalCents: number | null; orderUnitCents: number | null
        orderPassengers: number | null; orderRefundedCents: number | null
        hasProviderReference: boolean
        manualCount: bigint; manualReceivedCount: bigint
        manualReceivedCents: bigint; manualReversedCents: bigint
        invalidManualAmounts: bigint; invalidManualLinks: bigint
      }
      // Bound the result set BEFORE joining payment data. Parent tenant checks
      // and transaction-local RLS context are enforced on every page.
      const rows = await tx.$queryRaw<ReportRow[]>`
        WITH page AS (
          SELECT r."id", r."passengerCount"
          FROM "Reservation" r
          JOIN "Client" c ON c."id" = r."clientId"
          JOIN "Trip" t ON t."id" = r."tripId"
          WHERE r."companyId" = ${scope.companyId}
            AND c."companyId" = ${scope.companyId}
            AND t."companyId" = ${scope.companyId}
            AND r."id" > ${cursor}
          ORDER BY r."id" ASC
          LIMIT 51
        )
        SELECT page."id" AS "reservationId", page."passengerCount" AS "reservationPassengers",
          p."status"::text AS "orderStatus",
          p."totalCents" AS "orderTotalCents", p."unitPriceCents" AS "orderUnitCents",
          p."passengerCount" AS "orderPassengers", p."refundedCents" AS "orderRefundedCents",
          (p."providerPaymentId" IS NOT NULL OR p."providerOrderId" IS NOT NULL) AS "hasProviderReference",
          m."count" AS "manualCount", m."receivedCount" AS "manualReceivedCount",
          m."receivedCents" AS "manualReceivedCents", m."reversedCents" AS "manualReversedCents",
          m."invalidAmounts" AS "invalidManualAmounts", m."invalidLinks" AS "invalidManualLinks"
        FROM page
        LEFT JOIN "PurchaseOrder" p ON p."reservationId" = page."id"
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS "count",
            COUNT(*) FILTER (WHERE x."status" = 'RECEIVED') AS "receivedCount",
            COALESCE(SUM(x."amountCents") FILTER (WHERE x."status" = 'RECEIVED'), 0) AS "receivedCents",
            COALESCE(SUM(x."amountCents") FILTER (WHERE x."status" = 'REVERSED'), 0) AS "reversedCents",
            COUNT(*) FILTER (WHERE x."amountCents" <= 0) AS "invalidAmounts",
            COUNT(*) FILTER (WHERE
              (x."financePlanId" IS NOT NULL AND (plan."reservationId" IS DISTINCT FROM page."id"
                OR quote."reservationId" IS DISTINCT FROM page."id"))
              OR (x."installmentId" IS NOT NULL AND (ip."reservationId" IS DISTINCT FROM page."id"
                OR iq."reservationId" IS DISTINCT FROM page."id"
                OR (x."financePlanId" IS NOT NULL AND inst."financePlanId" IS DISTINCT FROM x."financePlanId")))
            ) AS "invalidLinks"
          FROM "ManualPayment" x
          LEFT JOIN "FinancePlan" plan ON plan."id" = x."financePlanId"
          LEFT JOIN "Quote" quote ON quote."id" = plan."quoteId"
          LEFT JOIN "Installment" inst ON inst."id" = x."installmentId"
          LEFT JOIN "FinancePlan" ip ON ip."id" = inst."financePlanId"
          LEFT JOIN "Quote" iq ON iq."id" = ip."quoteId"
          WHERE x."reservationId" = page."id"
        ) m ON true
        ORDER BY page."id" ASC
      `
      const page = rows.slice(0, 50)
      const flagged = []
      let totalFlags = 0
      for (const row of page) {
        const values = [row.manualCount, row.manualReceivedCount, row.manualReceivedCents,
          row.manualReversedCents, row.invalidManualAmounts, row.invalidManualLinks]
        if (values.some(value => !Number.isSafeInteger(Number(value)))) {
          throw new ConflictException('Montantes ou contagens excedem o limite seguro')
        }
        const issues: string[] = []
        if (row.orderStatus !== null) {
          const total = row.orderTotalCents!, unit = row.orderUnitCents!
          const passengers = row.orderPassengers!, refunded = row.orderRefundedCents!
          if (total <= 0 || unit <= 0 || passengers <= 0 || refunded < 0 ||
            refunded > total || unit * passengers !== total) issues.push('ORDER_AMOUNT_MISMATCH')
          if ((row.orderStatus === 'REFUNDED' && refunded !== total) ||
            (row.orderStatus === 'PARTIALLY_REFUNDED' && (refunded <= 0 || refunded >= total)) ||
            (!['REFUNDED', 'PARTIALLY_REFUNDED'].includes(row.orderStatus) && refunded > 0)) {
            issues.push('REFUND_STATUS_MISMATCH')
          }
          if (row.orderPassengers !== row.reservationPassengers) issues.push('PASSENGER_COUNT_MISMATCH')
          if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(row.orderStatus) &&
            !row.hasProviderReference) issues.push('PROVIDER_REFERENCE_MISSING')
        }
        if (row.invalidManualAmounts > 0n) issues.push('INVALID_MANUAL_AMOUNT')
        if (row.invalidManualLinks > 0n) issues.push('MANUAL_ASSOCIATION_MISMATCH')
        if (row.manualReceivedCount > 0n &&
          ['PAID', 'PARTIALLY_REFUNDED'].includes(row.orderStatus ?? '')) {
          issues.push('MIXED_PAYMENT_CHANNELS_REVIEW')
        }
        if (issues.length) {
          totalFlags += issues.length
          flagged.push({ reservationId: row.reservationId, issues,
            online: row.orderStatus === null ? null : {
              status: row.orderStatus, totalCents: row.orderTotalCents,
              refundedCents: row.orderRefundedCents,
            },
            manual: { receivedCount: Number(row.manualReceivedCount),
              receivedCents: Number(row.manualReceivedCents),
              reversedCents: Number(row.manualReversedCents) },
          })
        }
      }
      return {
        reportOnly: true, pageScoped: true, providerContacted: false,
        dataModified: false, paymentsEnabled: false,
        scannedReservations: page.length, flaggedReservations: flagged.length,
        issueCount: totalFlags, pageSize: 50,
        nextCursor: rows.length > 50 ? page[page.length - 1].reservationId : null,
        divergences: flagged,
      }
    }, { isolationLevel: 'RepeatableRead' })
  }

  /** Finance-only projection for one reservation. No checkout, receipt, refund or balance changes. */
  async reservationFinanceSummary(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'AGENT') throw new ForbiddenException('Perfil sem acesso ao financeiro da reserva')
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const reservation = await tx.reservation.findFirst({ where: { id, companyId: scope.companyId,
        client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } },
        select: { id: true, status: true, passengerCount: true,
          trip: { select: { priceCents: true } } } })
      if (!reservation) throw new NotFoundException('Reserva não encontrada')

      const order = await tx.purchaseOrder.findUnique({ where: { reservationId: id },
        select: { status: true, totalCents: true, refundedCents: true } })
      if (order && (order.totalCents < 0 || order.refundedCents < 0 ||
        order.refundedCents > order.totalCents)) {
        throw new ConflictException('Pedido financeiro inconsistente')
      }
      const manual = await tx.$queryRaw<{ status: string; count: bigint; amount: bigint; invalid: bigint }[]>`
        SELECT m."status"::text AS status, COUNT(*) AS count, COALESCE(SUM(m."amountCents"), 0) AS amount,
          COUNT(*) FILTER (WHERE m."amountCents" < 0
            OR (m."financePlanId" IS NOT NULL AND (p."reservationId" IS DISTINCT FROM m."reservationId"
              OR pq."reservationId" IS DISTINCT FROM m."reservationId"))
            OR (m."installmentId" IS NOT NULL AND (ip."reservationId" IS DISTINCT FROM m."reservationId"
              OR iq."reservationId" IS DISTINCT FROM m."reservationId"
              OR (m."financePlanId" IS NOT NULL AND i."financePlanId" IS DISTINCT FROM m."financePlanId")))) AS invalid
        FROM "ManualPayment" m
        LEFT JOIN "FinancePlan" p ON p."id" = m."financePlanId"
        LEFT JOIN "Quote" pq ON pq."id" = p."quoteId"
        LEFT JOIN "Installment" i ON i."id" = m."installmentId"
        LEFT JOIN "FinancePlan" ip ON ip."id" = i."financePlanId"
        LEFT JOIN "Quote" iq ON iq."id" = ip."quoteId"
        WHERE m."reservationId" = ${id}
        GROUP BY m."status"`
      const amounts = { receivedCount: 0, receivedCents: 0, reversedCount: 0, reversedCents: 0 }
      for (const row of manual) {
        if (row.invalid > 0n || !['RECEIVED', 'REVERSED'].includes(row.status)) {
          throw new ConflictException('Recebimentos da reserva inconsistentes')
        }
        const count = Number(row.count), amount = Number(row.amount)
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(amount)) {
          throw new ConflictException('Valores da reserva excedem o limite seguro')
        }
        if (row.status === 'RECEIVED') {
          amounts.receivedCount += count; amounts.receivedCents += amount
        } else {
          amounts.reversedCount += count; amounts.reversedCents += amount
        }
      }
      if (Object.values(amounts).some(value => !Number.isSafeInteger(value))) {
        throw new ConflictException('Valores da reserva excedem o limite seguro')
      }
      return { summaryOnly: true, operationalPaymentsEnabled: false, reservationId: reservation.id,
        reservationStatus: reservation.status, passengerCount: reservation.passengerCount,
        indicativeTripUnitPriceCents: reservation.trip.priceCents,
        onlineOrder: order, manual: amounts }
    }, { isolationLevel: 'RepeatableRead' })
  }


  /** Local preflight only. Never contacts a provider or mutates a payment/ledger. */
  async reconciliationPreflight(userId: string, sessionId: string, reservationId: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'AGENT') throw new ForbiddenException('Perfil sem acesso ao diagnóstico financeiro')
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const own = await tx.reservation.findFirst({ where: { id: reservationId, companyId: scope.companyId,
        client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } },
        select: { id: true } })
      if (!own) throw new NotFoundException('Reserva não encontrada')
      const order = await tx.purchaseOrder.findUnique({ where: { reservationId: own.id },
        select: { status: true, totalCents: true, refundedCents: true,
          providerPaymentId: true, providerOrderId: true } })
      if (order && (order.totalCents <= 0 || order.refundedCents < 0 ||
        order.refundedCents > order.totalCents)) {
        throw new ConflictException('Pedido com valores inconsistentes impede a pré-conciliação')
      }

      // Validate associations before describing mixed online/manual channels as reviewable.
      const [manual] = await tx.$queryRaw<{ count: bigint; received: bigint; invalid: bigint }[]>`
        SELECT COUNT(*) AS count,
          COUNT(*) FILTER (WHERE m."status" = 'RECEIVED') AS received,
          COUNT(*) FILTER (WHERE m."amountCents" <= 0
            OR (m."financePlanId" IS NOT NULL AND (p."reservationId" IS DISTINCT FROM m."reservationId"
              OR pq."reservationId" IS DISTINCT FROM m."reservationId"))
            OR (m."installmentId" IS NOT NULL AND (ip."reservationId" IS DISTINCT FROM m."reservationId"
              OR iq."reservationId" IS DISTINCT FROM m."reservationId"
              OR (m."financePlanId" IS NOT NULL AND i."financePlanId" IS DISTINCT FROM m."financePlanId")))) AS invalid
        FROM "ManualPayment" m
        LEFT JOIN "FinancePlan" p ON p."id" = m."financePlanId"
        LEFT JOIN "Quote" pq ON pq."id" = p."quoteId"
        LEFT JOIN "Installment" i ON i."id" = m."installmentId"
        LEFT JOIN "FinancePlan" ip ON ip."id" = i."financePlanId"
        LEFT JOIN "Quote" iq ON iq."id" = ip."quoteId"
        WHERE m."reservationId" = ${own.id}`
      if (!manual || manual.invalid > 0n ||
        !Number.isSafeInteger(Number(manual.count)) || !Number.isSafeInteger(Number(manual.received))) {
        throw new ConflictException('Recebimentos inconsistentes impedem a pré-conciliação')
      }
      const hasProviderReference = Boolean(order?.providerPaymentId || order?.providerOrderId)
      const blockers = [
        ...(!order ? ['ONLINE_ORDER_MISSING'] : []),
        ...(order && !hasProviderReference ? ['PROVIDER_REFERENCE_MISSING'] : []),
        ...(manual.received > 0n ? ['MANUAL_RECEIPTS_REQUIRE_REVIEW'] : []),
        'COMPANY_RECONCILIATION_DISABLED',
      ]
      return {
        previewOnly: true, providerContacted: false, dataModified: false, reconciliationEnabled: false,
        reservationId: own.id,
        onlineOrder: order ? { status: order.status, totalCents: order.totalCents,
          refundedCents: order.refundedCents, hasProviderReference } : null,
        manualEntryCount: Number(manual.count),
        blockers,
      }
    }, { isolationLevel: 'RepeatableRead' })
  }

  async search(userId: string, sessionId: string, rawQuery: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso à pesquisa operacional')
    const q = searchText(rawQuery)
    if (q.length < 2) return { clients: [], trips: [], reservations: [] }
    const companyId = scope.companyId
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const [clients, trips, reservations] = await Promise.all([
        tx.client.findMany({ where: { companyId, OR: ['fullName', 'email', 'phone'].map(field => ({
          [field]: { contains: q, mode: 'insensitive' },
        })) }, select: clientFields, orderBy: { id: 'asc' }, take: 8 }),
        tx.trip.findMany({ where: { companyId, ...tripSearch(q) }, select: tripFields, orderBy: { id: 'asc' }, take: 8 }),
        tx.reservation.findMany({ where: { companyId, client: { companyId }, trip: { companyId }, OR: [
          { id: { contains: q, mode: 'insensitive' } },
          { client: { fullName: { contains: q, mode: 'insensitive' } } },
          { trip: { title: { contains: q, mode: 'insensitive' } } },
        ] }, select: this.reservationFields(scope.role), orderBy: { id: 'asc' }, take: 8 }),
      ])
      return { clients, trips, reservations }
    }, { isolationLevel: 'RepeatableRead' })
  }

  async dashboard(userId: string, sessionId: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    const companyId = scope.companyId
    // Include both parents: a reservation must never contribute through a
    // foreign client/trip, even while legacy records are being backfilled.
    const reservationScope = { companyId, client: { companyId }, trip: { companyId } }
    const [clients, pendingReservations, activeTrips, confirmedReservations, birthdays] =
      await this.prisma.$transaction(async tx => {
        await lockCompanyRead(tx, scope)
        return Promise.all([
          tx.client.count({ where: { companyId } }),
          tx.reservation.count({ where: { ...reservationScope, status: 'PENDING' } }),
          tx.trip.count({ where: { companyId, status: { in: ['ACTIVE', 'SCHEDULED'] } } }),
          tx.reservation.count({ where: { ...reservationScope, status: 'CONFIRMED' } }),
          tx.client.findMany({ where: { companyId, birthDate: { not: null },
            ...(scope.role === 'FINANCE' ? { id: { in: [] as string[] } } : {}) },
            select: { id: true, fullName: true, phone: true, birthDate: true } }),
        ])
      }, { isolationLevel: 'RepeatableRead' })
    const now = new Date()
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const upcomingBirthdays = birthdays.map(client => {
      const birth = client.birthDate!
      let nextBirthday = new Date(Date.UTC(now.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate()))
      if (nextBirthday.getTime() < today) {
        nextBirthday = new Date(Date.UTC(now.getUTCFullYear() + 1, birth.getUTCMonth(), birth.getUTCDate()))
      }
      return { ...client, nextBirthday, daysUntil: Math.round((nextBirthday.getTime() - today) / 86_400_000) }
    }).filter(client => client.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil || a.id.localeCompare(b.id)).slice(0, 12)
    return { metrics: { clients, pendingReservations, activeTrips, confirmedReservations }, birthdays: upcomingBirthdays }
  }

  async clients(userId: string, sessionId: string, query?: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de clientes')
    const q = searchText(query)
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      return tx.client.findMany({ where: { companyId: scope.companyId,
        ...(q ? { fullName: { contains: q, mode: 'insensitive' as const } } : {}) },
        select: clientFields, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: 100 })
    }, { isolationLevel: 'RepeatableRead' })
  }

  async client(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de clientes')
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const result = await tx.client.findFirst({ where: { id, companyId: scope.companyId }, select: {
        ...clientFields, companions: { select: { id: true, fullName: true, birthDate: true, relationship: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      } })
      if (!result) throw new NotFoundException('Cliente não encontrado')
      return result
    }, { isolationLevel: 'RepeatableRead' })
  }

  async trips(userId: string, sessionId: string, query?: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de viagens')
    const q = searchText(query)
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      return tx.trip.findMany({ where: { companyId: scope.companyId, ...(q ? tripSearch(q) : {}) }, select: tripAdminFields,
        orderBy: [{ departureDate: 'desc' }, { id: 'desc' }], take: 100 })
    }, { isolationLevel: 'RepeatableRead' })
  }

  async trip(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de viagens')
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const result = await tx.trip.findFirst({ where: { id, companyId: scope.companyId }, select: tripAdminFields })
      if (!result) throw new NotFoundException('Viagem não encontrada')
      return result
    }, { isolationLevel: 'RepeatableRead' })
  }

  private reservationFields(role: 'ADMIN' | 'AGENT' | 'FINANCE') {
    return { id: true, status: true, passengerCount: true, createdAt: true,
      client: { select: { id: true, ...(role !== 'FINANCE' ? { fullName: true } : {}) } },
      trip: { select: tripFields } } as const
  }

  async reservations(userId: string, sessionId: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const rows = await tx.reservation.findMany({ where: { companyId: scope.companyId,
        client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } },
        select: this.reservationFields(scope.role), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 })
      return rows.map(row => ({ ...row, ...(scope.role === 'ADMIN' ? {
        companyPortalAccess: { canIssue: row.status !== 'CANCELLED' &&
          ['ACTIVE', 'SCHEDULED', 'COMPLETED'].includes(row.trip.status) },
      } : {}) }))
    }, { isolationLevel: 'RepeatableRead' })
  }

  async reservation(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    return this.prisma.$transaction(async tx => {
      await lockCompanyRead(tx, scope)
      const result = await tx.reservation.findFirst({ where: { id, companyId: scope.companyId,
        client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } }, select: this.reservationFields(scope.role) })
      if (!result) throw new NotFoundException('Reserva não encontrada')
      return result
    }, { isolationLevel: 'RepeatableRead' })
  }
}
