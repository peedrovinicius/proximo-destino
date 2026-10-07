import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { lockCompanyWrite } from './company-write-lock'

@Injectable()
export class CompanyReservationAccessService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: CompanyScopeService,
    private readonly config: ConfigService) {}

  private async change(userId: string, sessionId: string, id: string, issue: boolean) {
    if (this.config.get('COMPANY_FOUNDATION_ENABLED') !== 'true' || this.config.get('COMPANY_CLIENT_PORTAL_ENABLED') !== 'true') {
      throw new NotFoundException('Recurso indisponível')
    }
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role !== 'ADMIN') throw new ForbiddenException('Perfil sem acesso à emissão de códigos')
    // Generate and hash before locking; plaintext only leaves the transaction after audit commits.
    const code = issue ? randomBytes(24).toString('hex').toUpperCase() : null
    const accessCodeHash = code ? await argon2.hash(code) : null
    return this.prisma.$transaction(async tx => {
      await lockCompanyWrite(tx, scope)
      // Same lock order as portal login: company, reservation, client, trip, sessions.
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} AND "companyId" = ${scope.companyId} FOR UPDATE`
      const row = await tx.reservation.findFirst({ where: { id, companyId: scope.companyId },
        select: { id: true, clientId: true, tripId: true, status: true } })
      if (!row) throw new NotFoundException('Reserva não encontrada')
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${row.clientId} FOR SHARE`
      await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${row.tripId} FOR SHARE`
      const client = await tx.client.findFirst({ where: { id: row.clientId, companyId: scope.companyId }, select: { email: true } })
      const trip = await tx.trip.findFirst({ where: { id: row.tripId, companyId: scope.companyId }, select: { status: true } })
      if (!client || !trip) throw new NotFoundException('Reserva não encontrada')
      if (issue && (row.status === 'CANCELLED' || !client.email?.trim() || !['ACTIVE', 'SCHEDULED', 'COMPLETED'].includes(trip.status))) {
        throw new ConflictException('Reserva indisponível para emitir acesso ao portal')
      }
      const now = new Date(), expiresAt = issue ? new Date(now.getTime() + 24 * 60 * 60_000) : null
      await tx.reservation.update({ where: { id, companyId: scope.companyId }, data: {
        accessCodeHash, companyPortalCodeExpiresAt: expiresAt,
        companyPortalFailedAttempts: 0, companyPortalLockedUntil: null,
      } })
      await tx.companyClientPortalSession.updateMany({ where: { reservationId: id, revokedAt: null }, data: { revokedAt: now } })
      await tx.authAuditEvent.create({ data: { userId, eventType: issue ? 'OPS_COMPANY_PORTAL_CODE_ISSUED' : 'OPS_COMPANY_PORTAL_CODE_REVOKED',
        metadata: { companyId: scope.companyId, reservationId: id } } })
      return issue ? { reservationId: id, code: code!, expiresAt: expiresAt!, delivery: 'MANUAL_PRIVATE' as const } : { revoked: true }
    })
  }
  issue(userId: string, sessionId: string, id: string) { return this.change(userId, sessionId, id, true) }
  revoke(userId: string, sessionId: string, id: string) { return this.change(userId, sessionId, id, false) }
}
