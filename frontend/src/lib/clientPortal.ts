const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export type ClientPortalData = {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  passengerCount: number
  createdAt: string
  client: {
    id: string
    fullName: string
    email: string | null
    phone: string | null
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
  services: Array<{
    id: string
    category: 'FLIGHT' | 'HOTEL' | 'TRANSFER' | 'TOUR' | 'INSURANCE' | 'OTHER'
    description: string
    supplier: string | null
    amountCents: number
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
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
