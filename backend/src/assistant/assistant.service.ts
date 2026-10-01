import { Injectable } from '@nestjs/common'
import { TripsService } from '../trips/trips.service'
import { AskAssistantDto } from './dto/assistant.dto'

type PublicTrip = Awaited<ReturnType<TripsService['searchPublic']>>[number]

@Injectable()
export class AssistantService {
  constructor(private readonly trips: TripsService) {}

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  }

  private money(cents: number | null) {
    if (cents == null) return 'sob consulta'
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(cents / 100)
  }

  private date(value: Date) {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(value)
  }

  private tripLine(trip: PublicTrip) {
    return `${trip.destination}, saindo de ${trip.origin}, em ${this.date(trip.departureDate)}, por ${this.money(trip.priceCents)} por pessoa`
  }

  private extractBudget(message: string) {
    const normalized = this.normalize(message)
    const mil = normalized.match(/(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s*mil\b/)
    if (mil) return Math.round(Number(mil[1].replace(',', '.')) * 1000 * 100)

    const currency = normalized.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/)
    if (currency) {
      const value = Number(currency[1].replace(/\./g, '').replace(',', '.'))
      return Number.isFinite(value) ? Math.round(value * 100) : null
    }

    return null
  }

  private destinationTags(destination: string) {
    const value = this.normalize(destination)
    const tags: string[] = []

    const beach = [
      'fortaleza',
      'maceio',
      'recife',
      'rio de janeiro',
    ]
    const international = [
      'buenos aires',
      'lisboa',
    ]

    if (beach.some((item) => value.includes(item))) tags.push('praia')
    if (international.some((item) => value.includes(item))) tags.push('internacional')
    if (value.includes('gramado')) tags.push('serra', 'frio', 'romantica')

    return tags
  }

  private findMatches(message: string, catalog: PublicTrip[]) {
    const normalized = this.normalize(message)
    const budget = this.extractBudget(message)

    let matches = [...catalog]

    if (budget != null) {
      matches = matches.filter(
        (trip) => trip.priceCents != null && trip.priceCents <= budget,
      )
    }

    const tagRequests = ['praia', 'internacional', 'serra', 'frio', 'romantica']
      .filter((tag) => normalized.includes(tag))

    if (tagRequests.length) {
      matches = matches.filter((trip) => {
        const tags = this.destinationTags(trip.destination)
        return tagRequests.some((tag) => tags.includes(tag))
      })
    }

    const directMatches = catalog.filter((trip) => {
      const haystack = this.normalize(
        [trip.title, trip.origin, trip.destination, trip.summary ?? ''].join(' '),
      )
      return normalized
        .split(/\s+/)
        .filter((token) => token.length >= 4)
        .some((token) => haystack.includes(token))
    })

    if (
      directMatches.length &&
      !tagRequests.length &&
      budget == null &&
      !/(disponiveis|disponivel|barata|economica|preco|valor|opcoes|viagens)/.test(normalized)
    ) {
      matches = directMatches
    }

    return matches
  }

  async ask(data: AskAssistantDto) {
    const catalog = await this.trips.searchPublic()
    const message = data.message.trim()
    const normalized = this.normalize(message)

    if (!catalog.length) {
      return {
        answer:
          'No momento não há viagens publicadas no catálogo. Posso encaminhar você para o atendimento da agência pelo WhatsApp.',
        catalogUpdatedAt: new Date().toISOString(),
      }
    }

    if (/(cancel|reembols|pagamento|pix|boleto|cartao|documento|cpf|passaporte)/.test(normalized)) {
      return {
        answer:
          'Esse assunto precisa de confirmação da equipe da Próximo Destino. Para evitar informação incorreta, use o WhatsApp da agência para receber a orientação do seu caso.',
        catalogUpdatedAt: new Date().toISOString(),
      }
    }

    if (/(mais barata|mais barato|economica|economico|menor preco)/.test(normalized)) {
      const priced = catalog
        .filter((trip) => trip.priceCents != null)
        .sort((a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity))

      if (!priced.length) {
        return {
          answer:
            'As viagens disponíveis estão com valor sob consulta. Posso mostrar os destinos publicados ou você pode falar com a agência pelo WhatsApp.',
          catalogUpdatedAt: new Date().toISOString(),
        }
      }

      return {
        answer: `A opção com menor valor publicada agora é ${this.tripLine(priced[0])}.`,
        catalogUpdatedAt: new Date().toISOString(),
      }
    }

    const matches = this.findMatches(message, catalog)

    if (
      /(quais|mostrar|mostre|disponiveis|disponivel|opcoes|viagens|destinos)/.test(normalized)
    ) {
      const items = (matches.length ? matches : catalog).slice(0, 6)
      return {
        answer: `Estas são as opções publicadas agora:\n${items
          .map((trip) => `• ${this.tripLine(trip)}`)
          .join('\n')}`,
        catalogUpdatedAt: new Date().toISOString(),
      }
    }

    if (matches.length) {
      const items = matches.slice(0, 4)
      return {
        answer:
          items.length === 1
            ? `Encontrei uma opção que combina com o que você pediu: ${this.tripLine(items[0])}.`
            : `Encontrei estas opções que combinam com o que você pediu:\n${items
                .map((trip) => `• ${this.tripLine(trip)}`)
                .join('\n')}`,
        catalogUpdatedAt: new Date().toISOString(),
      }
    }

    return {
      answer:
        'Não encontrei uma viagem publicada que corresponda exatamente ao seu pedido. Posso mostrar as opções disponíveis ou você pode falar com a equipe pelo WhatsApp para montar outra viagem.',
      catalogUpdatedAt: new Date().toISOString(),
    }
  }
}
