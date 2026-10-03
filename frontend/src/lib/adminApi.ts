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
  document: string | null
  createdAt: string
  bonusBalanceCents: number
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
  imageUrl: string | null
  hasUploadedImage: boolean
  imageUpdatedAt: string | null
  _count: { reservations: number }
}

export type AdminReservation = {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  passengerCount: number
  cancellationRequestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  cancellationRequestedAt: string | null
  cancellationRequestReason: string | null
  cancellationRequestResolvedAt: string | null
  cancellationRequestResolutionNote: string | null
  seatAssignments: Array<{ seatNumber: number }>
  createdAt: string
  client: {
    id: string
    fullName: string
    email: string | null
    phone: string | null
    bonusBalanceCents: number
  }
  purchaseOrder: {
    status: 'PENDING_PAYMENT' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED'
    totalCents: number
  } | null
  trip: { id: string; title: string; origin: string; destination: string; departureDate: string }
}

export type AdminClientDetail = {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  birthDate: string | null
  document: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  companions: Array<{
    id: string
    fullName: string
    document: string | null
    birthDate: string | null
    relationship: string | null
  }>
  reservations: Array<{
    id: string
    status: AdminReservation['status']
    passengerCount: number
    createdAt: string
    seatAssignments: Array<{ seatNumber: number }>
    trip: {
      id: string
      title: string
      origin: string
      destination: string
      departureDate: string
      status: AdminTrip['status']
    }
  }>
}

export type AdminClientCredits = {
  client: { id: string; fullName: string }
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
    actor: { email: string } | null
  }>
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
  status: 'PENDING_PAYMENT' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED'
  paymentMethod: 'PIX' | 'CARD' | 'BOLETO' | 'TRANSFER'
  unitPriceCents: number
  passengerCount: number
  totalCents: number
  providerPaymentId: string | null
  providerOrderId: string | null
  providerStatus: string | null
  paidAt: string | null
  refundedCents: number
  refundedAt: string | null
  lastReconciledAt: string | null
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
    source: 'ONLINE_PURCHASE' | 'PUBLIC_RESERVATION' | 'ADMIN_RESERVATION'
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

export type BoardingStatus = 'PENDING' | 'BOARDED' | 'ABSENT'

export type TripImageSuggestion = {
  id: string
  title: string
  imageUrl: string
  sourceUrl: string
  author: string | null
  license: string | null
}

export type AdminOperationalAudit = {
  trip: {
    id: string
    title: string
    origin: string
    destination: string
    departureDate: string
    status: AdminTrip['status']
  }
  events: Array<{
    id: string
    eventType: string
    metadata: Record<string, unknown> | null
    createdAt: string
    user: {
      id: string
      email: string
      role: string
    } | null
  }>
}

