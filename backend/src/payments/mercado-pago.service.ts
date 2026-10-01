import {
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MercadoPagoConfig, Order } from 'mercadopago'

export class MercadoPagoService {
  constructor(private readonly config: ConfigService) {}

  isConfigured() {
    return Boolean(
      this.config.get<string>('MERCADO_PAGO_ACCESS_TOKEN')?.trim(),
    )
  }

  private client() {
    const accessToken =
      this.config.get<string>('MERCADO_PAGO_ACCESS_TOKEN')?.trim()

    if (!accessToken) {
      throw new ServiceUnavailableException(
        'Pagamento online ainda não está configurado',
      )
    }

    return new MercadoPagoConfig({
      accessToken,
      options: { timeout: 10_000 },
    })
  }

  async createCheckout(input: {
    idempotencyKey: string
    externalReference: string
    totalCents: number
    passengerCount: number
    unitPriceCents: number
    title: string
    payerEmail: string
  }) {
    const order = new Order(this.client())
    const total = (input.totalCents / 100).toFixed(2)
    const unit = (input.unitPriceCents / 100).toFixed(2)

    const response = await order.create({
      body: {
        type: 'online',
        processing_mode: 'manual',
        total_amount: total,
        external_reference: input.externalReference,
        payer: {
          email: input.payerEmail,
        },
        items: [
          {
            title: input.title.slice(0, 120),
            unit_price: unit,
            quantity: input.passengerCount,
            unit_measure: 'unit',
            total_amount: total,
          },
        ],
      },
      requestOptions: {
        idempotencyKey: input.idempotencyKey,
      },
    })

    if (!response.checkout_url) {
      throw new ServiceUnavailableException(
        'O checkout não pôde ser iniciado',
      )
    }

    return {
      provider: 'MERCADO_PAGO' as const,
      kind: 'CHECKOUT' as const,
      checkoutUrl: response.checkout_url,
      providerOrderId: response.id ?? null,
      status: response.status ?? 'created',
    }
  }
}
