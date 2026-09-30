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
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.types'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async loginAdmin(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas')
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Credenciais inválidas')
    }

    const allowedRoles: UserRole[] = [
      UserRole.ADMIN,
      UserRole.AGENT,
      UserRole.FINANCE,
    ]
    if (!allowedRoles.includes(user.role)) {
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

      throw new UnauthorizedException('Credenciais inválidas')
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role)
    const refreshTokenHash = await argon2.hash(tokens.refreshToken)

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshTokenHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    })

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    }
  }

  async refresh(rawRefreshToken: string) {
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

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    })

    if (!user?.isActive || !user.refreshTokenHash) {
      throw new UnauthorizedException('Sessão inválida')
    }

    const valid = await argon2.verify(user.refreshTokenHash, rawRefreshToken)
    if (!valid) {
      await this.revoke(user.id)
      throw new UnauthorizedException('Sessão inválida')
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role)
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: await argon2.hash(tokens.refreshToken) },
    })

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    }
  }

  async revoke(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { refreshTokenHash: null },
    })
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

      return {
        id: user.id,
        email: user.email,
        role: user.role,
      }
    } catch {
      throw new UnauthorizedException('Token inválido')
    }
  }

  private async issueTokens(userId: string, email: string, role: UserRole) {
    const accessPayload: AccessTokenPayload = {
      sub: userId,
      email,
      role,
      type: 'access',
    }
    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
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

  private accessSecret() {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET')
  }

  private refreshSecret() {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET')
  }
}
