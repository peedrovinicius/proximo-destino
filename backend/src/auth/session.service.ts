import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'
import { createHmac } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import type { RequestContext } from './auth.types'

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(
    sessionId: string,
    userId: string,
    refreshToken: string,
    context: RequestContext,
  ) {
    return this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: await argon2.hash(refreshToken),
        userAgentHash: context.userAgent ? this.hash(context.userAgent) : null,
        ipHash: context.ip ? this.hash(context.ip) : null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
  }

  async verify(sessionId: string, refreshToken: string, userId: string) {
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    })

    if (!session || !(await argon2.verify(session.refreshTokenHash, refreshToken))) {
      throw new UnauthorizedException('Sessão inválida')
    }

    return session
  }

  async isActive(sessionId: string, userId: string) {
    const count = await this.prisma.authSession.count({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    })
    return count === 1
  }

  async rotate(sessionId: string, refreshToken: string) {
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: await argon2.hash(refreshToken),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
  }

  revoke(sessionId: string, userId: string) {
    return this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  revokeAll(userId: string) {
    return this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  async list(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.authSession.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgentHash: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    })

    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
      active: session.revokedAt === null,
    }))
  }

  private hash(value: string) {
    const key = this.config.getOrThrow<string>('AUDIT_HASH_KEY')
    return createHmac('sha256', key).update(value).digest('hex')
  }
}
