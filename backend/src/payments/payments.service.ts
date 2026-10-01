import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  publicConfig() {
    const configured = this.isConfigured()
    return {
      provider: 'MERCADO_PAGO',
      configured,
      methods: {
        PIX: configured,
        CARD: configured,
      },
    }
  }

  isConfigured() {
    return Boolean(
      this.config.get<string>('MERCADO_PAGO_ACCESS_TOKEN')?.trim() &&
      this.config.get<string>('MERCADO_PAGO_WEBHOOK_SECRET')?.trim(),
    )
  }
}
