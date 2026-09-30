import {
  ForbiddenException,
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

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

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

    const allowedRoles: UserRole[] = [
      UserRole.ADMIN,
      UserRole.AGENT,
      UserRole.FINANCE,
    ]
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
      const attempts = user.failedLoginAttempts + 1
      const lockedUntil =
        attempts >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCK_MINUTES * 60_000)
          : null

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lockedUntil ? 0 : attempts,
          lockedUntil,
        },
      })
      await this.audit.record(lockedUntil ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', {
        userId: user.id,
        email: normalizedEmail,
        context,
      })
      throw new UnauthorizedException('Credenciais inválidas')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })

    if (user.role === UserRole.ADMIN && !user.mfaEnabled) {
      const challengeToken = await this.signMfaChallenge(user.id, 'setup')
      await this.audit.record('MFA_SETUP_REQUIRED', {
        userId: user.id,
        email: user.email,
        context,
      })
      return { status: 'mfa_setup_required' as const, challengeToken }
    }

    if (user.mfaEnabled) {
      const challengeToken = await this.signMfaChallenge(user.id, 'verify')
      await this.audit.record('MFA_REQUIRED', {
        userId: user.id,
        email: user.email,
        context,
      })
      return { status: 'mfa_required' as const, challengeToken }
    }

    return this.completeLogin(user.id, user.email, user.role, context)
  }

  async beginMfaSetup(challengeToken: string) {
    const payload = await this.verifyMfaChallenge(challengeToken, 'setup')
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isActive: true, role: true },
    })

    if (!user?.isActive || user.role !== UserRole.ADMIN) {
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
    await this.sessions.verify(payload.sid, rawRefreshToken, user.id)

    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      payload.sid,
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
        select: { id: true, email: true, role: true, isActive: true },
      })
      if (!user?.isActive) {
        throw new UnauthorizedException('Token inválido')
      }

      if (!(await this.sessions.isActive(payload.sid, user.id))) {
        throw new UnauthorizedException('Sessão revogada')
      }

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        sessionId: payload.sid,
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
  ) {
    const sessionId = randomUUID()
    const tokens = await this.issueTokens(userId, email, role, sessionId)
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
  ) {
    const accessPayload: AccessTokenPayload = {
      sub: userId,
      email,
      role,
      sid: sessionId,
      type: 'access',
    }
    const refreshPayload: RefreshTokenPayload = {
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
  ) {
    const payload: MfaChallengePayload = {
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
