export type PublicTripStatus =
  | 'ACTIVE'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DRAFT'

export type PublicTrip = {
  id: string
  origin: string
  destination: string
  departureDate: string
  returnDate?: string
  priceFrom: number
  status: PublicTripStatus
  image: string
  tag: string
  nights: number
}

export const publicTrips: PublicTrip[] = [
  {
    id: 'trip-bue-001',
    origin: 'Fortaleza',
    destination: 'Buenos Aires',
    departureDate: '2026-10-03',
    returnDate: '2026-10-08',
    priceFrom: 3240,
    status: 'ACTIVE',
    image: 'https://images.unsplash.com/photo-1589909202802-8f4aadce1849?auto=format&fit=crop&w=900&q=84',
    tag: 'Internacional',
    nights: 5,
  },
  {
    id: 'trip-mcz-002',
    origin: 'Fortaleza',
    destination: 'Maceió',
    departureDate: '2026-10-10',
    returnDate: '2026-10-16',
    priceFrom: 2680,
    status: 'SCHEDULED',
    image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=84',
    tag: 'Praia',
    nights: 6,
  },
  {
    id: 'trip-gra-003',
    origin: 'Fortaleza',
    destination: 'Gramado',
    departureDate: '2026-11-05',
    returnDate: '2026-11-09',
    priceFrom: 3580,
    status: 'SCHEDULED',
    image: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=900&q=84',
    tag: 'Serra',
    nights: 4,
  },
  {
    id: 'trip-rec-004',
    origin: 'Fortaleza',
    destination: 'Recife',
    departureDate: '2026-10-18',
    returnDate: '2026-10-22',
    priceFrom: 1980,
    status: 'ACTIVE',
    image: 'https://images.unsplash.com/photo-1544989164-31dc3c645987?auto=format&fit=crop&w=900&q=84',
    tag: 'Em alta',
    nights: 4,
  },
  {
    id: 'trip-lis-005',
    origin: 'Fortaleza',
    destination: 'Lisboa',
    departureDate: '2026-12-02',
    returnDate: '2026-12-10',
    priceFrom: 7890,
    status: 'SCHEDULED',
    image: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=84',
    tag: 'Europa',
    nights: 8,
  },
  {
    id: 'trip-rio-006',
    origin: 'Juazeiro do Norte',
    destination: 'Rio de Janeiro',
    departureDate: '2026-10-24',
    returnDate: '2026-10-29',
    priceFrom: 2940,
    status: 'ACTIVE',
    image: 'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?auto=format&fit=crop&w=900&q=84',
    tag: 'Cidade',
    nights: 5,
  },
  {
    id: 'trip-nat-old',
    origin: 'Fortaleza',
    destination: 'Natal',
    departureDate: '2026-06-10',
    returnDate: '2026-06-14',
    priceFrom: 1620,
    status: 'COMPLETED',
    image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=84',
    tag: 'Concluída',
    nights: 4,
  },
  {
    id: 'trip-sal-cancel',
    origin: 'Fortaleza',
    destination: 'Salvador',
    departureDate: '2026-10-15',
    returnDate: '2026-10-20',
    priceFrom: 2450,
    status: 'CANCELLED',
    image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=84',
    tag: 'Cancelada',
    nights: 5,
  },
]

const searchableStatuses: PublicTripStatus[] = ['ACTIVE', 'SCHEDULED']

export function isTripSearchable(trip: PublicTrip) {
  return searchableStatuses.includes(trip.status)
}

export function searchableTrips() {
  return publicTrips.filter(isTripSearchable)
}

export function availableOrigins() {
  return [...new Set(searchableTrips().map((trip) => trip.origin))].sort()
}

export function availableDestinations(origin?: string) {
  return [
    ...new Set(
      searchableTrips()
        .filter((trip) => !origin || trip.origin === origin)
        .map((trip) => trip.destination),
    ),
  ].sort()
}

export function findTrips(origin: string, destination: string, departureDate = '') {
  return searchableTrips().filter(
    (trip) =>
      (!origin || trip.origin === origin) &&
      (!destination || trip.destination === destination) &&
      (!departureDate || trip.departureDate === departureDate),
  )
}
