import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'

const clientFields = { id: true, fullName: true, email: true, phone: true, birthDate: true } as const
const tripFields = { id: true, title: true, origin: true, destination: true,
  departureDate: true, returnDate: true, status: true, priceCents: true } as const

/** Scoped readers only. Legacy APIs remain unchanged and multi-company activation
 * stays blocked until every operational/public query and write is scoped.
 */
@Injectable()
export class CompanyDataService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: CompanyScopeService) {}

  async dashboard(userId: string, sessionId: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    const companyId = scope.companyId
    // Include both parents: a reservation must never contribute through a
    // foreign client/trip, even while legacy records are being backfilled.
    const reservationScope = { companyId, client: { companyId }, trip: { companyId } }
    const [clients, pendingReservations, activeTrips, confirmedReservations, birthdays] = await this.prisma.$transaction([
      this.prisma.client.count({ where: { companyId } }),
      this.prisma.reservation.count({ where: { ...reservationScope, status: 'PENDING' } }),
      this.prisma.trip.count({ where: { companyId, status: { in: ['ACTIVE', 'SCHEDULED'] } } }),
      this.prisma.reservation.count({ where: { ...reservationScope, status: 'CONFIRMED' } }),
      this.prisma.client.findMany({ where: { companyId, birthDate: { not: null },
        ...(scope.role === 'FINANCE' ? { id: { in: [] as string[] } } : {}) },
        select: { id: true, fullName: true, phone: true, birthDate: true } }),
    ], { isolationLevel: 'RepeatableRead' })
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
    const q = query?.trim().slice(0, 160)
    return this.prisma.client.findMany({ where: { companyId: scope.companyId,
      ...(q ? { fullName: { contains: q, mode: 'insensitive' as const } } : {}) },
      select: clientFields, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: 100 })
  }

  async client(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de clientes')
    const result = await this.prisma.client.findFirst({ where: { id, companyId: scope.companyId }, select: {
      ...clientFields, companions: { select: { id: true, fullName: true, birthDate: true, relationship: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    } })
    if (!result) throw new NotFoundException('Cliente não encontrado')
    return result
  }

  async trips(userId: string, sessionId: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de viagens')
    return this.prisma.trip.findMany({ where: { companyId: scope.companyId }, select: tripFields,
      orderBy: [{ departureDate: 'desc' }, { id: 'desc' }], take: 100 })
  }

  async trip(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de viagens')
    const result = await this.prisma.trip.findFirst({ where: { id, companyId: scope.companyId }, select: tripFields })
    if (!result) throw new NotFoundException('Viagem não encontrada')
    return result
  }

  private reservationFields(role: 'ADMIN' | 'AGENT' | 'FINANCE') {
    return { id: true, status: true, passengerCount: true, createdAt: true,
      client: { select: { id: true, ...(role !== 'FINANCE' ? { fullName: true } : {}) } },
      trip: { select: tripFields } } as const
  }

  async reservations(userId: string, sessionId: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    return this.prisma.reservation.findMany({ where: { companyId: scope.companyId,
      client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } },
      select: this.reservationFields(scope.role), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 })
  }

  async reservation(userId: string, sessionId: string, id: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    const result = await this.prisma.reservation.findFirst({ where: { id, companyId: scope.companyId,
      client: { companyId: scope.companyId }, trip: { companyId: scope.companyId } }, select: this.reservationFields(scope.role) })
    if (!result) throw new NotFoundException('Reserva não encontrada')
    return result
  }
}
