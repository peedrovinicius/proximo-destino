export type AdminRole = 'ADMIN' | 'AGENT' | 'FINANCE'

export type AdminCapabilities = {
  viewClients: boolean
  manageClients: boolean
  viewTrips: boolean
  manageTrips: boolean
  viewReservations: boolean
  createReservations: boolean
  changeReservationStatus: boolean
  managePassengers: boolean
  cancelReservations: boolean
  manageBonus: boolean
  viewQuotes: boolean
  manageQuotes: boolean
  viewPayments: boolean
  viewFinance: boolean
  viewAudit: boolean
  viewSettings: boolean
}

const none: AdminCapabilities = {
  viewClients: false,
  manageClients: false,
  viewTrips: false,
  manageTrips: false,
  viewReservations: false,
  createReservations: false,
  changeReservationStatus: false,
  managePassengers: false,
  cancelReservations: false,
  manageBonus: false,
  viewQuotes: false,
  manageQuotes: false,
  viewPayments: false,
  viewFinance: false,
  viewAudit: false,
  viewSettings: false,
}

const matrix: Record<AdminRole, AdminCapabilities> = {
  ADMIN: {
    viewClients: true,
    manageClients: true,
    viewTrips: true,
    manageTrips: true,
    viewReservations: true,
    createReservations: true,
    changeReservationStatus: true,
    managePassengers: true,
    cancelReservations: true,
    manageBonus: true,
    viewQuotes: true,
    manageQuotes: true,
    viewPayments: true,
    viewFinance: true,
    viewAudit: true,
    viewSettings: true,
  },
  AGENT: {
    viewClients: true,
    manageClients: true,
    viewTrips: true,
    manageTrips: true,
    viewReservations: true,
    createReservations: true,
    changeReservationStatus: true,
    managePassengers: false,
    cancelReservations: false,
    manageBonus: false,
    viewQuotes: true,
    manageQuotes: true,
    viewPayments: false,
    viewFinance: false,
    viewAudit: false,
    viewSettings: false,
  },
  FINANCE: {
    viewClients: false,
    manageClients: false,
    viewTrips: false,
    manageTrips: false,
    viewReservations: true,
    createReservations: false,
    changeReservationStatus: false,
    managePassengers: false,
    cancelReservations: false,
    manageBonus: false,
    viewQuotes: false,
    manageQuotes: false,
    viewPayments: true,
    viewFinance: true,
    viewAudit: false,
    viewSettings: false,
  },
}

export function adminCapabilities(role: string | null): AdminCapabilities {
  if (role === 'ADMIN' || role === 'AGENT' || role === 'FINANCE') {
    return matrix[role]
  }

  return none
}
