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
    const result = await this.prisma.client.findFirst({ where: { id, companyId: scope.companyId }, select: clientFields })
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
