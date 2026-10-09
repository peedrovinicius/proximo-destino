import {
  ForbiddenException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { UserRole } from '@prisma/client'
import * as argon2 from 'argon2'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from './audit.service'
import type {
  AccessTokenPayload,
  MfaChallengePayload,
  RefreshTokenPayload,
  RequestContext,
} from './auth.types'
import { MfaService } from './mfa.service'
import { SessionService } from './session.service'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async loginAdmin(email: string, password: string, context: RequestContext) {
    return this.loginStaff(email, password, context, [UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE])
  }

  async loginCreator(email: string, password: string, context: RequestContext) {
    if (this.config.get<string>('COMPANY_FOUNDATION_ENABLED') !== 'true') {
      throw new ForbiddenException('Cadastro de empresas ainda não habilitado')
    }
    return this.loginStaff(email, password, context, [UserRole.CREATOR])
  }

  private async loginStaff(email: string, password: string, context: RequestContext, allowedRoles: UserRole[]) {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user || !user.isActive) {
      await this.audit.record('LOGIN_FAILED', { email: normalizedEmail, context })
      throw new UnauthorizedException('Credenciais inválidas')
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.record('LOGIN_BLOCKED', {
        userId: user.id,
        email: normalizedEmail,
        context,
      })
      throw new UnauthorizedException('Credenciais inválidas')
    }

    if (!allowedRoles.includes(user.role)) {
      await this.audit.record('LOGIN_ROLE_DENIED', {
        userId: user.id,
        email: normalizedEmail,
        context,
      })
      throw new ForbiddenException('Perfil sem acesso administrativo')
    }

    const passwordOk = await argon2.verify(user.passwordHash, password)
    if (!passwordOk) {
      // PostgreSQL serializes updates to the same row and rechecks the WHERE
      // condition after waiting. Count and lock must change in one statement.
      const now = new Date()
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000)
      const updated = await this.prisma.$queryRaw<Array<{ lockedUntil: Date | null }>>`
        UPDATE "User"
        SET
          "failedLoginAttempts" = CASE
            WHEN "failedLoginAttempts" + 1 >= ${MAX_FAILED_ATTEMPTS} THEN 0
            ELSE "failedLoginAttempts" + 1
          END,
          "lockedUntil" = CASE
            WHEN "failedLoginAttempts" + 1 >= ${MAX_FAILED_ATTEMPTS} THEN ${lockedUntil}
            ELSE NULL
          END,
          "updatedAt" = ${now}
        WHERE "id" = ${user.id}
          AND "isActive" = true
          AND "passwordHash" = ${user.passwordHash}
          AND "role" = ${user.role}::"UserRole"
          AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
        RETURNING "lockedUntil"
      `
      const event = !updated.length ? 'LOGIN_BLOCKED'
        : updated[0].lockedUntil ? 'LOGIN_LOCKED' : 'LOGIN_FAILED'
      await this.audit.record(event, {
        userId: user.id,
        email: normalizedEmail,
        context,
      })
      throw new UnauthorizedException('Credenciais inválidas')
    }

    const reset = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        isActive: true,
        passwordHash: user.passwordHash,
        role: user.role,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })
    if (reset.count !== 1) {
      await this.audit.record('LOGIN_BLOCKED', {
        userId: user.id, email: normalizedEmail, context,
      })
      throw new UnauthorizedException('Credenciais inválidas')
    }

    if ((user.role === UserRole.ADMIN || user.role === UserRole.CREATOR) && !user.mfaEnabled) {
      const challengeToken = await this.signMfaChallenge(user.id, 'setup', user.authVersion)
      await this.audit.record('MFA_SETUP_REQUIRED', {
        userId: user.id,
        email: user.email,
        context,
      })
      return { status: 'mfa_setup_required' as const, challengeToken }
    }

    if (user.mfaEnabled) {
      const challengeToken = await this.signMfaChallenge(user.id, 'verify', user.authVersion)
      await this.audit.record('MFA_REQUIRED', {
        userId: user.id,
        email: user.email,
        context,
      })
      return { status: 'mfa_required' as const, challengeToken }
    }

    return this.completeLogin(user.id, user.email, user.role, context, user.authVersion)
  }

  async beginMfaSetup(challengeToken: string) {
    const payload = await this.verifyMfaChallenge(challengeToken, 'setup')
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isActive: true, role: true, mfaEnabled: true },
    })

    // A setup challenge is a one-time enrollment capability, not permission to
    // replace MFA after the first enrollment. MfaService enforces the same
    // predicate atomically if a concurrent enrollment completes here.
    if (!user?.isActive || user.mfaEnabled ||
      (user.role !== UserRole.ADMIN && user.role !== UserRole.CREATOR)) {
      throw new UnauthorizedException('Desafio inválido')
    }

    return this.mfa.beginSetup(user.id, user.email)
  }

  async confirmMfaSetup(
    challengeToken: string,
    code: string,
    context: RequestContext,
  ) {
    const payload = await this.verifyMfaChallenge(challengeToken, 'setup')
    const recoveryCodes = await this.mfa.confirmSetup(payload.sub, code)
    const user = await this.requireActiveUser(payload.sub)
    const authenticated = await this.completeLogin(
      user.id,
      user.email,
      user.role,
      context,
      payload.authVersion ?? 0,
    )

    await this.audit.record('MFA_ENROLLED', {
      userId: user.id,
      email: user.email,
      context,
    })

    return { ...authenticated, recoveryCodes }
  }

  async verifyMfa(
    challengeToken: string,
    code: string,
    context: RequestContext,
  ) {
    const payload = await this.verifyMfaChallenge(challengeToken, 'verify')
    const user = await this.requireActiveUser(payload.sub)
    const valid = await this.mfa.verify(user.id, code)

    if (!valid) {
      await this.audit.record('MFA_FAILED', {
        userId: user.id,
        email: user.email,
        context,
      })
      throw new UnauthorizedException('Código inválido')
    }

    const authenticated = await this.completeLogin(
      user.id,
      user.email,
      user.role,
      context,
      payload.authVersion ?? 0,
    )
    await this.audit.record('MFA_SUCCESS', {
      userId: user.id,
      email: user.email,
      context,
    })
    return authenticated
  }

  async refresh(rawRefreshToken: string, context: RequestContext) {
    let payload: RefreshTokenPayload
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.refreshSecret(),
      })
    } catch {
      throw new UnauthorizedException('Sessão inválida')
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Sessão inválida')
    }

    const user = await this.requireActiveUser(payload.sub)
    if ((payload.authVersion ?? 0) !== user.authVersion) throw new UnauthorizedException('Sessão inválida')
    await this.sessions.verify(payload.sid, rawRefreshToken, user.id)

    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      payload.sid,
      user.authVersion,
    )
    await this.sessions.rotate(payload.sid, tokens.refreshToken)
    await this.audit.record('SESSION_REFRESHED', {
      userId: user.id,
      email: user.email,
      context,
    })

    return {
      status: 'authenticated' as const,
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role },
    }
  }

  async logout(userId: string, sessionId: string, context: RequestContext) {
    await this.sessions.revoke(sessionId, userId)
    await this.audit.record('LOGOUT', { userId, context })
  }

  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 16 || newPassword.length > 128 || currentPassword.length > 128) throw new BadRequestException('Senha inválida')
    const changed = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
      const user = await tx.user.findUnique({ where: { id: userId } })
      const now = new Date()
      if (!user?.isActive || user.role === 'CLIENT' || (user.lockedUntil && user.lockedUntil > now)) throw new UnauthorizedException('Não foi possível alterar a senha')
      await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${sessionId} AND "userId" = ${userId} FOR UPDATE`
      const session = await tx.authSession.findFirst({ where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } } })
      if (!session) throw new UnauthorizedException('Sessão inválida')
      if (!(await argon2.verify(user.passwordHash, currentPassword))) {
        const attempts = (user.lockedUntil ? 0 : user.failedLoginAttempts) + 1
        await tx.user.update({ where: { id: userId }, data: { failedLoginAttempts: attempts >= 5 ? 0 : attempts,
          lockedUntil: attempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null } })
        await tx.authAuditEvent.create({ data: { userId, eventType: 'PASSWORD_CHANGE_FAILED', metadata: { locked: attempts >= 5 } } })
        return false
      }
      if (currentPassword === newPassword) throw new BadRequestException('A nova senha deve ser diferente da atual')
      await tx.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(newPassword),
        authVersion: { increment: 1 }, refreshTokenHash: null, failedLoginAttempts: 0, lockedUntil: null } })
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })
      await tx.authAuditEvent.create({ data: { userId, eventType: 'PASSWORD_CHANGED', metadata: { allSessionsRevoked: true } } })
      return true
    })
    if (!changed) throw new UnauthorizedException('Não foi possível alterar a senha. Confira a senha atual ou tente mais tarde.')
    return { passwordChanged: true, allSessionsRevoked: true }
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    context: RequestContext,
  ) {
    await this.sessions.revoke(sessionId, userId)
    await this.audit.record('SESSION_REVOKED', {
      userId,
      context,
      metadata: { sessionId },
    })
  }

  async revokeAllSessions(userId: string, context: RequestContext) {
    await this.sessions.revokeAll(userId)
    await this.audit.record('ALL_SESSIONS_REVOKED', { userId, context })
  }

  listSessions(userId: string, currentSessionId: string) {
    return this.sessions.list(userId, currentSessionId)
  }

  async verifyAccessToken(token: string) {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.accessSecret(),
      })
      if (payload.type !== 'access') {
        throw new UnauthorizedException('Token inválido')
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, isActive: true,
          companyManaged: true, authVersion: true },
      })
      if (!user?.isActive || (payload.authVersion ?? 0) !== (user.authVersion ?? 0)) {
        throw new UnauthorizedException('Token inválido')
      }

      if (!(await this.sessions.isActive(payload.sid, user.id))) {
        throw new UnauthorizedException('Sessão revogada')
      }

      const persistedSession = await this.prisma.authSession.findUnique({
        where: { id: payload.sid }, select: { companyId: true },
      })
      if (!persistedSession) throw new UnauthorizedException('Sessão inválida')

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        sessionId: payload.sid,
        companyId: persistedSession.companyId,
        // The database marks every membership insertion and forbids resetting this
        // marker, including after deletion/revocation. Legacy verification therefore
        // does not require read access to tenant membership tables.
        requiresCompanyScope: user.companyManaged,
      }
    } catch {
      throw new UnauthorizedException('Token inválido')
    }
  }

  private async completeLogin(
    userId: string,
    email: string,
    role: UserRole,
    context: RequestContext,
    authVersion = 0,
  ) {
    const sessionId = randomUUID()
    const tokens = await this.issueTokens(userId, email, role, sessionId, authVersion)
    await this.sessions.create(sessionId, userId, tokens.refreshToken, context)
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), refreshTokenHash: null },
    })
    await this.audit.record('LOGIN_SUCCESS', { userId, email, context })

    return {
      status: 'authenticated' as const,
      ...tokens,
      user: { id: userId, email, role },
    }
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    sessionId: string,
    authVersion = 0,
  ) {
    const accessPayload: AccessTokenPayload = {
      authVersion,
      sub: userId,
      email,
      role,
      sid: sessionId,
      type: 'access',
    }
    const refreshPayload: RefreshTokenPayload = {
      authVersion,
      sub: userId,
      sid: sessionId,
      type: 'refresh',
      jti: randomUUID(),
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.accessSecret(),
        expiresIn: '10m',
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.refreshSecret(),
        expiresIn: '7d',
      }),
    ])

    return { accessToken, refreshToken }
  }

  private async signMfaChallenge(
    userId: string,
    mode: MfaChallengePayload['mode'],
    authVersion = 0,
  ) {
    const payload: MfaChallengePayload = {
      authVersion,
      sub: userId,
      mode,
      type: 'mfa_challenge',
    }
    return this.jwt.signAsync(payload, {
      secret: this.mfaChallengeSecret(),
      expiresIn: '5m',
    })
  }

  private async verifyMfaChallenge(
    token: string,
    expectedMode: MfaChallengePayload['mode'],
  ) {
    try {
      const payload = await this.jwt.verifyAsync<MfaChallengePayload>(token, {
        secret: this.mfaChallengeSecret(),
      })
      if (payload.type !== 'mfa_challenge' || payload.mode !== expectedMode) {
        throw new UnauthorizedException('Desafio inválido')
      }
      const user = await this.requireActiveUser(payload.sub)
      if ((payload.authVersion ?? 0) !== (user.authVersion ?? 0)) throw new UnauthorizedException('Desafio inválido')
      return payload
    } catch {
      throw new UnauthorizedException('Desafio inválido ou expirado')
    }
  }

  private async requireActiveUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user?.isActive) {
      throw new UnauthorizedException('Usuário inválido')
    }
    return user
  }

  private accessSecret() {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET')
  }

  private refreshSecret() {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET')
  }

  private mfaChallengeSecret() {
    return this.config.getOrThrow<string>('JWT_MFA_SECRET')
  }
}
