import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { PrismaService } from './prisma/prisma.service'

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name)
  private recoveryMetadataLogged = false

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
      const metadata = await this.prisma.$queryRawUnsafe<
        Array<{
          projectId: string | null
          branchId: string | null
          endpointId: string | null
          databaseName: string
        }>
      >(`
        SELECT
          current_setting('neon.project_id', true) AS "projectId",
          current_setting('neon.branch_id', true) AS "branchId",
          current_setting('neon.endpoint_id', true) AS "endpointId",
          current_database() AS "databaseName"
      `)

      if (!this.recoveryMetadataLogged) {
        const item = metadata[0]
        this.logger.log(
          JSON.stringify({
            event: 'DATABASE_RECOVERY_METADATA',
            projectId: item?.projectId ?? null,
            branchId: item?.branchId ?? null,
            endpointId: item?.endpointId ?? null,
            databaseName: item?.databaseName ?? null,
          }),
        )
        this.recoveryMetadataLogged = true
      }

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
