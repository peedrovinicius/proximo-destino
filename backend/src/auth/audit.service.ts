import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import type { RequestContext } from './auth.types'

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async record(
    eventType: string,
    input: {
      userId?: string
      email?: string
      context?: RequestContext
      metadata?: Record<string, string | number | boolean | null>
    } = {},
  ) {
    await this.prisma.authAuditEvent.create({
      data: {
        eventType,
        userId: input.userId,
        emailHash: input.email ? this.hash(input.email.trim().toLowerCase()) : null,
        ipHash: input.context?.ip ? this.hash(input.context.ip) : null,
        userAgentHash: input.context?.userAgent ? this.hash(input.context.userAgent) : null,
        metadata: input.metadata,
      },
    })
  }

  private hash(value: string) {
    const key = this.config.getOrThrow<string>('AUDIT_HASH_KEY')
    return createHmac('sha256', key).update(value).digest('hex')
  }
}
