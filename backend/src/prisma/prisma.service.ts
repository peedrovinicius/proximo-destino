import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  encryptedDocumentFields,
  sensitiveDataConfigured,
} from '../security/sensitive-data'
import { readDatabaseSecurityState, restrictedAuditWriter } from '../security/database-privileges'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly securityLogger = new Logger('DatabaseSecurity')

  async onModuleInit() {
    await this.$connect()
    await this.reportDatabaseSecurity()
    await this.backfillSensitiveDocuments()
  }

  private async reportDatabaseSecurity() {
    try {
      const state = await readDatabaseSecurityState(this)
      const restricted = restrictedAuditWriter(state)
      const payload = JSON.stringify({ event: 'DATABASE_SECURITY_CHECK', restrictedAuditWriter: restricted, ...state })
      if (restricted) this.securityLogger.log(payload)
      else this.securityLogger.warn(payload)
    } catch {
      // A failed diagnostic must not prevent startup or leak a database error.
      this.securityLogger.warn(JSON.stringify({ event: 'DATABASE_SECURITY_CHECK_UNAVAILABLE' }))
    }
  }

  private async backfillSensitiveDocuments() {
    if (!sensitiveDataConfigured()) return

    const clients = await this.client.findMany({
      where: {
        document: { not: null },
        documentEncrypted: null,
      },
      select: { id: true, document: true },
      take: 500,
    })

    for (const client of clients) {
      await this.client.update({
        where: { id: client.id },
        data: encryptedDocumentFields(client.document),
      })
    }

    const companions = await this.companion.findMany({
      where: {
        document: { not: null },
        documentEncrypted: null,
      },
      select: { id: true, document: true },
      take: 1_000,
    })

    for (const companion of companions) {
      await this.companion.update({
        where: { id: companion.id },
        data: encryptedDocumentFields(companion.document),
      })
    }

    const passengers = await this.reservationPassenger.findMany({
      where: {
        document: { not: null },
        documentEncrypted: null,
      },
      select: { id: true, document: true },
      take: 2_000,
    })

    for (const passenger of passengers) {
      await this.reservationPassenger.update({
        where: { id: passenger.id },
        data: encryptedDocumentFields(passenger.document),
      })
    }
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
