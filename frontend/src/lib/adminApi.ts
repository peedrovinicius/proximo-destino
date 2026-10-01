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

export type SeatLayout = 'TWO_BY_TWO' | 'TWO_BY_ONE'
export type VehicleFeatureType = 'RESTROOM' | 'DOOR' | 'STAIRS'
export type VehicleFeaturePosition = 'FRONT' | 'MIDDLE' | 'REAR'
export type VehicleFeatureSide = 'LEFT' | 'CENTER' | 'RIGHT'

export type VehicleFeature = {
  type: VehicleFeatureType
  deck: 1 | 2
  position: VehicleFeaturePosition
  side: VehicleFeatureSide
}

export type BusTemplateOption = {
  key: string
  label: string
  shortLabel: string
  capacity: number | null
  seatLayout: SeatLayout | null
  deckCount: 1 | 2 | null
  lowerDeckCapacity: number | null
  description: string
  defaultFeatures: VehicleFeature[]
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
  busTemplate: string | null
  seatLayout: SeatLayout | null
  deckCount: number | null
  lowerDeckCapacity: number | null
  vehicleFeatures: VehicleFeature[] | null
  blockedSeats: number[]
  priceCents: number | null
  _count: { reservations: number }
}

export type AdminReservation = {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  passengerCount: number
  seatAssignments: Array<{ seatNumber: number }>
  createdAt: string
  client: { id: string; fullName: string; email: string | null; phone: string | null }
  trip: { id: string; title: string; origin: string; destination: string; departureDate: string }
}

export type AdminReservationPassengers = {
  id: string
  status: AdminReservation['status']
  passengerCount: number
  client: AdminReservation['client']
  trip: AdminReservation['trip']
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
    passengerId: string | null
  }>
}

export type QuoteStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
export type QuoteItemCategory = 'FLIGHT' | 'HOTEL' | 'TRANSFER' | 'TOUR' | 'INSURANCE' | 'OTHER'

export type AdminQuote = {
  id: string
  reservationId: string
  revision: number
  status: QuoteStatus
  title: string
  validUntil: string | null
  notes: string | null
  subtotalCostCents: number
  subtotalSaleCents: number
  discountCents: number
  totalCents: number
  marginCents: number
  sentAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  items: Array<{
    id: string
    category: QuoteItemCategory
    description: string
    supplier: string | null
    quantity: number
    unitCostCents: number
    unitSaleCents: number
    totalCostCents: number
    totalSaleCents: number
  }>
  reservation: {
    id: string
    status: AdminReservation['status']
    passengerCount: number
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
    }
  }
}

export type ReservationService = {
  id: string
  reservationId: string
  category: QuoteItemCategory
  description: string
  supplier: string | null
  amountCents: number
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  createdAt: string
  updatedAt: string
  reservation: {
    client: { fullName: string }
    trip: { title: string; destination: string }
  }
}

export type FinancePlan = {
  id: string
  reservationId: string
  quoteId: string
  totalCents: number
  downPaymentCents: number
  installmentCount: number
  createdAt: string
  quote: {
    id: string
    title: string
    revision: number
    status: QuoteStatus
  }
  reservation: {
    id: string
    status: AdminReservation['status']
    client: { id: string; fullName: string; email: string | null }
    trip: { id: string; title: string; destination: string; departureDate: string }
  }
  installments: Array<{
    id: string
    sequence: number
    dueDate: string
    amountCents: number
    status: 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED'
    paidAt: string | null
    paymentMethod: string | null
  }>
}

export type AdminDocument = {
  id: string
  type: 'TRAVEL_VOUCHER' | 'PURCHASE_RECEIPT'
  version: number
  documentNumber: string
  verificationCode: string
  issuedAt: string
}

export type AdminPurchaseOrder = {
  id: string
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED'
  paymentMethod: 'PIX' | 'CARD' | 'BOLETO' | 'TRANSFER'
  unitPriceCents: number
  passengerCount: number
  totalCents: number
  createdAt: string
  updatedAt: string
  reservation: {
    id: string
    status: AdminReservation['status']
    seatAssignments: Array<{ seatNumber: number }>
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
    }
  }
}

