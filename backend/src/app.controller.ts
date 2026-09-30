import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { PrismaService } from './prisma/prisma.service'
import { RELEASE } from './release'

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @SkipThrottle()
  health() {
    return {
      status: 'ok',
      service: RELEASE.service,
      version: RELEASE.version,
    }
  }

  @Get('readiness')
  @SkipThrottle()
  async readiness() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1')
      return {
        status: 'ready',
        service: RELEASE.service,
        database: 'ok',
        version: RELEASE.version,
      }
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível')
    }
  }

  @Get('system/release')
  @SkipThrottle()
  release() {
    return RELEASE
  }
}
