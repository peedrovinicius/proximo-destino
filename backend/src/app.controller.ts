import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { PrismaService } from './prisma/prisma.service'

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @SkipThrottle()
  health() {
    return {
      status: 'ok',
      service: 'proximo-destino-api',
      version: '0.4.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }
  }

  @Get('readiness')
  @SkipThrottle()
  async readiness() {
    const startedAt = process.hrtime.bigint()

    try {
      await this.prisma.$queryRawUnsafe('SELECT 1')
      const databaseLatencyMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000

      return {
        status: 'ready',
        service: 'proximo-destino-api',
        database: 'ok',
        databaseLatencyMs: Number(databaseLatencyMs.toFixed(1)),
        version: '0.4.0',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      }
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível')
    }
  }
}
