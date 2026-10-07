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
