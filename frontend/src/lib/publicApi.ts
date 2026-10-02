const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export type PublicTrip = {
  id: string
  title: string
  origin: string
  destination: string
  departureDate: string
  returnDate: string | null
  capacity: number | null
  busTemplate: string | null
  seatLayout: 'TWO_BY_TWO' | 'TWO_BY_ONE' | null
  priceCents: number | null
  summary: string | null
  imageUrl: string | null
  hasUploadedImage: boolean
  imageUpdatedAt: string | null
  status: 'ACTIVE' | 'SCHEDULED'
}

export type VehicleFeature = {
  type: 'RESTROOM' | 'DOOR' | 'STAIRS'
  deck: 1 | 2
  position: 'FRONT' | 'MIDDLE' | 'REAR'
  side: 'LEFT' | 'CENTER' | 'RIGHT'
}

export type PublicSeatMap = {
  enabled: boolean
  capacity: number | null
  busTemplate: string | null
  busLabel: string | null
  seatLayout: 'TWO_BY_TWO' | 'TWO_BY_ONE'
  deckCount: 1 | 2
  lowerDeckCapacity: number | null
  vehicleFeatures: VehicleFeature[]
  blockedSeats: number[]
  occupiedSeats: number[]
  availableCount: number | null
}

export type PurchasePaymentMethod = 'PIX' | 'CARD' | 'BOLETO' | 'TRANSFER'

export type PublicPaymentConfig = {
  provider: 'MERCADO_PAGO'
  configured: boolean
  methods: {
    PIX: boolean
    CARD: boolean
    BOLETO: boolean
    TRANSFER: boolean
  }
}

export type PaymentStartResult =
  | {
      provider: 'MERCADO_PAGO'
      kind: 'PIX'
      status: string
      qrCode: string
      qrCodeBase64: string | null
      ticketUrl: string | null
      expiresAt: string | null
    }
  | {
      provider: 'MERCADO_PAGO'
      kind: 'CHECKOUT'
      status: string
      checkoutUrl: string
    }
  | {
      provider: 'MERCADO_PAGO'
      kind: 'UNAVAILABLE'
      status: string
      message: string
    }

export type ReservationRequestResult = {
  reservation: {
    id: string
    status: 'PENDING'
    passengerCount: number
    createdAt: string
  }
  accessCode: string
  selectedSeats: number[]
  passengers: Array<{
    id: string
    sequence: number
    fullName: string | null
    document: string | null
    isPrimary: boolean
    seatAssignment: { seatNumber: number } | null
  }>
  purchaseOrder: {
    id: string
    status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED'
    paymentMethod: PurchasePaymentMethod
    unitPriceCents: number
    passengerCount: number
    totalCents: number
    createdAt: string
  } | null
  payment: PaymentStartResult | null
  message: string
}

async function parseError(response: Response) {
  try {
    const body = await response.json() as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(' ')
    if (body.message) return body.message
  } catch {
    // sem corpo JSON
  }
  return 'Não foi possível concluir a operação.'
}

export function publicTripImageUrl(
  trip: Pick<PublicTrip, 'id' | 'imageUrl' | 'hasUploadedImage' | 'imageUpdatedAt'>,
) {
  if (trip.hasUploadedImage) {
    const version = trip.imageUpdatedAt
      ? '?v=' + encodeURIComponent(trip.imageUpdatedAt)
      : ''
    return `${API_BASE}/public/trips/${encodeURIComponent(trip.id)}/image${version}`
  }
  return trip.imageUrl
}

export async function fetchPublicPaymentConfig() {
  const response = await fetch(`${API_BASE}/public/payments/config`)
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<PublicPaymentConfig>
}

export async function fetchPublicTrips(filters: {
  origin?: string
  destination?: string
  departureDate?: string
} = {}) {
  const params = new URLSearchParams()
  if (filters.origin) params.set('origin', filters.origin)
  if (filters.destination) params.set('destination', filters.destination)
  if (filters.departureDate) params.set('departureDate', filters.departureDate)

  const suffix = params.size ? `?${params.toString()}` : ''
  const response = await fetch(`${API_BASE}/public/trips${suffix}`)

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<PublicTrip[]>
}

export async function fetchPublicTrip(id: string) {
  const response = await fetch(`${API_BASE}/public/trips/${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<PublicTrip>
}

export async function fetchPublicTripSeats(id: string) {
  const response = await fetch(
    `${API_BASE}/public/trips/${encodeURIComponent(id)}/seats`,
  )
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<PublicSeatMap>
}

export async function requestReservation(input: {
  tripId: string
  fullName: string
  email: string
  phone: string
  passengerCount: number
  selectedSeats?: number[]
  passengers?: Array<{
    fullName: string
    document?: string
  }>
  intent?: 'RESERVATION' | 'PURCHASE'
  paymentMethod?: PurchasePaymentMethod
}) {
  const response = await fetch(`${API_BASE}/public/reservations/request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<ReservationRequestResult>
}


export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

export async function askTravelAssistant(
  message: string,
  history: AssistantMessage[],
) {
  const response = await fetch(`${API_BASE}/public/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: history.slice(-8),
    }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<{
    answer: string
    catalogUpdatedAt: string
  }>
}
