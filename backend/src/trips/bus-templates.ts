import { BadRequestException } from '@nestjs/common'

export const SEAT_LAYOUTS = ['TWO_BY_TWO', 'TWO_BY_ONE'] as const
export type SeatLayout = (typeof SEAT_LAYOUTS)[number]

export const BUS_TEMPLATES = [
  {
    key: 'MICRO_20',
    label: 'Micro-ônibus · 20 lugares',
    shortLabel: 'Micro 20',
    capacity: 20,
    seatLayout: 'TWO_BY_TWO',
    description: 'Configuração compacta 2+2 para grupos menores.',
  },
  {
    key: 'MINI_28',
    label: 'Mini ônibus · 28 lugares',
    shortLabel: 'Mini 28',
    capacity: 28,
    seatLayout: 'TWO_BY_TWO',
    description: 'Configuração 2+2 para grupos de pequeno porte.',
  },
  {
    key: 'MIDI_32',
    label: 'Midi ônibus · 32 lugares',
    shortLabel: 'Midi 32',
    capacity: 32,
    seatLayout: 'TWO_BY_TWO',
    description: 'Configuração intermediária 2+2.',
  },
  {
    key: 'CONVENCIONAL_44',
    label: 'Convencional · 44 lugares',
    shortLabel: 'Convencional 44',
    capacity: 44,
    seatLayout: 'TWO_BY_TWO',
    description: 'Ônibus rodoviário convencional em configuração 2+2.',
  },
  {
    key: 'CONVENCIONAL_46',
    label: 'Convencional · 46 lugares',
    shortLabel: 'Convencional 46',
    capacity: 46,
    seatLayout: 'TWO_BY_TWO',
    description: 'Ônibus rodoviário convencional em configuração 2+2.',
  },
  {
    key: 'EXECUTIVO_46',
    label: 'Executivo · 46 lugares',
    shortLabel: 'Executivo 46',
    capacity: 46,
    seatLayout: 'TWO_BY_TWO',
    description: 'Classe executiva com disposição 2+2.',
  },
  {
    key: 'SEMI_LEITO_42',
    label: 'Semi-leito · 42 lugares',
    shortLabel: 'Semi-leito 42',
    capacity: 42,
    seatLayout: 'TWO_BY_TWO',
    description: 'Configuração semi-leito 2+2 com menor lotação.',
  },
  {
    key: 'LEITO_34',
    label: 'Leito · 34 lugares',
    shortLabel: 'Leito 34',
    capacity: 34,
    seatLayout: 'TWO_BY_ONE',
    description: 'Configuração leito 2+1 com corredor mais amplo.',
  },
  {
    key: 'LEITO_CAMA_28',
    label: 'Leito-cama · 28 lugares',
    shortLabel: 'Leito-cama 28',
    capacity: 28,
    seatLayout: 'TWO_BY_ONE',
    description: 'Configuração leito-cama 2+1 com menor lotação.',
  },
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  shortLabel: string
  capacity: number
  seatLayout: SeatLayout
  description: string
}>

export type BusTemplateKey = (typeof BUS_TEMPLATES)[number]['key'] | 'CUSTOM'

export function isSeatLayout(value: unknown): value is SeatLayout {
  return typeof value === 'string' && SEAT_LAYOUTS.includes(value as SeatLayout)
}

export function findBusTemplate(key: string | null | undefined) {
  return BUS_TEMPLATES.find((template) => template.key === key) ?? null
}

export function listBusTemplates() {
  return [
    ...BUS_TEMPLATES,
    {
      key: 'CUSTOM',
      label: 'Personalizado',
      shortLabel: 'Personalizado',
      capacity: null,
      seatLayout: null,
      description: 'Defina manualmente a lotação e a disposição 2+2 ou 2+1.',
    },
  ]
}

export function resolveBusTemplate(
  key: string,
  capacity?: number | null,
  seatLayout?: string | null,
) {
  if (key === 'CUSTOM') {
    if (
      capacity === null ||
      capacity === undefined ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 80
    ) {
      throw new BadRequestException(
        'O modelo personalizado exige lotação entre 1 e 80 lugares',
      )
    }

    const layout = seatLayout ?? 'TWO_BY_TWO'
    if (!isSeatLayout(layout)) {
      throw new BadRequestException('Disposição de assentos inválida')
    }

    return {
      busTemplate: 'CUSTOM',
      capacity,
      seatLayout: layout,
      busLabel: 'Personalizado',
    }
  }

  const template = findBusTemplate(key)
  if (!template) {
    throw new BadRequestException('Modelo de ônibus inválido')
  }

  return {
    busTemplate: template.key,
    capacity: template.capacity,
    seatLayout: template.seatLayout,
    busLabel: template.shortLabel,
  }
}

export function describeBus(
  busTemplate: string | null | undefined,
  capacity: number | null | undefined,
) {
  if (busTemplate === 'CUSTOM') {
    return capacity ? `Personalizado · ${capacity} lugares` : 'Personalizado'
  }

  const template = findBusTemplate(busTemplate)
  if (template) return template.shortLabel

  return capacity ? `Veículo · ${capacity} lugares` : null
}
