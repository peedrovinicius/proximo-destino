import { BadRequestException } from '@nestjs/common'

export const SEAT_LAYOUTS = ['TWO_BY_TWO', 'TWO_BY_ONE'] as const
export type SeatLayout = (typeof SEAT_LAYOUTS)[number]

export const VEHICLE_FEATURE_TYPES = ['RESTROOM', 'DOOR', 'STAIRS'] as const
export type VehicleFeatureType = (typeof VEHICLE_FEATURE_TYPES)[number]

export const VEHICLE_FEATURE_POSITIONS = ['FRONT', 'MIDDLE', 'REAR'] as const
export type VehicleFeaturePosition = (typeof VEHICLE_FEATURE_POSITIONS)[number]

export const VEHICLE_FEATURE_SIDES = ['LEFT', 'CENTER', 'RIGHT'] as const
export type VehicleFeatureSide = (typeof VEHICLE_FEATURE_SIDES)[number]

export type VehicleFeature = {
  type: VehicleFeatureType
  deck: 1 | 2
  position: VehicleFeaturePosition
  side: VehicleFeatureSide
}

type BusTemplate = {
  key: string
  label: string
  shortLabel: string
  capacity: number
  seatLayout: SeatLayout
  deckCount: 1 | 2
  lowerDeckCapacity: number | null
  description: string
  defaultFeatures: VehicleFeature[]
}

export const BUS_TEMPLATES = [
  {
    key: 'MICRO_20',
    label: 'Micro-ônibus · 20 lugares',
    shortLabel: 'Micro 20',
    capacity: 20,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Configuração compacta 2+2 para grupos menores.',
    defaultFeatures: [],
  },
  {
    key: 'MINI_28',
    label: 'Mini ônibus · 28 lugares',
    shortLabel: 'Mini 28',
    capacity: 28,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Configuração 2+2 para grupos de pequeno porte.',
    defaultFeatures: [],
  },
  {
    key: 'MIDI_32',
    label: 'Midi ônibus · 32 lugares',
    shortLabel: 'Midi 32',
    capacity: 32,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Configuração intermediária 2+2.',
    defaultFeatures: [],
  },
  {
    key: 'CONVENCIONAL_44',
    label: 'Convencional · 44 lugares',
    shortLabel: 'Convencional 44',
    capacity: 44,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Ônibus rodoviário convencional em configuração 2+2.',
    defaultFeatures: [],
  },
  {
    key: 'CONVENCIONAL_46',
    label: 'Convencional · 46 lugares',
    shortLabel: 'Convencional 46',
    capacity: 46,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Ônibus rodoviário convencional em configuração 2+2.',
    defaultFeatures: [],
  },
  {
    key: 'EXECUTIVO_46',
    label: 'Executivo · 46 lugares',
    shortLabel: 'Executivo 46',
    capacity: 46,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Classe executiva com disposição 2+2.',
    defaultFeatures: [],
  },
  {
    key: 'SEMI_LEITO_42',
    label: 'Semi-leito · 42 lugares',
    shortLabel: 'Semi-leito 42',
    capacity: 42,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Configuração semi-leito 2+2 com menor lotação.',
    defaultFeatures: [],
  },
  {
    key: 'LEITO_34',
    label: 'Leito · 34 lugares',
    shortLabel: 'Leito 34',
    capacity: 34,
    seatLayout: 'TWO_BY_ONE',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Configuração leito 2+1 com corredor mais amplo.',
    defaultFeatures: [],
  },
  {
    key: 'LEITO_CAMA_28',
    label: 'Leito-cama · 28 lugares',
    shortLabel: 'Leito-cama 28',
    capacity: 28,
    seatLayout: 'TWO_BY_ONE',
    deckCount: 1,
    lowerDeckCapacity: null,
    description: 'Configuração leito-cama 2+1 com menor lotação.',
    defaultFeatures: [],
  },
  {
    key: 'DOUBLE_DECKER_60',
    label: 'Double Decker · 60 lugares',
    shortLabel: 'Double Decker 60',
    capacity: 60,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 2,
    lowerDeckCapacity: 16,
    description: 'Dois andares, 16 lugares no piso inferior e 44 no superior.',
    defaultFeatures: [
      { type: 'DOOR', deck: 1, position: 'FRONT', side: 'RIGHT' },
      { type: 'STAIRS', deck: 1, position: 'MIDDLE', side: 'CENTER' },
      { type: 'RESTROOM', deck: 1, position: 'REAR', side: 'RIGHT' },
    ],
  },
  {
    key: 'DOUBLE_DECKER_64',
    label: 'Double Decker · 64 lugares',
    shortLabel: 'Double Decker 64',
    capacity: 64,
    seatLayout: 'TWO_BY_TWO',
    deckCount: 2,
    lowerDeckCapacity: 16,
    description: 'Dois andares, 16 lugares no piso inferior e 48 no superior.',
    defaultFeatures: [
      { type: 'DOOR', deck: 1, position: 'FRONT', side: 'RIGHT' },
      { type: 'STAIRS', deck: 1, position: 'MIDDLE', side: 'CENTER' },
      { type: 'RESTROOM', deck: 1, position: 'REAR', side: 'RIGHT' },
    ],
  },
] satisfies BusTemplate[]

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
      deckCount: null,
      lowerDeckCapacity: null,
      description:
        'Defina lotação, disposição, quantidade de andares e configuração interna.',
      defaultFeatures: [] as VehicleFeature[],
    },
  ]
}

export function resolveBusTemplate(
  key: string,
  capacity?: number | null,
  seatLayout?: string | null,
  deckCount?: number | null,
  lowerDeckCapacity?: number | null,
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

    const decks = deckCount ?? 1
    if (decks !== 1 && decks !== 2) {
      throw new BadRequestException('A quantidade de andares deve ser 1 ou 2')
    }

    let lower: number | null = null
    if (decks === 2) {
      if (
        lowerDeckCapacity === null ||
        lowerDeckCapacity === undefined ||
        !Number.isInteger(lowerDeckCapacity) ||
        lowerDeckCapacity < 1 ||
        lowerDeckCapacity >= capacity
      ) {
        throw new BadRequestException(
          'Veículos de dois andares exigem uma lotação válida para o piso inferior',
        )
      }
      lower = lowerDeckCapacity
    }

    return {
      busTemplate: 'CUSTOM',
      capacity,
      seatLayout: layout,
      deckCount: decks as 1 | 2,
      lowerDeckCapacity: lower,
      busLabel: 'Personalizado',
      defaultFeatures: [] as VehicleFeature[],
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
    deckCount: template.deckCount,
    lowerDeckCapacity: template.lowerDeckCapacity,
    busLabel: template.shortLabel,
    defaultFeatures: template.defaultFeatures,
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
