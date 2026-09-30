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
    }
  }

  @Get('readiness')
  @SkipThrottle()
  async readiness() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1')
      return {
        status: 'ready',
        service: 'proximo-destino-api',
        database: 'ok',
        version: '0.4.0',
      }
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível')
    }
  }
}
