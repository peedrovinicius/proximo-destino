import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MfaService } from '../auth/mfa.service'
import { lockCreatorWrite } from './creator-write-lock'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const invalidInvite = () => new BadRequestException('Convite inválido, indisponível ou expirado')

@Injectable()
export class CompanyInvitationsService {
  constructor(private readonly prisma: PrismaService, private readonly mfa: MfaService) {}

  private async lockPending(tx: Prisma.TransactionClient, companyId: string, membershipId: string, allowUsed = false) {
    const rows = await tx.$queryRaw<{ userId: string }[]>`
      SELECT m."userId" FROM "CompanyMembership" m JOIN "Company" c ON c."id" = m."companyId"
      JOIN "User" u ON u."id" = m."userId"
      WHERE c."id" = ${companyId} AND m."id" = ${membershipId} AND c."status" = 'DRAFT'
        AND m."role" = 'ADMIN' AND m."isActive" = false AND (${allowUsed} = true OR m."inviteUsedAt" IS NULL)
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
      const pending = await this.lockPending(tx, companyId, membershipId, true)
      await tx.companyMembership.update({ where: { id: membershipId }, data: {
        inviteTokenHash: null, inviteExpiresAt: null, inviteUsedAt: null,
        onboardingTokenHash: null, onboardingExpiresAt: null, onboardingFailedAttempts: 0,
      } })
      await tx.user.update({ where: { id: pending.userId }, data: { mfaPendingSecretEncrypted: null } })
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
    const onboardingToken = randomBytes(32).toString('base64url')
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
        onboardingTokenHash: hashToken(onboardingToken), onboardingExpiresAt: new Date(Date.now() + 15 * 60_000), onboardingFailedAttempts: 0,
      } })
      await tx.authAuditEvent.create({ data: { userId: pending.userId, eventType: 'PLATFORM_ADMIN_INVITE_ACCEPTED',
        metadata: { companyId: pending.companyId, membershipId: pending.id } } })
      return { passwordSet: true, onboardingToken, activationAllowed: false }
    })
  }
  async resume(email: string, password: string) {
    const result = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; userId: string; companyId: string; passwordHash: string;
        failedLoginAttempts: number; lockedUntil: Date | null }[]>`
        SELECT m."id", m."userId", m."companyId", u."passwordHash", u."failedLoginAttempts", u."lockedUntil"
        FROM "CompanyMembership" m JOIN "Company" c ON c."id" = m."companyId" JOIN "User" u ON u."id" = m."userId"
        WHERE u."email" = ${email.trim().toLowerCase()} AND m."inviteUsedAt" IS NOT NULL
          AND c."status" = 'DRAFT' AND m."role" = 'ADMIN' AND m."isActive" = false
          AND u."role" = 'ADMIN' AND u."isActive" = false AND u."companyManaged" = true AND u."mfaEnabled" = false
        FOR UPDATE OF c, m, u`
      const pending = rows[0]
      if (!pending || (pending.lockedUntil && pending.lockedUntil > new Date())) return null
      if (!await argon2.verify(pending.passwordHash, password)) {
        const locked = pending.failedLoginAttempts + 1 >= 5
        await tx.user.update({ where: { id: pending.userId }, data: {
          failedLoginAttempts: locked ? 0 : pending.failedLoginAttempts + 1,
          lockedUntil: locked ? new Date(Date.now() + 15 * 60_000) : null,
        } })
        await tx.authAuditEvent.create({ data: { userId: pending.userId, eventType: locked ? 'PLATFORM_ONBOARDING_LOCKED' : 'PLATFORM_ONBOARDING_PASSWORD_FAILED',
          metadata: { companyId: pending.companyId, membershipId: pending.id } } })
        return null
      }
      const onboardingToken = randomBytes(32).toString('base64url')
      await tx.user.update({ where: { id: pending.userId }, data: { failedLoginAttempts: 0, lockedUntil: null,
        mfaPendingSecretEncrypted: null } })
      await tx.companyMembership.update({ where: { id: pending.id }, data: { onboardingTokenHash: hashToken(onboardingToken),
        onboardingExpiresAt: new Date(Date.now() + 15 * 60_000), onboardingFailedAttempts: 0 } })
      await tx.authAuditEvent.create({ data: { userId: pending.userId, eventType: 'PLATFORM_ONBOARDING_RESUMED',
        metadata: { companyId: pending.companyId, membershipId: pending.id } } })
      return { onboardingToken, activationAllowed: false }
    })
    if (!result) throw new UnauthorizedException('Credenciais ou preparação de acesso indisponíveis')
    return result
  }

  private async lockOnboarding(tx: Prisma.TransactionClient, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidInvite()
    const rows = await tx.$queryRaw<{ id: string; userId: string; companyId: string; email: string;
      mfaPendingSecretEncrypted: string | null; onboardingFailedAttempts: number }[]>`
      SELECT m."id", m."userId", m."companyId", u."email", u."mfaPendingSecretEncrypted", m."onboardingFailedAttempts"
      FROM "CompanyMembership" m JOIN "Company" c ON c."id" = m."companyId" JOIN "User" u ON u."id" = m."userId"
      WHERE m."onboardingTokenHash" = ${hashToken(token)} AND m."onboardingExpiresAt" > clock_timestamp()
        AND m."inviteUsedAt" IS NOT NULL AND c."status" = 'DRAFT' AND m."role" = 'ADMIN' AND m."isActive" = false
        AND u."role" = 'ADMIN' AND u."isActive" = false AND u."companyManaged" = true AND u."mfaEnabled" = false
        AND (u."lockedUntil" IS NULL OR u."lockedUntil" <= clock_timestamp())
      FOR UPDATE OF c, m, u`
    if (!rows.length) throw invalidInvite()
    return rows[0]
  }

  async beginMfa(token: string) {
    return this.prisma.$transaction(async tx => {
      const pending = await this.lockOnboarding(tx, token)
      const prepared = await this.mfa.prepareSetup(pending.email)
      await tx.user.update({ where: { id: pending.userId }, data: { mfaPendingSecretEncrypted: prepared.encrypted } })
      await tx.authAuditEvent.create({ data: { userId: pending.userId, eventType: 'PLATFORM_ONBOARDING_MFA_STARTED',
        metadata: { companyId: pending.companyId, membershipId: pending.id } } })
      return { ...prepared.response, activationAllowed: false }
    })
  }

  async confirmMfa(token: string, code: string) {
    if (!/^\d{6}$/.test(code)) throw invalidInvite()
    const result = await this.prisma.$transaction(async tx => {
      const pending = await this.lockOnboarding(tx, token)
      if (!pending.mfaPendingSecretEncrypted) throw invalidInvite()
      let prepared
      try { prepared = await this.mfa.prepareConfirmation(pending.mfaPendingSecretEncrypted, code) }
      catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error
        const attempts = pending.onboardingFailedAttempts + 1
        await tx.companyMembership.update({ where: { id: pending.id }, data: { onboardingFailedAttempts: attempts,
          ...(attempts >= 5 ? { onboardingTokenHash: null, onboardingExpiresAt: null } : {}) } })
        if (attempts >= 5) await tx.user.update({ where: { id: pending.userId }, data: { mfaPendingSecretEncrypted: null } })
        await tx.authAuditEvent.create({ data: { userId: pending.userId, eventType: 'PLATFORM_ONBOARDING_MFA_FAILED',
          metadata: { companyId: pending.companyId, membershipId: pending.id } } })
        return null
      }
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: pending.userId } })
      await tx.user.update({ where: { id: pending.userId }, data: { mfaEnabled: true, mfaEnrolledAt: new Date(),
        mfaSecretEncrypted: prepared.encryptedSecret, mfaPendingSecretEncrypted: null } })
      await tx.mfaRecoveryCode.createMany({ data: prepared.codeHashes.map(codeHash => ({ userId: pending.userId, codeHash })) })
      await tx.companyMembership.update({ where: { id: pending.id }, data: { onboardingTokenHash: null,
        onboardingExpiresAt: null, onboardingFailedAttempts: 0 } })
      await tx.authAuditEvent.create({ data: { userId: pending.userId, eventType: 'PLATFORM_ONBOARDING_MFA_CONFIRMED',
        metadata: { companyId: pending.companyId, membershipId: pending.id } } })
      return { mfaConfigured: true, recoveryCodes: prepared.recoveryCodes, activationAllowed: false }
    })
    if (!result) throw new UnauthorizedException('Código inválido; retome a preparação se necessário')
    return result
  }

}
