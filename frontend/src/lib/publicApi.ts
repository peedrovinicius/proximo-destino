const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export type PublicTrip = {
  id: string
  title: string
  origin: string
  destination: string
  departureDate: string
  returnDate: string | null
  capacity: number | null
  priceCents: number | null
  summary: string | null
  imageUrl: string | null
  status: 'ACTIVE' | 'SCHEDULED'
}

export type PublicSeatMap = {
  enabled: boolean
  capacity: number | null
  occupiedSeats: number[]
  availableCount: number | null
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
