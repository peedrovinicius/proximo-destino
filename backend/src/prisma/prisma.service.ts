import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  encryptedDocumentFields,
  sensitiveDataConfigured,
} from '../security/sensitive-data'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect()
    await this.backfillSensitiveDocuments()
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
