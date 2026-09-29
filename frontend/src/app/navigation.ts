import {
  BarChart3,
  CalendarDays,
  FileText,
  LayoutDashboard,
  MapPinned,
  ReceiptText,
  Settings,
  SuitcaseBusiness,
  Users,
  WalletCards,
} from 'lucide-react'

export const navigation = [
  { label: 'Visão geral', icon: LayoutDashboard },
  { label: 'Clientes', icon: Users },
  { label: 'Cotações', icon: FileText },
  { label: 'Viagens', icon: SuitcaseBusiness },
  { label: 'Reservas', icon: CalendarDays },
  { label: 'Destinos', icon: MapPinned },
  { label: 'Financeiro', icon: WalletCards },
  { label: 'Relatórios', icon: BarChart3 },
  { label: 'Documentos', icon: ReceiptText },
  { label: 'Configurações', icon: Settings },
] as const