export type AdminBoardingList = {
  trip: {
    id: string
    title: string
    origin: string
    destination: string
    departureDate: string
    returnDate: string | null
    status: AdminTrip['status']
  }
  canUpdate: boolean
  summary: {
    total: number
    boarded: number
    absent: number
    pending: number
  }
  passengers: Array<{
    id: string
    sequence: number
    fullName: string | null
    document: string | null
    birthDate: string | null
    isPrimary: boolean
    boardingStatus: BoardingStatus
    boardedAt: string | null
    seatAssignment: { seatNumber: number } | null
    reservation: {
      id: string
      status: AdminReservation['status']
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
    refundedOrders: number
    cancelledOrders: number
    expiredOrders: number
    paidCents: number
    pendingCents: number
    refundedCents: number
  }
  orders: AdminPurchaseOrder[]
}

export type AdminReservationFinance = {
  reservation: {
    id: string
    status: AdminReservation['status']
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
    }
  }
  purchaseOrder: {
    id: string
    status: AdminPurchaseOrder['status']
    paymentMethod: AdminPurchaseOrder['paymentMethod']
    unitPriceCents: number
    passengerCount: number
    totalCents: number
    providerPaymentId: string | null
    providerOrderId: string | null
    providerStatus: string | null
    paidAt: string | null
    refundedCents: number
    refundedAt: string | null
    lastReconciledAt: string | null
    createdAt: string
    updatedAt: string
  } | null
  financePlan: {
    id: string
    totalCents: number
    downPaymentCents: number
    installmentCount: number
    refundedCents: number
    createdAt: string
    installments: FinancePlan['installments']
  } | null
  quote: {
    id: string
    revision: number
    title: string
    subtotalSaleCents: number
    discountCents: number
    totalCents: number
    approvedAt: string | null
  } | null
  manualPayments: Array<{
    id: string
    financePlanId: string | null
    installmentId: string | null
    method: 'CASH' | 'TRANSFER' | 'BOLETO'
    status: 'RECEIVED' | 'REVERSED'
    amountCents: number
    paidAt: string
    reference: string | null
    note: string | null
    reversedAt: string | null
    reversedReason: string | null
    createdAt: string
    recordedBy: { id: string; email: string; role: string } | null
    reversedBy: { id: string; email: string; role: string } | null
  }>
  credits: Array<{
    id: string
    type: 'CANCELLATION_CREDIT' | 'BONUS_USED' | 'BONUS_REMOVED'
    amountCents: number
    note: string | null
    createdAt: string
  }>
  summary: {
    totalCents: number
    grossPaidCents: number
    refundedCents: number
    netPaidCents: number
    outstandingCents: number
    refundableCents: number
  }
  events: Array<{
    id: string
    eventType:
      | 'OPS_PAYMENT_REFUNDED'
      | 'OPS_PAYMENT_RECONCILED'
      | 'OPS_MANUAL_PAYMENT_RECEIVED'
      | 'OPS_MANUAL_PAYMENT_REVERSED'
    metadata: Record<string, unknown> | null
    createdAt: string
    user: { id: string; email: string; role: string } | null
  }>
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

export type AdminNotification = {
  id: string
  type:
    | 'RESERVATION_PENDING'
    | 'PAYMENT_PENDING'
    | 'TRIP_UPCOMING'
    | 'BIRTHDAY'
    | 'CANCELLATION_REQUEST'
    | string
  title: string
  message: string
  actionTab: string | null
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export type AdminNotificationFeed = {
  unreadCount: number
  items: AdminNotification[]
}

export type WhatsAppAutomationStatus = {
  enabled: boolean
  providerConfigured: boolean
  deliveryMode: 'WHATSAPP_CLOUD_API' | 'OUTBOX_ONLY'
  freeformEnabled: boolean
  templateLanguage: string
  templates: {
    reservationConfirmed: boolean
    paymentConfirmed: boolean
    reservationCancelled: boolean
    tripReminder: boolean
    birthday: boolean
  }
  counts: {
    pending: number
    processing: number
    sent: number
    failed: number
  }
}

export type WhatsAppOutboxItem = {
  id: string
  eventType: string
  recipientPhone: string
  recipientName: string | null
  sourceType: string | null
  sourceId: string | null
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED'
  attempts: number
  scheduledAt: string
  sentAt: string | null
  providerMessageId: string | null
  errorMessage: string | null
  createdAt: string
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
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers,
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

export function adminTripImageUrl(trip: Pick<AdminTrip, 'id' | 'imageUrl' | 'hasUploadedImage' | 'imageUpdatedAt'>) {
  if (trip.hasUploadedImage) {
    const version = trip.imageUpdatedAt
      ? '?v=' + encodeURIComponent(trip.imageUpdatedAt)
      : ''
    return `${API_BASE}/public/trips/${encodeURIComponent(trip.id)}/image${version}`
  }
  return trip.imageUrl
}

export const adminApi = {
  boardingList: (token: string, tripId: string) =>
    adminFetch<AdminBoardingList>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/boarding`,
    ),

  operationalAudit: (token: string, tripId: string) =>
    adminFetch<AdminOperationalAudit>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/audit`,
    ),

  completeTrip: (token: string, tripId: string) =>
    adminFetch<AdminTrip>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/complete`,
      { method: 'POST' },
    ),

  updateBoardingStatus: (
    token: string,
    tripId: string,
    passengerId: string,
    status: BoardingStatus,
  ) =>
    adminFetch<AdminBoardingList>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/boarding/${encodeURIComponent(passengerId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    ),

  bulkUpdateBoardingStatus: (
    token: string,
    tripId: string,
    passengerIds: string[],
    status: BoardingStatus,
  ) =>
    adminFetch<AdminBoardingList>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/boarding`,
      {
        method: 'PATCH',
        body: JSON.stringify({ passengerIds, status }),
      },
    ),

  scanBoardingQr: (
    token: string,
    tripId: string,
    code: string,
  ) =>
    adminFetch<{
      reservationId: string
      documentNumber: string
      clientName: string
      passengerIds: string[]
      passengers: Array<{
        id: string
        sequence: number
        fullName: string | null
        boardingStatus: BoardingStatus
        seatAssignment: { seatNumber: number } | null
      }>
    }>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/boarding/scan`,
      {
        method: 'POST',
        body: JSON.stringify({ code }),
      },
    ),

  reservationFinance: (token: string, reservationId: string) =>
    adminFetch<AdminReservationFinance>(
      token,
      `/admin/reservations/${encodeURIComponent(reservationId)}/finance`,
    ),

  registerManualPayment: (
    token: string,
    reservationId: string,
    input: {
      amountCents: number
      method: 'CASH' | 'TRANSFER' | 'BOLETO'
      paidAt?: string
      installmentId?: string
      reference?: string
      note?: string
    },
  ) =>
    adminFetch<AdminReservationFinance>(
      token,
      `/admin/reservations/${encodeURIComponent(reservationId)}/finance/manual-payments`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  reverseManualPayment: (
    token: string,
    reservationId: string,
    paymentId: string,
    reason: string,
  ) =>
    adminFetch<AdminReservationFinance>(
      token,
      `/admin/reservations/${encodeURIComponent(reservationId)}/finance/manual-payments/${encodeURIComponent(paymentId)}/reverse`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    ),

  reconcileReservationPayment: (
    token: string,
    reservationId: string,
  ) =>
    adminFetch<AdminReservationFinance>(
      token,
      `/admin/reservations/${encodeURIComponent(reservationId)}/finance/reconcile`,
      { method: 'POST' },
    ),

  refundReservationPayment: (
    token: string,
    reservationId: string,
    amountCents: number,
    reason?: string,
  ) =>
    adminFetch<AdminReservationFinance>(
      token,
      `/admin/reservations/${encodeURIComponent(reservationId)}/finance/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ amountCents, reason }),
      },
    ),

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

  assignClientToSeat: (
    token: string,
    tripId: string,
    seatNumber: number,
    data: {
      clientId?: string
      fullName?: string
      email?: string
      phone?: string
      document?: string
      birthDate?: string
    },
  ) =>
    adminFetch<AdminSeatMap>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/seats/${seatNumber}/assignment`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    ),

  moveSeatAssignment: (
    token: string,
    tripId: string,
    fromSeatNumber: number,
    toSeatNumber: number,
  ) =>
    adminFetch<AdminSeatMap>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/seats/${fromSeatNumber}/assignment`,
      {
        method: 'PATCH',
        body: JSON.stringify({ toSeatNumber }),
      },
    ),

  purchaseOrders: (token: string) =>
    adminFetch<AdminPaymentsDashboard>(token, '/admin/payments/orders'),

  paymentConnection: (token: string) =>
    adminFetch<PaymentConnectionStatus>(token, '/admin/payments/mercado-pago'),

  notifications: (token: string, limit = 80) =>
    adminFetch<AdminNotificationFeed>(
      token,
      `/admin/notifications?limit=${limit}`,
    ),

  markNotificationRead: (token: string, id: string) =>
    adminFetch<AdminNotification>(
      token,
      `/admin/notifications/${encodeURIComponent(id)}/read`,
      { method: 'PATCH' },
    ),

  markAllNotificationsRead: (token: string) =>
    adminFetch<{ updated: number }>(
      token,
      '/admin/notifications/read-all',
      { method: 'POST' },
    ),

  whatsappAutomationStatus: (token: string) =>
    adminFetch<WhatsAppAutomationStatus>(
      token,
      '/admin/notifications/whatsapp/status',
    ),

  whatsappOutbox: (token: string, limit = 50) =>
    adminFetch<WhatsAppOutboxItem[]>(
      token,
      `/admin/notifications/whatsapp/outbox?limit=${limit}`,
    ),

  processWhatsAppOutbox: (token: string) =>
    adminFetch<{ processed: number } & WhatsAppAutomationStatus>(
      token,
      '/admin/notifications/whatsapp/process',
      { method: 'POST' },
    ),

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

  client: (token: string, clientId: string) =>
    adminFetch<AdminClientDetail>(
      token,
      `/admin/clients/${encodeURIComponent(clientId)}`,
    ),

  updateClient: (
    token: string,
    clientId: string,
    data: {
      fullName?: string
      email?: string
      phone?: string
      birthDate?: string | null
      document?: string | null
      notes?: string
    },
  ) =>
    adminFetch<void>(
      token,
      `/admin/clients/${encodeURIComponent(clientId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
    ),

  clientCredits: (token: string, clientId: string) =>
    adminFetch<AdminClientCredits>(
      token,
      `/admin/clients/${encodeURIComponent(clientId)}/credits`,
    ),

  removeClientBonus: (
    token: string,
    clientId: string,
    amountCents: number,
    reason?: string,
  ) =>
    adminFetch<AdminClientCredits>(
      token,
      `/admin/clients/${encodeURIComponent(clientId)}/credits/remove`,
      {
        method: 'POST',
        body: JSON.stringify({ amountCents, reason }),
      },
    ),

  createClient: (
    token: string,
    data: { fullName: string; email?: string; phone?: string; birthDate?: string; document?: string },
  ) =>
    adminFetch<AdminClient>(token, '/admin/clients', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  trips: (token: string, query = '') =>
    adminFetch<AdminTrip[]>(token, `/admin/trips${query ? `?q=${encodeURIComponent(query)}` : ''}`),

  busTemplates: (token: string) =>
    adminFetch<BusTemplateOption[]>(token, '/admin/trips/bus-templates'),

  imageSuggestions: (token: string, query: string) =>
    adminFetch<TripImageSuggestion[]>(
      token,
      `/admin/trips/image-suggestions?q=${encodeURIComponent(query)}`,
    ),

  uploadTripImage: (token: string, tripId: string, file: Blob, filename = 'viagem.webp') => {
    const form = new FormData()
    form.append('file', file, filename)
    return adminFetch<AdminTrip>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/image`,
      { method: 'POST', body: form },
    )
  },

  clearTripImage: (token: string, tripId: string) =>
    adminFetch<AdminTrip>(
      token,
      `/admin/trips/${encodeURIComponent(tripId)}/image`,
      { method: 'DELETE' },
    ),

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
      imageUrl?: string
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
      imageUrl?: string | null
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

  cancelReservation: (
    token: string,
    id: string,
    data: { creditAsBonus: boolean; reason?: string },
  ) =>
    adminFetch<{
      cancelled: boolean
      alreadyCancelled: boolean
      paidCents: number
      bonusGrantedCents: number
    }>(token, `/admin/reservations/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  rejectCancellationRequest: (
    token: string,
    id: string,
    note?: string,
  ) =>
    adminFetch<{ rejected: boolean }>(
      token,
      `/admin/reservations/${encodeURIComponent(id)}/cancel-request/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ note }),
      },
    ),

  applyReservationBonus: (
    token: string,
    id: string,
    amountCents: number,
    note?: string,
  ) =>
    adminFetch<{
      appliedCents: number
      remainingBonusCents: number
      quoteTotalCents: number
    }>(token, `/admin/reservations/${encodeURIComponent(id)}/bonus/apply`, {
      method: 'POST',
      body: JSON.stringify({ amountCents, note }),
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
