import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  FileText,
  Gauge,
  LayoutDashboard,
  MapPinned,
  Menu,
  Plane,
  Plus,
  ReceiptText,
  Search,
  Settings,
  Sparkles,
  SuitcaseBusiness,
  Users,
  WalletCards,
} from 'lucide-react'
import { useState } from 'react'
import {
  dashboardMetrics,
  recentActivity,
  salesChannels,
  upcomingTrips,
} from './data/dashboard'
import type { ActivityItem, TripStatus } from './types/dashboard'

const navigation = [
  { label: 'Visão geral', icon: LayoutDashboard, active: true },
  { label: 'Clientes', icon: Users },
  { label: 'Cotações', icon: FileText, badge: '27' },
  { label: 'Viagens', icon: SuitcaseBusiness },
  { label: 'Reservas', icon: CalendarDays },
  { label: 'Destinos', icon: MapPinned },
  { label: 'Financeiro', icon: WalletCards },
  { label: 'Relatórios', icon: Gauge },
]

const secondaryNavigation = [
  { label: 'Assistente', icon: Sparkles },
  { label: 'Configurações', icon: Settings },
]

const statusClass: Record<TripStatus, string> = {
  Confirmada: 'status status--confirmed',
  Pendente: 'status status--pending',
  'Em viagem': 'status status--traveling',
  Concluída: 'status status--done',
}

const activityIcon: Record<ActivityItem['kind'], typeof ReceiptText> = {
  sale: ReceiptText,
  payment: CircleDollarSign,
  document: FileText,
  alert: Bell,
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="brand-copy">
            <strong>Próximo Destino</strong>
            <small>Travel Operations</small>
          </div>
        </div>

        <nav className="navigation" aria-label="Navegação principal">
          <p className="nav-heading">Operação</p>
          {navigation.map(({ label, icon: Icon, active, badge }) => (
            <button
              className={`nav-item ${active ? 'nav-item--active' : ''}`}
              type="button"
              key={label}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {badge && <em>{badge}</em>}
            </button>
          ))}

          <p className="nav-heading nav-heading--secondary">Sistema</p>
          {secondaryNavigation.map(({ label, icon: Icon }) => (
            <button className="nav-item" type="button" key={label}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-avatar">PV</div>
          <div>
            <strong>Pedro Vinícius</strong>
            <small>Administrador</small>
          </div>
          <ChevronDown size={16} />
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          type="button"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            aria-label="Abrir menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Buscar"
              placeholder="Buscar cliente, viagem, reserva..."
            />
            <kbd>⌘ K</kbd>
          </div>

          <div className="topbar-actions">
            <button className="icon-button notification-button" type="button">
              <Bell size={19} />
              <span />
            </button>
            <button className="primary-button" type="button">
              <Plus size={18} />
              Nova cotação
            </button>
          </div>
        </header>

        <div className="dashboard">
          <section className="page-heading">
            <div>
              <p className="eyebrow">Terça-feira, 29 de setembro</p>
              <h1>Visão geral</h1>
              <p>Acompanhe a operação comercial e as próximas viagens.</p>
            </div>
            <button className="ghost-button" type="button">
              <CalendarDays size={17} />
              Setembro 2026
              <ChevronDown size={15} />
            </button>
          </section>

          <section className="metric-grid" aria-label="Indicadores principais">
            {dashboardMetrics.map((metric) => (
              <article className="metric-card" key={metric.id}>
                <div className="metric-top">
                  <span>{metric.label}</span>
                  <em className={`metric-trend metric-trend--${metric.tone}`}>
                    {metric.trend}
                  </em>
                </div>
                <strong>{metric.value}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </section>

          <section className="workspace-grid">
            <article className="panel panel--trips">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Operação</span>
                  <h2>Próximas viagens</h2>
                </div>
                <button className="text-button" type="button">
                  Ver todas
                </button>
              </div>

              <div className="trip-table">
                <div className="trip-row trip-row--head">
                  <span>Viajante</span>
                  <span>Destino</span>
                  <span>Embarque</span>
                  <span>Status</span>
                  <span>Valor</span>
                </div>

                {upcomingTrips.map((trip) => (
                  <button className="trip-row" type="button" key={trip.id}>
                    <span className="traveler-cell">
                      <span className="traveler-avatar">
                        {trip.customer
                          .split(' ')
                          .slice(0, 2)
                          .map((name) => name[0])
                          .join('')}
                      </span>
                      <span>
                        <strong>{trip.customer}</strong>
                        <small>
                          {trip.id} · {trip.passengers}{' '}
                          {trip.passengers === 1 ? 'viajante' : 'viajantes'}
                        </small>
                      </span>
                    </span>
                    <span>{trip.destination}</span>
                    <span>{trip.dateLabel}</span>
                    <span>
                      <em className={statusClass[trip.status]}>{trip.status}</em>
                    </span>
                    <span className="amount">{trip.amount}</span>
                  </button>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Comercial</span>
                  <h2>Canais de venda</h2>
                </div>
                <span className="panel-period">30 dias</span>
              </div>

              <div className="channel-chart">
                <div className="donut" aria-label="Distribuição de canais">
                  <div>
                    <strong>R$ 184k</strong>
                    <span>em vendas</span>
                  </div>
                </div>
                <div className="channel-list">
                  {salesChannels.map((channel) => (
                    <div className="channel-item" key={channel.id}>
                      <span className={`channel-dot channel-dot--${channel.id}`} />
                      <span>{channel.label}</span>
                      <strong>{channel.share}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="panel panel--activity">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Tempo real</span>
                  <h2>Atividade recente</h2>
                </div>
                <span className="live-indicator">
                  <i />
                  Ao vivo
                </span>
              </div>

              <div className="activity-list">
                {recentActivity.map((activity) => {
                  const Icon = activityIcon[activity.kind]
                  return (
                    <div className="activity-item" key={activity.id}>
                      <span className={`activity-icon activity-icon--${activity.kind}`}>
                        <Icon size={17} strokeWidth={1.8} />
                      </span>
                      <div>
                        <strong>{activity.title}</strong>
                        <p>{activity.description}</p>
                      </div>
                      <time>{activity.time}</time>
                    </div>
                  )
                })}
              </div>
            </article>

            <article className="panel insight-card">
              <div className="insight-icon">
                <Plane size={20} />
              </div>
              <span className="section-kicker">Próximo Destino Insights</span>
              <h2>Recife ganhou força nas cotações desta semana.</h2>
              <p>
                A procura cresceu 31% e o ticket médio está 8% abaixo da média
                dos últimos 60 dias.
              </p>
              <button type="button">
                Explorar oportunidade
                <span>→</span>
              </button>
            </article>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