export type AdminSeatMap = {
  enabled: boolean
  trip: {
    id: string
    title: string
    origin: string
    destination: string
    departureDate: string
  }
  capacity: number | null
  busLabel: string | null
  seatLayout: SeatLayout
  deckCount: 1 | 2
  lowerDeckCapacity: number | null
  vehicleFeatures: VehicleFeature[]
  blockedSeats: number[]
  occupiedSeats: number[]
  availableCount: number | null
  assignments: Array<{
    seatNumber: number
    passenger: {
      id: string
      sequence: number
      fullName: string | null
      document: string | null
    } | null
    reservation: {
      id: string
      status: AdminReservation['status']
      passengerCount: number
      client: {
        id: string
        fullName: string
        email: string | null
        phone: string | null
      }
    }
  }>
}

export type AdminPaymentsDashboard = {
  summary: {
    totalOrders: number
    paidOrders: number
    pendingOrders: number
    cancelledOrders: number
    expiredOrders: number
    paidCents: number
    pendingCents: number
  }
  orders: AdminPurchaseOrder[]
}

export type PaymentConnectionStatus = {
  provider: 'MERCADO_PAGO'
  platformConfigured: boolean
  webhookConfigured: boolean
  connected: boolean
  readyForPayments: boolean
  externalUserId: string | null
  liveMode: boolean | null
  connectedAt: string | null
  expiresAt: string | null
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
  reservationPassengers: (token: string, reservationId: string) =>
    adminFetch<AdminReservationPassengers>(
      token,
      `/admin/reservations/${encodeURIComponent(reservationId)}/passengers`,
    ),

  updateReservationPassengers: (
    token: string,
    reservationId: string,
    passengers: Array<{
      id: string
      fullName?: string | null
      document?: string | null
      birthDate?: string | null
      seatNumber?: number | null
    }>,
  ) =>
    adminFetch<AdminReservationPassengers>(
      token,
      `/admin/reservations/${encodeURIComponent(reservationId)}/passengers`,
      {
        method: 'PATCH',
        body: JSON.stringify({ passengers }),
      },
    ),

  seatMap: (token: string, tripId: string) =>
    adminFetch<AdminSeatMap>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/seats`,
    ),

  setSeatBlocked: (
    token: string,
    tripId: string,
    seatNumber: number,
    blocked: boolean,
  ) =>
    adminFetch<AdminSeatMap>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/seats/${seatNumber}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ blocked }),
      },
    ),

  purchaseOrders: (token: string) =>
    adminFetch<AdminPaymentsDashboard>(token, '/admin/payments/orders'),

  paymentConnection: (token: string) =>
    adminFetch<PaymentConnectionStatus>(token, '/admin/payments/mercado-pago'),

  connectMercadoPago: (token: string) =>
    adminFetch<{ authorizationUrl: string }>(
      token,
      '/admin/payments/mercado-pago/connect',
      { method: 'POST' },
    ),

  disconnectMercadoPago: (token: string) =>
    adminFetch<{ disconnected: boolean }>(
      token,
      '/admin/payments/mercado-pago/disconnect',
      { method: 'POST' },
    ),

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

  busTemplates: (token: string) =>
    adminFetch<BusTemplateOption[]>(token, '/admin/trips/bus-templates'),

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
      busTemplate?: string | null
      seatLayout?: SeatLayout | null
      deckCount?: number | null
      lowerDeckCapacity?: number | null
      vehicleFeatures?: VehicleFeature[] | null
      blockedSeats?: number[]
      priceCents?: number
    },
  ) =>
    adminFetch<AdminTrip>(token, '/admin/trips', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTrip: (
    token: string,
    id: string,
    data: {
      capacity?: number | null
      busTemplate?: string | null
      seatLayout?: SeatLayout | null
      deckCount?: number | null
      lowerDeckCapacity?: number | null
      vehicleFeatures?: VehicleFeature[] | null
      blockedSeats?: number[]
    },
  ) =>
    adminFetch<AdminTrip>(token, `/admin/trips/${encodeURIComponent(id)}`, {
      method: 'PATCH',
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

  quotes: (token: string, reservationId = '') =>
    adminFetch<AdminQuote[]>(
      token,
      `/admin/commercial/quotes${reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : ''}`,
    ),

  createQuote: (
    token: string,
    data: {
      reservationId: string
      title: string
      validUntil?: string
      notes?: string
      discountCents?: number
    },
  ) =>
    adminFetch<AdminQuote>(token, '/admin/commercial/quotes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  addQuoteItem: (
    token: string,
    quoteId: string,
    data: {
      category: QuoteItemCategory
      description: string
      supplier?: string
      quantity: number
      unitCostCents: number
      unitSaleCents: number
    },
  ) =>
    adminFetch<AdminQuote>(token, `/admin/commercial/quotes/${quoteId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeQuoteItem: (token: string, quoteId: string, itemId: string) =>
    adminFetch<AdminQuote>(
      token,
      `/admin/commercial/quotes/${quoteId}/items/${itemId}`,
      { method: 'DELETE' },
    ),

  sendQuote: (token: string, quoteId: string) =>
    adminFetch<AdminQuote>(token, `/admin/commercial/quotes/${quoteId}/send`, {
      method: 'POST',
    }),

  reviseQuote: (token: string, quoteId: string) =>
    adminFetch<AdminQuote>(token, `/admin/commercial/quotes/${quoteId}/revise`, {
      method: 'POST',
    }),

  services: (token: string, reservationId = '') =>
    adminFetch<ReservationService[]>(
      token,
      `/admin/commercial/services${reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : ''}`,
    ),

  updateServiceStatus: (
    token: string,
    id: string,
    status: ReservationService['status'],
  ) =>
    adminFetch<void>(token, `/admin/commercial/services/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  financePlans: (token: string) =>
    adminFetch<FinancePlan[]>(token, '/admin/commercial/finance/plans'),

  createFinancePlan: (
    token: string,
    data: {
      reservationId: string
      installmentCount: number
      firstDueDate: string
      downPaymentCents?: number
    },
  ) =>
    adminFetch<FinancePlan>(token, '/admin/commercial/finance/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateInstallment: (
    token: string,
    id: string,
    status: FinancePlan['installments'][number]['status'],
    paymentMethod?: string,
  ) =>
    adminFetch<void>(token, `/admin/commercial/finance/installments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, paymentMethod }),
    }),

  documents: (token: string, reservationId: string) =>
    adminFetch<AdminDocument[]>(
      token,
      `/admin/documents/reservation/${encodeURIComponent(reservationId)}`,
    ),

  issueTravelVoucher: (
    token: string,
    reservationId: string,
    data: {
      airline?: string
      flightNumber?: string
      bookingCode?: string
      seat?: string
      baggage?: string
      departureLocation?: string
      arrivalLocation?: string
      departureAt?: string
      arrivalAt?: string
      departureTerminal?: string
      arrivalTerminal?: string
      notes?: string
    },
  ) =>
    adminFetch<AdminDocument>(
      token,
      `/admin/documents/reservation/${encodeURIComponent(reservationId)}/travel-voucher`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    ),

  issuePurchaseReceipt: (
    token: string,
    reservationId: string,
    data: { notes?: string } = {},
  ) =>
    adminFetch<AdminDocument>(
      token,
      `/admin/documents/reservation/${encodeURIComponent(reservationId)}/purchase-receipt`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    ),

  openDocumentPdf: async (token: string, documentId: string) => {
    const response = await fetch(
      `${API_BASE}/admin/documents/${encodeURIComponent(documentId)}/pdf`,
      {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      },
    )
    if (!response.ok) throw new Error('Não foi possível abrir o documento.')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },

  search: (token: string, query: string) =>
    adminFetch<SearchResult>(token, `/admin/search?q=${encodeURIComponent(query)}`),
}
