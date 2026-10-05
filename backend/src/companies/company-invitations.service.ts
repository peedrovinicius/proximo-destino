import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { lockCreatorWrite } from './creator-write-lock'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const invalidInvite = () => new BadRequestException('Convite inválido, indisponível ou expirado')

@Injectable()
export class CompanyInvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async lockPending(tx: Prisma.TransactionClient, companyId: string, membershipId: string) {
    const rows = await tx.$queryRaw<{ userId: string }[]>`
      SELECT m."userId" FROM "CompanyMembership" m JOIN "Company" c ON c."id" = m."companyId"
      JOIN "User" u ON u."id" = m."userId"
      WHERE c."id" = ${companyId} AND m."id" = ${membershipId} AND c."status" = 'DRAFT'
        AND m."role" = 'ADMIN' AND m."isActive" = false AND m."inviteUsedAt" IS NULL
        AND u."role" = 'ADMIN' AND u."isActive" = false AND u."companyManaged" = true
        AND u."mfaEnabled" = false
      FOR UPDATE OF c, m, u`
    if (!rows.length) throw new NotFoundException('Administrador pendente não encontrado')
    return rows[0]
  }

  async issue(actorId: string, sessionId: string, companyId: string, membershipId: string) {
    const token = randomBytes(32).toString('base64url')
    return this.prisma.$transaction(async tx => {
      await lockCreatorWrite(tx, actorId, sessionId)
      await this.lockPending(tx, companyId, membershipId)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      await tx.companyMembership.update({ where: { id: membershipId }, data: {
        inviteTokenHash: hashToken(token), inviteExpiresAt: expiresAt,
      } })
      await tx.authAuditEvent.create({ data: { userId: actorId, eventType: 'PLATFORM_ADMIN_INVITE_ISSUED',
        metadata: { companyId, membershipId } } })
      // This secret is returned only on issuance; never persisted in plain text or put in URLs.
      return { token, expiresAt, activationAllowed: false }
    })
  }

  async revoke(actorId: string, sessionId: string, companyId: string, membershipId: string) {
    return this.prisma.$transaction(async tx => {
      await lockCreatorWrite(tx, actorId, sessionId)
      await this.lockPending(tx, companyId, membershipId)
      await tx.companyMembership.update({ where: { id: membershipId }, data: {
        inviteTokenHash: null, inviteExpiresAt: null,
      } })
      await tx.authAuditEvent.create({ data: { userId: actorId, eventType: 'PLATFORM_ADMIN_INVITE_REVOKED',
        metadata: { companyId, membershipId } } })
      return { revoked: true, activationAllowed: false }
    })
  }

  async accept(token: string, password: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || typeof password !== 'string' || password.length < 16 || password.length > 128) {
      throw invalidInvite()
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; userId: string; companyId: string }[]>`
        SELECT m."id", m."userId", m."companyId" FROM "CompanyMembership" m
        JOIN "Company" c ON c."id" = m."companyId" JOIN "User" u ON u."id" = m."userId"
        WHERE m."inviteTokenHash" = ${hashToken(token)} AND m."inviteUsedAt" IS NULL
          AND m."inviteExpiresAt" > clock_timestamp() AND c."status" = 'DRAFT'
          AND m."role" = 'ADMIN' AND m."isActive" = false
          AND u."role" = 'ADMIN' AND u."isActive" = false AND u."companyManaged" = true
          AND u."mfaEnabled" = false
        FOR UPDATE OF c, m, u`
      if (!rows.length) throw invalidInvite()
      const pending = rows[0]
      await tx.user.update({ where: { id: pending.userId }, data: { passwordHash } })
      await tx.companyMembership.update({ where: { id: pending.id }, data: {
        inviteUsedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null,
      } })
      await tx.authAuditEvent.create({ data: { userId: pending.userId, eventType: 'PLATFORM_ADMIN_INVITE_ACCEPTED',
        metadata: { companyId: pending.companyId, membershipId: pending.id } } })
      return { passwordSet: true, activationAllowed: false }
    })
  }
}
