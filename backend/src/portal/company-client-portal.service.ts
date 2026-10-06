import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import { createHash, randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const denied = () => new UnauthorizedException('Acesso inválido ou indisponível')

@Injectable()
export class CompanyClientPortalService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  private enabled() {
    if (this.config.get('COMPANY_FOUNDATION_ENABLED') !== 'true' || this.config.get('COMPANY_CLIENT_PORTAL_ENABLED') !== 'true') {
      throw new NotFoundException('Recurso indisponível')
    }
  }
  private async scope(tx: Prisma.TransactionClient, slug: string, reservationId: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) throw denied()
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "slug" = ${slug} FOR SHARE`
    const company = await tx.company.findFirst({ where: { slug, status: 'ACTIVE' }, select: { id: true, slug: true, tradeName: true } })
    if (!company) throw denied()
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} AND "companyId" = ${company.id} FOR UPDATE`
    const reservation = await tx.reservation.findFirst({ where: { id: reservationId, companyId: company.id, status: { not: 'CANCELLED' } },
      select: { id: true, clientId: true, tripId: true, accessCodeHash: true, companyPortalFailedAttempts: true, companyPortalLockedUntil: true } })
    if (!reservation?.accessCodeHash) throw denied()
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${reservation.clientId} FOR SHARE`
    await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${reservation.tripId} FOR SHARE`
    const client = await tx.client.findFirst({ where: { id: reservation.clientId, companyId: company.id }, select: { id: true, email: true } })
    const trip = await tx.trip.findFirst({ where: { id: reservation.tripId, companyId: company.id,
      status: { in: ['ACTIVE', 'SCHEDULED', 'COMPLETED'] } }, select: { id: true } })
    if (!client || !trip) throw denied()
    return { company, reservation, client }
  }
  async login(slug: string, input: { reservationId: string; email: string; code: string }) {
    this.enabled()
    const result = await this.prisma.$transaction(async tx => {
      const { company, reservation, client } = await this.scope(tx, slug, input.reservationId)
      const now = new Date()
      if (reservation.companyPortalLockedUntil && reservation.companyPortalLockedUntil > now) return null
      const valid = await argon2.verify(reservation.accessCodeHash!, input.code.trim().toUpperCase())
      if (!valid || client.email?.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
        const attempts = reservation.companyPortalLockedUntil ? 1 : reservation.companyPortalFailedAttempts + 1
        await tx.reservation.update({ where: { id: reservation.id }, data: { companyPortalFailedAttempts: attempts,
          companyPortalLockedUntil: attempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null } })
        await tx.authAuditEvent.create({ data: { eventType: 'CLIENT_COMPANY_PORTAL_LOGIN_FAILED',
          metadata: { companyId: company.id, reservationId: reservation.id, locked: attempts >= 5 } } })
        return null
      }
      const token = randomBytes(32).toString('base64url'), expiresAt = new Date(now.getTime() + 30 * 60_000)
      await tx.reservation.update({ where: { id: reservation.id }, data: { companyPortalFailedAttempts: 0, companyPortalLockedUntil: null } })
      // One active session per reservation; a new login revokes the preceding session.
      await tx.companyClientPortalSession.updateMany({ where: { reservationId: reservation.id, revokedAt: null }, data: { revokedAt: now } })
      await tx.companyClientPortalSession.create({ data: { tokenHash: hash(token), companyId: company.id,
        clientId: client.id, reservationId: reservation.id, credentialVersion: hash(reservation.accessCodeHash!), expiresAt } })
      await tx.authAuditEvent.create({ data: { eventType: 'CLIENT_COMPANY_PORTAL_LOGIN', metadata: { companyId: company.id, reservationId: reservation.id } } })
      return { accessToken: token, expiresAt, readOnly: true }
    })
    if (!result) throw denied()
    return result
  }
  private async session<T>(slug: string, token: string, callback: (tx: Prisma.TransactionClient, sessionId: string, scope: Awaited<ReturnType<CompanyClientPortalService['scope']>>) => Promise<T>) {
    this.enabled()
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw denied()
    return this.prisma.$transaction(async tx => {
      const session = await tx.companyClientPortalSession.findUnique({ where: { tokenHash: hash(token) } })
      if (!session || session.revokedAt || session.expiresAt <= new Date()) throw denied()
      const scope = await this.scope(tx, slug, session.reservationId)
      await tx.$queryRaw`SELECT "id" FROM "CompanyClientPortalSession" WHERE "id" = ${session.id} FOR UPDATE`
      const current = await tx.companyClientPortalSession.findUnique({ where: { id: session.id } })
      if (!current || current.revokedAt || current.expiresAt <= new Date() || current.companyId !== scope.company.id ||
        current.clientId !== scope.client.id || current.credentialVersion !== hash(scope.reservation.accessCodeHash!)) throw denied()
      return callback(tx, session.id, scope)
    })
  }
  portal(slug: string, token: string) {
    return this.session(slug, token, async (tx, _sessionId, { company, reservation }) => {
      const data = await tx.reservation.findUniqueOrThrow({ where: { id: reservation.id }, select: { status: true, passengerCount: true,
        trip: { select: { id: true, capacity: true, title: true, origin: true, destination: true, departureDate: true, returnDate: true } },
        seatAssignments: { select: { seatNumber: true, tripId: true }, orderBy: { seatNumber: 'asc' } } } })
      if (data.seatAssignments.some(row => row.tripId !== data.trip.id || !data.trip.capacity || row.seatNumber < 1 || row.seatNumber > data.trip.capacity)) throw denied()
      const { id: _tripId, capacity: _capacity, ...trip } = data.trip
      return { company: { slug: company.slug, tradeName: company.tradeName }, reservation: {
        status: data.status, passengerCount: data.passengerCount, trip, seats: data.seatAssignments.map(row => row.seatNumber),
      }, readOnly: true }
    })
  }
  logout(slug: string, token: string) {
    return this.session(slug, token, async (tx, id, { company, reservation }) => {
      await tx.companyClientPortalSession.update({ where: { id }, data: { revokedAt: new Date() } })
      await tx.authAuditEvent.create({ data: { eventType: 'CLIENT_COMPANY_PORTAL_LOGOUT', metadata: { companyId: company.id, reservationId: reservation.id } } })
      return { loggedOut: true }
    })
  }
}
