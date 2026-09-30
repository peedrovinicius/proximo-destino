const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export type DashboardData = {
  metrics: {
    clients: number
    pendingReservations: number
    activeTrips: number
    confirmedReservations: number
  }
  birthdays: Array<{
    id: string
    fullName: string
    phone: string | null
    birthDate: string
    nextBirthday: string
    daysUntil: number
  }>
}

export type AdminClient = {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  birthDate: string | null
  createdAt: string
  _count: { companions: number; reservations: number }
}

export type AdminTrip = {
  id: string
  title: string
  origin: string
  destination: string
  departureDate: string
  returnDate: string | null
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  capacity: number | null
  priceCents: number | null
  _count: { reservations: number }
}

export type AdminReservation = {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  createdAt: string
  client: { id: string; fullName: string; email: string | null; phone: string | null }
  trip: { id: string; title: string; origin: string; destination: string; departureDate: string }
}

export type SearchResult = {
  clients: Array<{ id: string; fullName: string; email: string | null; phone: string | null }>
  trips: Array<{
    id: string
    title: string
    origin: string
    destination: string
    departureDate: string
    status: string
  }>
  reservations: Array<{
    id: string
    status: string
    client: { fullName: string }
    trip: { title: string; departureDate: string }
  }>
}

async function adminFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  })

  if (!response.ok) {
    let message = 'Não foi possível concluir a operação.'
    try {
      const body = await response.json() as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(' ')
      else if (body.message) message = body.message
    } catch {
      // resposta sem JSON
    }
    throw new Error(message)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const adminApi = {
  dashboard: (token: string) =>
    adminFetch<DashboardData>(token, '/admin/dashboard'),

  clients: (token: string, query = '') =>
    adminFetch<AdminClient[]>(token, `/admin/clients${query ? `?q=${encodeURIComponent(query)}` : ''}`),

  createClient: (
    token: string,
    data: { fullName: string; email?: string; phone?: string; birthDate?: string },
  ) =>
    adminFetch<AdminClient>(token, '/admin/clients', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  trips: (token: string, query = '') =>
    adminFetch<AdminTrip[]>(token, `/admin/trips${query ? `?q=${encodeURIComponent(query)}` : ''}`),

  createTrip: (
    token: string,
    data: {
      title: string
      origin: string
      destination: string
      departureDate: string
      returnDate?: string
      status?: AdminTrip['status']
      capacity?: number
      priceCents?: number
    },
  ) =>
    adminFetch<AdminTrip>(token, '/admin/trips', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  reservations: (token: string) =>
    adminFetch<AdminReservation[]>(token, '/admin/reservations'),

  createReservation: (token: string, clientId: string, tripId: string) =>
    adminFetch<AdminReservation>(token, '/admin/reservations', {
      method: 'POST',
      body: JSON.stringify({ clientId, tripId }),
    }),

  updateReservationStatus: (
    token: string,
    id: string,
    status: AdminReservation['status'],
  ) =>
    adminFetch<void>(token, `/admin/reservations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  search: (token: string, query: string) =>
    adminFetch<SearchResult>(token, `/admin/search?q=${encodeURIComponent(query)}`),
}
