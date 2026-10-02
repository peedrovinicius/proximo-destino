import type { VehicleFeature } from './publicApi'

const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export type ClientPaymentStartResult =
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
      kind: 'PAID'
      status: string
    }

export type ClientPortalData = {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  passengerCount: number
  createdAt: string
  canEditPassengers: boolean
  canRequestCancellation: boolean
  cancellationRequestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  cancellationRequestedAt: string | null
  cancellationRequestReason: string | null
  cancellationRequestResolvedAt: string | null
  cancellationRequestResolutionNote: string | null
  cancellationFinancial: {
    paidCents: number
    reviewableCents: number
  }
  canChangeSeats: boolean
  seatChangeCutoffAt: string
  seatMap: {
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
  passengers: Array<{
    id: string
    sequence: number
    fullName: string | null
    document: string | null
    birthDate: string | null
    isPrimary: boolean
    seatAssignment: { seatNumber: number } | null
  }>
  seatAssignments: Array<{
    seatNumber: number
  }>
  client: {
    id: string
    fullName: string
    email: string | null
    phone: string | null
  }
  bonus: {
    balanceCents: number
    transactions: Array<{
      id: string
      type: 'CANCELLATION_CREDIT' | 'BONUS_USED' | 'BONUS_REMOVED'
      amountCents: number
      note: string | null
      createdAt: string
      reservation: {
        id: string
        trip: { title: string; destination: string }
      } | null
    }>
  }
  trip: {
    id: string
    title: string
    origin: string
    destination: string
    departureDate: string
    returnDate: string | null
    priceCents: number | null
    summary: string | null
    imageUrl: string | null
    status: string
  }
  quotes: Array<{
    id: string
    revision: number
    status: 'SENT' | 'APPROVED'
    title: string
    validUntil: string | null
    notes: string | null
    subtotalSaleCents: number
    discountCents: number
    totalCents: number
    sentAt: string | null
    approvedAt: string | null
    items: Array<{
      id: string
      category: 'FLIGHT' | 'HOTEL' | 'TRANSFER' | 'TOUR' | 'INSURANCE' | 'OTHER'
      description: string
      supplier: string | null
      quantity: number
      unitSaleCents: number
      totalSaleCents: number
    }>
  }>
  purchaseOrder: {
    id: string
    status: 'PENDING_PAYMENT' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED'
    paymentMethod: 'PIX' | 'CARD' | 'BOLETO' | 'TRANSFER'
    unitPriceCents: number
    passengerCount: number
    totalCents: number
    createdAt: string
    updatedAt: string
  } | null
  services: Array<{
    id: string
    category: 'FLIGHT' | 'HOTEL' | 'TRANSFER' | 'TOUR' | 'INSURANCE' | 'OTHER'
    description: string
    supplier: string | null
    amountCents: number
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  }>
  documents: Array<{
    id: string
    type: 'TRAVEL_VOUCHER' | 'PURCHASE_RECEIPT'
    version: number
    documentNumber: string
    issuedAt: string
  }>
  financePlan: {
    id: string
    totalCents: number
    downPaymentCents: number
    installmentCount: number
    installments: Array<{
      id: string
      sequence: number
      dueDate: string
      amountCents: number
      status: 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED'
      paidAt: string | null
      paymentMethod: string | null
    }>
  } | null
}

async function parseError(response: Response) {
  try {
    const body = await response.json() as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(' ')
    if (body.message) return body.message
  } catch {
    // sem JSON
  }
  return 'Não foi possível concluir a operação.'
}

export async function loginClientPortal(email: string, code: string) {
  const response = await fetch(`${API_BASE}/client/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<{ accessToken: string }>
}

export async function fetchClientPortal(accessToken: string) {
  const response = await fetch(`${API_BASE}/client/portal`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<ClientPortalData>
}

export async function updateClientPassengers(
  accessToken: string,
  passengers: Array<{
    id: string
    fullName: string
    document?: string | null
    birthDate?: string | null
  }>,
) {
  const response = await fetch(`${API_BASE}/client/passengers`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ passengers }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<ClientPortalData>
}

export async function updateClientSeats(
  accessToken: string,
  selectedSeats: number[],
) {
  const response = await fetch(`${API_BASE}/client/seats`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ selectedSeats }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<ClientPortalData>
}

export async function requestClientCancellation(
  accessToken: string,
  reason: string,
) {
  const response = await fetch(`${API_BASE}/client/cancellation-request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<ClientPortalData>
}

export async function retryClientPayment(accessToken: string) {
  const response = await fetch(`${API_BASE}/client/payment/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<ClientPaymentStartResult>
}

export async function approveClientQuote(accessToken: string, quoteId: string) {
  const response = await fetch(`${API_BASE}/client/quotes/${quoteId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json()
}

export async function rejectClientQuote(accessToken: string, quoteId: string) {
  const response = await fetch(`${API_BASE}/client/quotes/${quoteId}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json()
}

export async function openClientDocumentPdf(
  accessToken: string,
  documentId: string,
) {
  const response = await fetch(
    `${API_BASE}/client/documents/${encodeURIComponent(documentId)}/pdf`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )

  if (!response.ok) throw new Error(await parseError(response))
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
