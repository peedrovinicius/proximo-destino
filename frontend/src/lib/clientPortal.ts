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
