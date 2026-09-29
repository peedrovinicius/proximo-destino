export type MetricTone = 'neutral' | 'positive' | 'attention'

export interface DashboardMetric {
  id: string
  label: string
  value: string
  detail: string
  trend?: string
  tone: MetricTone
}

export type TripStatus = 'Confirmada' | 'Pendente' | 'Em viagem' | 'Concluída'

export interface UpcomingTrip {
  id: string
  customer: string
  destination: string
  dateLabel: string
  passengers: number
  status: TripStatus
  amount: string
}

export interface SalesChannel {
  id: string
  label: string
  value: number
  share: string
}

export interface ActivityItem {
  id: string
  title: string
  description: string
  time: string
  kind: 'sale' | 'payment' | 'document' | 'alert'
}
