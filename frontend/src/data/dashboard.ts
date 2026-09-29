import type {
  ActivityItem,
  DashboardMetric,
  SalesChannel,
  UpcomingTrip,
} from '../types/dashboard'

export const dashboardMetrics: DashboardMetric[] = [
  {
    id: 'sales',
    label: 'Vendas no mês',
    value: 'R$ 184.650',
    detail: '42 viagens comercializadas',
    trend: '+12,8%',
    tone: 'positive',
  },
  {
    id: 'quotes',
    label: 'Cotações abertas',
    value: '27',
    detail: '9 aguardando retorno hoje',
    trend: '6 prioritárias',
    tone: 'attention',
  },
  {
    id: 'travelers',
    label: 'Viajantes ativos',
    value: '118',
    detail: 'Nos próximos 60 dias',
    trend: '+18 este mês',
    tone: 'neutral',
  },
  {
    id: 'receivable',
    label: 'A receber',
    value: 'R$ 76.420',
    detail: '31 parcelas em aberto',
    trend: '96,4% adimplência',
    tone: 'positive',
  },
]

export const upcomingTrips: UpcomingTrip[] = [
  {
    id: 'TRP-26091',
    customer: 'Marina Albuquerque',
    destination: 'Buenos Aires, AR',
    dateLabel: '03 out · 5 dias',
    passengers: 2,
    status: 'Confirmada',
    amount: 'R$ 6.480',
  },
  {
    id: 'TRP-26094',
    customer: 'Carlos Henrique',
    destination: 'Gramado, RS',
    dateLabel: '05 out · 4 dias',
    passengers: 3,
    status: 'Pendente',
    amount: 'R$ 7.920',
  },
  {
    id: 'TRP-26097',
    customer: 'Beatriz Monteiro',
    destination: 'Lisboa, PT',
    dateLabel: '08 out · 8 dias',
    passengers: 2,
    status: 'Confirmada',
    amount: 'R$ 18.700',
  },
  {
    id: 'TRP-26102',
    customer: 'Rafael e família',
    destination: 'Maceió, AL',
    dateLabel: '10 out · 6 dias',
    passengers: 4,
    status: 'Em viagem',
    amount: 'R$ 9.340',
  },
]

export const salesChannels: SalesChannel[] = [
  { id: 'consultant', label: 'Consultores', value: 64, share: '64%' },
  { id: 'whatsapp', label: 'WhatsApp', value: 22, share: '22%' },
  { id: 'site', label: 'Site', value: 10, share: '10%' },
  { id: 'referral', label: 'Indicações', value: 4, share: '4%' },
]

export const recentActivity: ActivityItem[] = [
  {
    id: 'ACT-01',
    title: 'Nova venda confirmada',
    description: 'Buenos Aires · Marina Albuquerque',
    time: 'Há 12 min',
    kind: 'sale',
  },
  {
    id: 'ACT-02',
    title: 'Pagamento identificado',
    description: 'Parcela #3 · Reserva TRP-26087',
    time: 'Há 38 min',
    kind: 'payment',
  },
  {
    id: 'ACT-03',
    title: 'Documentação recebida',
    description: 'Passaporte · Beatriz Monteiro',
    time: 'Há 1 h',
    kind: 'document',
  },
  {
    id: 'ACT-04',
    title: 'Prazo de cotação próximo',
    description: 'Gramado · Carlos Henrique',
    time: 'Há 2 h',
    kind: 'alert',
  },
]
