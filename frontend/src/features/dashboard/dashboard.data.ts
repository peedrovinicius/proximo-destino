export const metrics = [
  {
    label: 'Vendas no mês',
    value: 'R$ 184.650',
    helper: '42 viagens comercializadas',
    badge: '+12,8%',
  },
  {
    label: 'Cotações abertas',
    value: '27',
    helper: '9 aguardando retorno hoje',
    badge: '6 prioritárias',
  },
  {
    label: 'Embarques próximos',
    value: '18',
    helper: 'Nos próximos 7 dias',
    badge: '4 hoje',
  },
  {
    label: 'A receber',
    value: 'R$ 76.420',
    helper: '31 parcelas em aberto',
    badge: '96,4% adimplência',
  },
] as const

export const trips = [
  {
    code: 'PD-26091',
    customer: 'Marina Albuquerque',
    destination: 'Buenos Aires',
    date: '03 out',
    passengers: 2,
    status: 'Confirmada',
    amount: 'R$ 6.480',
  },
  {
    code: 'PD-26094',
    customer: 'Carlos Henrique',
    destination: 'Gramado',
    date: '05 out',
    passengers: 3,
    status: 'Pendente',
    amount: 'R$ 7.920',
  },
  {
    code: 'PD-26097',
    customer: 'Beatriz Monteiro',
    destination: 'Lisboa',
    date: '08 out',
    passengers: 2,
    status: 'Confirmada',
    amount: 'R$ 18.700',
  },
  {
    code: 'PD-26102',
    customer: 'Rafael e família',
    destination: 'Maceió',
    date: '10 out',
    passengers: 4,
    status: 'Em viagem',
    amount: 'R$ 9.340',
  },
] as const

export const pipeline = [
  { label: 'Novos contatos', value: 14 },
  { label: 'Cotação enviada', value: 9 },
  { label: 'Negociação', value: 6 },
  { label: 'Fechamento', value: 4 },
] as const
