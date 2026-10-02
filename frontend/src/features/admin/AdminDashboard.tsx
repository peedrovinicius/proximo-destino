import {
  ArrowLeft,
  Bell,
  CalendarHeart,
  CircleDollarSign,
  FileText,
  Gift,
  Globe2,
  CreditCard,
  ChevronDown,
  ExternalLink,
  Settings,
  CheckCircle2,
  LogOut,
  Bus,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Brand } from '../../components/Brand'
import { FinanceWorkspace, QuotesWorkspace } from './CommercialWorkspace'
import { AdminSeatMapDialog } from './AdminSeatMap'
import { ReservationPassengersDialog } from './ReservationPassengersDialog'
import { ReservationCancelDialog } from './ReservationCancelDialog'
import { ReservationBonusDialog } from './ReservationBonusDialog'
import { ReservationFinanceDialog } from './ReservationFinanceDialog'
import { ClientBonusDialog } from './ClientBonusDialog'
import { ClientDataDialog } from './ClientDataDialog'
import { TripBoardingDialog } from './TripBoardingDialog'
import { TripAuditDialog } from './TripAuditDialog'
import { TripPhotoPicker } from './TripPhotoPicker'
import {
  adminApi,
  adminTripImageUrl,
  type AdminClient,
  type AdminPaymentsDashboard,
  type AdminPurchaseOrder,
  type AdminReservation,
  type AdminTrip,
  type BusTemplateOption,
  type DashboardData,
  type SeatLayout,
  type PaymentConnectionStatus,
  type SearchResult,
  type VehicleFeature,
} from '../../lib/adminApi'
import { openWhatsApp, openWhatsAppTo } from '../../lib/whatsapp'
import { cpfDigits, formatCpf, isValidCpf } from '../../lib/cpf'

type AdminDashboardProps = {
  accessToken: string
  onExitToSite: () => void
  onLogout: () => void
}

type Tab = 'overview' | 'clients' | 'trips' | 'reservations' | 'quotes' | 'payments' | 'finance' | 'settings'

const adminTabs = new Set<Tab>([
  'overview',
  'clients',
  'trips',
  'reservations',
  'quotes',
  'payments',
  'finance',
  'settings',
])

function tabFromLocation(): Tab {
  const params = new URLSearchParams(window.location.search)
  if (params.has('paymentConnection')) return 'settings'
  const value = params.get('tab')
  return value && adminTabs.has(value as Tab) ? (value as Tab) : 'overview'
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })

function roleFromToken(token: string) {
  try {
    const payload = token.split('.')[1]
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return (JSON.parse(atob(padded)) as { role?: string }).role ?? null
  } catch {
    return null
  }
}

export function AdminDashboard({
  accessToken,
  onExitToSite,
  onLogout,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<Tab>(() => tabFromLocation())
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [trips, setTrips] = useState<AdminTrip[]>([])
  const [reservations, setReservations] = useState<AdminReservation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [pendingPaymentCount, setPendingPaymentCount] = useState(0)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const scrollPositions = useRef<Partial<Record<Tab, number>>>({})
  const userRole = useMemo(() => roleFromToken(accessToken), [accessToken])
  const isAdmin = userRole === 'ADMIN'
  const canViewPayments = userRole === 'ADMIN' || userRole === 'FINANCE'

  function navigateTab(next: Tab, replace = false) {
    if (next === tab) {
      setAccountMenuOpen(false)
      return
    }

    scrollPositions.current[tab] = window.scrollY

    const url = new URL(window.location.href)
    url.searchParams.set('screen', 'admin')
    url.searchParams.set('tab', next)
    url.searchParams.delete('paymentConnection')
    window.history[replace ? 'replaceState' : 'pushState'](
      { screen: 'admin', tab: next },
      '',
      url,
    )

    setTab(next)
    setSearchResult(null)
    setAccountMenuOpen(false)

    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: scrollPositions.current[next] ?? 0,
        behavior: 'auto',
      })
    })
  }

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [dashboardData, clientData, tripData, reservationData, paymentsData] = await Promise.all([
        adminApi.dashboard(accessToken),
        adminApi.clients(accessToken),
        adminApi.trips(accessToken),
        adminApi.reservations(accessToken),
        canViewPayments
          ? adminApi.purchaseOrders(accessToken).catch(() => null)
          : Promise.resolve(null),
      ])
      setDashboard(dashboardData)
      setClients(clientData)
      setTrips(tripData)
      setReservations(reservationData)
      setPendingPaymentCount(paymentsData?.summary.pendingOrders ?? 0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o painel.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('screen')) {
      url.searchParams.set('screen', 'admin')
    }
    if (!url.searchParams.has('tab')) {
      url.searchParams.set('tab', tab)
    }
    window.history.replaceState({ screen: 'admin', tab }, '', url)
  }, [])

  useEffect(() => {
    function onPopState() {
      const next = tabFromLocation()
      scrollPositions.current[tab] = window.scrollY
      setTab(next)
      setSearchResult(null)
      setAccountMenuOpen(false)
      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: scrollPositions.current[next] ?? 0,
          behavior: 'auto',
        })
      })
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [tab])

  useEffect(() => {
    if (
      (!isAdmin && tab === 'settings') ||
      (!canViewPayments && tab === 'payments')
    ) {
      navigateTab('overview', true)
    }
  }, [canViewPayments, isAdmin, tab])

  useEffect(() => {
    if (tab !== 'settings') return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('paymentConnection')) return
    url.searchParams.delete('paymentConnection')
    url.searchParams.set('screen', 'admin')
    url.searchParams.set('tab', 'settings')
    window.history.replaceState(
      { screen: 'admin', tab: 'settings' },
      '',
      url,
    )
  }, [tab])

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searchQuery.trim().length < 2) {
      setSearchResult(null)
      return
    }

    try {
      setSearchResult(await adminApi.search(accessToken, searchQuery))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha na busca.')
    }
  }

  const metrics = useMemo(() => [
    { label: 'Clientes cadastrados', value: dashboard?.metrics.clients ?? 0, icon: Users },
    { label: 'Reservas pendentes', value: dashboard?.metrics.pendingReservations ?? 0, icon: FileText },
    { label: 'Viagens ativas/programadas', value: dashboard?.metrics.activeTrips ?? 0, icon: Bus },
    { label: 'Reservas confirmadas', value: dashboard?.metrics.confirmedReservations ?? 0, icon: CircleDollarSign },
  ], [dashboard])

  const upcomingTripsCount = useMemo(() => {
    const now = Date.now()
    const limit = now + 7 * 86_400_000
    return trips.filter((trip) => {
      const departure = new Date(trip.departureDate).getTime()
      return (
        departure >= now &&
        departure <= limit &&
        trip.status !== 'CANCELLED' &&
        trip.status !== 'COMPLETED'
      )
    }).length
  }, [trips])

  const upcomingBirthdaysCount = useMemo(
    () => dashboard?.birthdays.filter((item) => item.daysUntil <= 7).length ?? 0,
    [dashboard],
  )

  const notificationCount =
    (dashboard?.metrics.pendingReservations ?? 0) +
    pendingPaymentCount +
    upcomingTripsCount +
    upcomingBirthdaysCount

  async function toggleNotifications() {
    const next = !notificationsOpen
    setNotificationsOpen(next)
    setAccountMenuOpen(false)
    if (!next || !canViewPayments) return

    setNotificationsLoading(true)
    try {
      const payments = await adminApi.purchaseOrders(accessToken)
      setPendingPaymentCount(payments.summary.pendingOrders)
    } catch {
      // mantém as demais notificações disponíveis
    } finally {
      setNotificationsLoading(false)
    }
  }

  function openNotificationTab(next: Tab) {
    setNotificationsOpen(false)
    navigateTab(next)
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Brand compact />

        <nav className="admin-nav" aria-label="Administração">
          <button className={tab === 'overview' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('overview')} type="button">Visão geral</button>
          <button className={tab === 'clients' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('clients')} type="button">Clientes</button>
          <button className={tab === 'trips' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('trips')} type="button">Viagens</button>
          <button className={tab === 'reservations' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('reservations')} type="button">Reservas</button>
          <button className={tab === 'quotes' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('quotes')} type="button">Cotações</button>
          {canViewPayments ? (
            <button className={tab === 'payments' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('payments')} type="button">Pagamentos</button>
          ) : null}
          <button className={tab === 'finance' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('finance')} type="button">Financeiro</button>
          {isAdmin ? (
            <button className={tab === 'settings' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('settings')} type="button">Configurações</button>
          ) : null}
        </nav>

        <div className="admin-actions">
          <form className="admin-search" onSubmit={handleSearch}>
            <Search size={16} />
            <input
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                if (!event.target.value) setSearchResult(null)
              }}
              placeholder="Buscar cliente, viagem ou reserva..."
            />
          </form>
          <div className="admin-notifications">
            <button
              className="round-action"
              type="button"
              aria-label="Notificações"
              aria-expanded={notificationsOpen}
              onClick={() => void toggleNotifications()}
            >
              <Bell size={17} />
              {notificationCount > 0 ? (
                <span className="admin-notification-badge">
                  {notificationCount > 99 ? '99+' : notificationCount}
                </span>
              ) : null}
            </button>

            {notificationsOpen ? (
              <div className="admin-notification-menu">
                <div className="admin-notification-menu-head">
                  <div>
                    <strong>Notificações</strong>
                    <span>Pendências e próximos eventos da operação.</span>
                  </div>
                  <button type="button" onClick={() => setNotificationsOpen(false)}>
                    Fechar
                  </button>
                </div>

                {dashboard?.metrics.pendingReservations ? (
                  <button type="button" onClick={() => openNotificationTab('reservations')}>
                    <FileText size={16} />
                    <div>
                      <strong>{dashboard.metrics.pendingReservations} reserva(s) aguardando</strong>
                      <span>Revisar solicitações e confirmar atendimento.</span>
                    </div>
                  </button>
                ) : null}

                {canViewPayments && pendingPaymentCount > 0 ? (
                  <button type="button" onClick={() => openNotificationTab('payments')}>
                    <CreditCard size={16} />
                    <div>
                      <strong>{pendingPaymentCount} pagamento(s) pendente(s)</strong>
                      <span>Pedidos aguardando confirmação financeira.</span>
                    </div>
                  </button>
                ) : null}

                {upcomingTripsCount > 0 ? (
                  <button type="button" onClick={() => openNotificationTab('trips')}>
                    <Bus size={16} />
                    <div>
                      <strong>{upcomingTripsCount} viagem(ns) nos próximos 7 dias</strong>
                      <span>Conferir assentos, passageiros e embarque.</span>
                    </div>
                  </button>
                ) : null}

                {upcomingBirthdaysCount > 0 ? (
                  <button type="button" onClick={() => openNotificationTab('clients')}>
                    <CalendarHeart size={16} />
                    <div>
                      <strong>{upcomingBirthdaysCount} aniversário(s) nesta semana</strong>
                      <span>Oportunidade de relacionamento com clientes.</span>
                    </div>
                  </button>
                ) : null}

                {notificationsLoading ? (
                  <span className="admin-notification-loading">
                    Atualizando pagamentos...
                  </span>
                ) : notificationCount === 0 ? (
                  <span className="admin-notification-empty">
                    Nenhuma pendência importante agora.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            className="admin-site-return"
            type="button"
            onClick={onExitToSite}
            title="Voltar ao site sem sair"
          >
            <ArrowLeft size={15} />
            <span>Site</span>
          </button>
          <div className="admin-account">
            <button
              className="admin-avatar"
              type="button"
              onClick={() => {
                setNotificationsOpen(false)
                setAccountMenuOpen((open) => !open)
              }}
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              title="Minha conta"
            >
              PV
              <ChevronDown size={12} />
            </button>
            {accountMenuOpen ? (
              <div className="admin-account-menu" role="menu">
                <div className="admin-account-menu-head">
                  <strong>Área administrativa</strong>
                  <span>Sessão protegida e renovada automaticamente</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={onExitToSite}
                >
                  <Globe2 size={15} />
                  Voltar ao site
                  <small>Sem encerrar a sessão</small>
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateTab('settings')}
                  >
                    <Settings size={15} />
                    Configurações
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={onLogout}
                >
                  <LogOut size={15} />
                  Sair da conta
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-heading">
          <div>
            <span className="eyebrow">Operação da agência</span>
            <h1>Próximo Destino</h1>
            <p>Dados carregados diretamente do PostgreSQL de produção.</p>
          </div>
          <div className="security-pill"><ShieldCheck size={16} /> Ambiente administrativo protegido</div>
        </section>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}
        {loading ? <div className="admin-loading">Carregando dados operacionais...</div> : null}

        {searchResult ? (
          <section className="admin-search-results">
            <div className="admin-panel-heading">
              <div><span className="eyebrow">Busca global</span><h2>Resultados para “{searchQuery}”</h2></div>
              <button type="button" onClick={() => setSearchResult(null)}>Fechar</button>
            </div>
            <div className="admin-search-columns">
              <div>
                <strong>Clientes</strong>
                {searchResult.clients.length ? searchResult.clients.map((item) => (
                  <button type="button" className="admin-search-result-link" key={item.id} onClick={() => navigateTab('clients')}>
                    {item.fullName}<small>{item.email || item.phone || 'Sem contato'}</small>
                  </button>
                )) : <em>Nenhum resultado</em>}
              </div>
              <div>
                <strong>Viagens</strong>
                {searchResult.trips.length ? searchResult.trips.map((item) => (
                  <button type="button" className="admin-search-result-link" key={item.id} onClick={() => navigateTab('trips')}>
                    {item.title}<small>{item.origin} → {item.destination}</small>
                  </button>
                )) : <em>Nenhum resultado</em>}
              </div>
              <div>
                <strong>Reservas</strong>
                {searchResult.reservations.length ? searchResult.reservations.map((item) => (
                  <button type="button" className="admin-search-result-link" key={item.id} onClick={() => navigateTab('reservations')}>
                    {item.client.fullName}<small>{item.trip.title} · {item.status}</small>
                  </button>
                )) : <em>Nenhum resultado</em>}
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'overview' && dashboard ? (
          <>
            <section className="admin-metrics">
              {metrics.map(({ label, value, icon: Icon }) => (
                <article className="admin-metric" key={label}>
                  <span className="admin-metric-icon"><Icon size={20} /></span>
                  <div><small>{label}</small><strong>{value}</strong></div>
                </article>
              ))}
            </section>

            <section className="admin-grid">
              <article className="admin-panel birthday-panel">
                <div className="admin-panel-heading">
                  <div><span className="eyebrow">Relacionamento</span><h2>Próximos aniversários</h2></div>
                  <CalendarHeart size={21} />
                </div>
                <div className="birthday-list">
                  {dashboard.birthdays.length ? dashboard.birthdays.map((birthday) => (
                    <div className="birthday-row" key={birthday.id}>
                      <span className="birthday-avatar"><Gift size={16} /></span>
                      <div>
                        <strong>{birthday.fullName}</strong>
                        <span>{birthday.daysUntil === 0 ? 'Hoje' : `Em ${birthday.daysUntil} dias`}{birthday.phone ? ` · ${birthday.phone}` : ''}</span>
                      </div>
                      {birthday.phone ? (
                        <button type="button" onClick={() => openWhatsApp(`Olá, ${birthday.fullName}! A Próximo Destino deseja um feliz aniversário e muitas novas viagens!`)}>Mensagem</button>
                      ) : null}
                    </div>
                  )) : <p className="admin-empty">Nenhum aniversário nos próximos 30 dias.</p>}
                </div>
              </article>

              <article className="admin-panel security-panel">
                <div className="admin-panel-heading">
                  <div><span className="eyebrow">Segurança</span><h2>Controles ativos</h2></div>
                  <ShieldCheck size={21} />
                </div>
                <div className="security-checklist">
                  <span><ShieldCheck size={15} /> MFA obrigatório para administrador</span>
                  <span><ShieldCheck size={15} /> Sessões revogáveis por dispositivo</span>
                  <span><ShieldCheck size={15} /> RBAC aplicado na API</span>
                  <span><ShieldCheck size={15} /> Auditoria de autenticação ativa</span>
                  <span><ShieldCheck size={15} /> PostgreSQL separado no Neon</span>
                </div>
              </article>
            </section>
          </>
        ) : null}

        {tab === 'clients' ? (
          <ClientsView accessToken={accessToken} clients={clients} onChanged={reload} />
        ) : null}

        {tab === 'trips' ? (
          <TripsView
            accessToken={accessToken}
            trips={trips}
            canManageSeats={isAdmin}
            onChanged={reload}
          />
        ) : null}

        {tab === 'reservations' ? (
          <ReservationsView
            accessToken={accessToken}
            clients={clients}
            trips={trips}
            reservations={reservations}
            canManagePassengers={isAdmin}
            canViewFinance={canViewPayments}
            onChanged={reload}
          />
        ) : null}

        {tab === 'quotes' ? (
          <QuotesWorkspace accessToken={accessToken} reservations={reservations} />
        ) : null}

        {tab === 'payments' && canViewPayments ? (
          <PaymentsWorkspace accessToken={accessToken} />
        ) : null}

        {tab === 'finance' ? (
          <FinanceWorkspace accessToken={accessToken} />
        ) : null}

        {tab === 'settings' && isAdmin ? (
          <PaymentSettings accessToken={accessToken} />
        ) : null}
      </main>
    </div>
  )
}

function paymentStatusLabel(status: AdminPurchaseOrder['status']) {
  if (status === 'PAID') return 'Pago'
  if (status === 'PENDING_PAYMENT') return 'Aguardando'
  if (status === 'PARTIALLY_REFUNDED') return 'Estorno parcial'
  if (status === 'REFUNDED') return 'Estornado'
  if (status === 'EXPIRED') return 'Expirado'
  return 'Cancelado'
}

function paymentMethodLabel(method: AdminPurchaseOrder['paymentMethod']) {
  if (method === 'CARD') return 'Cartão'
  if (method === 'PIX') return 'PIX'
  if (method === 'BOLETO') return 'Boleto'
  return 'Transferência'
}

function PaymentsWorkspace({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<AdminPaymentsDashboard | null>(null)
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminPurchaseOrder['status']>('ALL')
  const [methodFilter, setMethodFilter] = useState<'ALL' | AdminPurchaseOrder['paymentMethod']>('ALL')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setData(await adminApi.purchaseOrders(accessToken))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar pagamentos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [accessToken])

  const orders = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return (data?.orders ?? []).filter((order) => {
      if (statusFilter !== 'ALL' && order.status !== statusFilter) return false
      if (methodFilter !== 'ALL' && order.paymentMethod !== methodFilter) return false
      if (!normalized) return true

      return [
        order.id,
        order.reservation.id,
        order.reservation.client.fullName,
        order.reservation.client.email ?? '',
        order.reservation.client.phone ?? '',
        order.reservation.trip.title,
        order.reservation.trip.origin,
        order.reservation.trip.destination,
      ].some((value) => value.toLowerCase().includes(normalized))
    })
  }, [data, methodFilter, query, statusFilter])

  const summary = data?.summary

  return (
    <section className="admin-payments-workspace">
      <div className="admin-payments-heading">
        <div>
          <span className="eyebrow">Compra online</span>
          <h2>Pagamentos</h2>
          <p>Pedidos criados pelo fluxo de compra com PIX e cartão.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {error ? <div className="admin-error" role="alert">{error}</div> : null}

      <div className="admin-payment-metrics">
        <article>
          <small>Recebido</small>
          <strong>{money.format((summary?.paidCents ?? 0) / 100)}</strong>
          <span>{summary?.paidOrders ?? 0} pagos</span>
        </article>
        <article>
          <small>Pendente</small>
          <strong>{money.format((summary?.pendingCents ?? 0) / 100)}</strong>
          <span>{summary?.pendingOrders ?? 0} aguardando</span>
        </article>
        <article>
          <small>Pedidos</small>
          <strong>{summary?.totalOrders ?? 0}</strong>
          <span>{(summary?.cancelledOrders ?? 0) + (summary?.expiredOrders ?? 0) + (summary?.refundedOrders ?? 0)} encerrados</span>
        </article>
        <article>
          <small>Estornado</small>
          <strong>{money.format((summary?.refundedCents ?? 0) / 100)}</strong>
          <span>{summary?.refundedOrders ?? 0} estorno(s) total(is)</span>
        </article>
      </div>

      <div className="admin-payment-filters">
        <label>
          <span>Buscar</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cliente, viagem, reserva ou pedido"
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          >
            <option value="ALL">Todos</option>
            <option value="PENDING_PAYMENT">Aguardando</option>
            <option value="PAID">Pago</option>
            <option value="PARTIALLY_REFUNDED">Estorno parcial</option>
            <option value="REFUNDED">Estornado</option>
            <option value="CANCELLED">Cancelado</option>
            <option value="EXPIRED">Expirado</option>
          </select>
        </label>

        <label>
          <span>Método</span>
          <select
            value={methodFilter}
            onChange={(event) => setMethodFilter(event.target.value as typeof methodFilter)}
          >
            <option value="ALL">Todos</option>
            <option value="PIX">PIX</option>
            <option value="CARD">Cartão</option>
            <option value="BOLETO">Boleto</option>
            <option value="TRANSFER">Transferência</option>
          </select>
        </label>
      </div>

      <article className="admin-payment-list">
        <div className="admin-payment-list-head">
          <span>Cliente / viagem</span>
          <span>Pagamento</span>
          <span>Reserva</span>
          <span>Valor</span>
          <span>Status</span>
        </div>

        {loading ? (
          <p className="admin-empty">Carregando pagamentos...</p>
        ) : orders.length ? orders.map((order) => (
          <div className="admin-payment-row" key={order.id}>
            <div className="admin-payment-main">
              <strong>{order.reservation.client.fullName}</strong>
              <span>{order.reservation.trip.title}</span>
              <small>
                {date.format(new Date(order.reservation.trip.departureDate))}
                {' · '}
                {order.reservation.trip.origin} → {order.reservation.trip.destination}
              </small>
            </div>

            <div>
              <strong>{paymentMethodLabel(order.paymentMethod)}</strong>
              <span>{order.passengerCount} passageiro{order.passengerCount === 1 ? '' : 's'}</span>
              <small>{date.format(new Date(order.createdAt))}</small>
            </div>

            <div>
              <strong>#{order.reservation.id.slice(-8).toUpperCase()}</strong>
              <span>
                {order.reservation.seatAssignments.length
                  ? 'Assentos ' + order.reservation.seatAssignments.map((seat) => seat.seatNumber).join(', ')
                  : 'Sem assento definido'}
              </span>
              <small>{order.reservation.status}</small>
            </div>

            <div className="admin-payment-value">
              <strong>{money.format(order.totalCents / 100)}</strong>
              <span>{money.format(order.unitPriceCents / 100)} por passageiro</span>
            </div>

            <div className="admin-payment-status-actions">
              <span className={'admin-payment-status admin-payment-status--' + order.status.toLowerCase()}>
                {paymentStatusLabel(order.status)}
              </span>
              {order.reservation.client.phone ? (
                <button
                  type="button"
                  className="admin-payment-whatsapp"
                  onClick={() =>
                    openWhatsAppTo(
                      order.reservation.client.phone!,
                      order.status === 'PAID'
                        ? `Olá, ${order.reservation.client.fullName}! Recebemos seu pagamento de ${money.format(order.totalCents / 100)} referente a ${order.reservation.trip.title}. Sua reserva está registrada com a Próximo Destino.`
                        : `Olá, ${order.reservation.client.fullName}! Seu pagamento de ${money.format(order.totalCents / 100)} para ${order.reservation.trip.title} ainda está ${order.status === 'PENDING_PAYMENT' ? 'aguardando confirmação' : 'encerrado'}. Se precisar de ajuda, fale conosco.`,
                    )
                  }
                >
                  WhatsApp
                </button>
              ) : null}
            </div>
          </div>
        )) : (
          <p className="admin-empty">Nenhum pagamento encontrado.</p>
        )}
      </article>
    </section>
  )
}

function ClientsView({
  accessToken,
  clients,
  onChanged,
}: {
  accessToken: string
  clients: AdminClient[]
  onChanged: () => Promise<void>
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [cpf, setCpf] = useState('')
  const [saving, setSaving] = useState(false)
  const [clientError, setClientError] = useState('')
  const [bonusClientId, setBonusClientId] = useState<string | null>(null)
  const [dataClientId, setDataClientId] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedCpf = cpfDigits(cpf)
    if (normalizedCpf && !isValidCpf(normalizedCpf)) {
      setClientError('Informe um CPF válido.')
      return
    }

    setSaving(true)
    setClientError('')
    try {
      await adminApi.createClient(accessToken, {
        fullName,
        email: email || undefined,
        phone: phone || undefined,
        birthDate: birthDate ? `${birthDate}T12:00:00.000Z` : undefined,
        document: normalizedCpf || undefined,
      })
      setFullName('')
      setEmail('')
      setPhone('')
      setBirthDate('')
      setCpf('')
      await onChanged()
    } catch (cause) {
      setClientError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível cadastrar o cliente.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-workspace">
      <form className="admin-form-panel" onSubmit={submit}>
        <div><span className="eyebrow">Novo cadastro</span><h2>Cliente</h2></div>
        {clientError ? <div className="admin-error" role="alert">{clientError}</div> : null}
        <input placeholder="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input
          placeholder="CPF"
          value={cpf}
          onChange={(e) => setCpf(formatCpf(e.target.value))}
          inputMode="numeric"
          maxLength={14}
        />
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Telefone / WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        <button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Cadastrar cliente'}</button>
      </form>

      <article className="admin-data-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">Base real</span><h2>Clientes</h2></div><strong>{clients.length}</strong></div>
        <div className="admin-table">
          {clients.length ? clients.map((client) => (
            <div className="admin-table-row admin-table-row--client" key={client.id}>
              <div>
                <strong>{client.fullName}</strong>
                <span>
                  {client.document ? `CPF ${formatCpf(client.document)} · ` : 'CPF não informado · '}
                  {client.email || 'Sem e-mail'} · {client.phone || 'Sem telefone'}
                </span>
              </div>
              <span>{client._count.companions} acompanhantes</span>
              <div className="admin-client-row-actions">
                <button
                  type="button"
                  className="admin-client-data-button"
                  onClick={() => setDataClientId(client.id)}
                >
                  Dados
                </button>
                <button
                  type="button"
                  className="admin-client-bonus-button"
                  onClick={() => setBonusClientId(client.id)}
                >
                  Bônus {money.format(client.bonusBalanceCents / 100)}
                </button>
              </div>
            </div>
          )) : <p className="admin-empty">Nenhum cliente cadastrado ainda.</p>}
        </div>
      </article>

      {bonusClientId ? (
        <ClientBonusDialog
          accessToken={accessToken}
          clientId={bonusClientId}
          onClose={() => setBonusClientId(null)}
          onChanged={onChanged}
        />
      ) : null}

      {dataClientId ? (
        <ClientDataDialog
          accessToken={accessToken}
          clientId={dataClientId}
          onClose={() => setDataClientId(null)}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  )
}

const vehicleFeatureLabels: Record<VehicleFeature['type'], string> = {
  RESTROOM: 'Banheiro',
  DOOR: 'Porta',
  STAIRS: 'Escada',
}

function defaultFeature(type: VehicleFeature['type']): VehicleFeature {
  if (type === 'RESTROOM') {
    return { type, deck: 1, position: 'REAR', side: 'RIGHT' }
  }
  if (type === 'STAIRS') {
    return { type, deck: 1, position: 'MIDDLE', side: 'CENTER' }
  }
  return { type, deck: 1, position: 'FRONT', side: 'RIGHT' }
}

function parseBlockedSeatsInput(value: string, capacity: number) {
  if (!value.trim()) return [] as number[]

  const values = value
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)

  if (
    values.some(
      (seat) =>
        !Number.isInteger(seat) ||
        seat < 1 ||
        seat > capacity,
    )
  ) {
    return null
  }

  return [...new Set(values)].sort((a, b) => a - b)
}

function VehicleConfigurationFields({
  deckCount,
  features,
  onFeaturesChange,
  blockedSeats,
  onBlockedSeatsChange,
}: {
  deckCount: 1 | 2
  features: VehicleFeature[]
  onFeaturesChange: (features: VehicleFeature[]) => void
  blockedSeats: string
  onBlockedSeatsChange: (value: string) => void
}) {
  const types: VehicleFeature['type'][] =
    deckCount === 2
      ? ['RESTROOM', 'DOOR', 'STAIRS']
      : ['RESTROOM', 'DOOR']

  function toggle(type: VehicleFeature['type'], enabled: boolean) {
    if (!enabled) {
      onFeaturesChange(features.filter((feature) => feature.type !== type))
      return
    }

    if (!features.some((feature) => feature.type === type)) {
      onFeaturesChange([...features, defaultFeature(type)])
    }
  }

  function patch(
    type: VehicleFeature['type'],
    next: Partial<VehicleFeature>,
  ) {
    onFeaturesChange(
      features.map((feature) =>
        feature.type === type ? { ...feature, ...next } : feature,
      ),
    )
  }

  return (
    <div className="admin-vehicle-config">
      <div className="admin-vehicle-config-heading">
        <div>
          <strong>Configuração interna</strong>
          <span>Posicione instalações e bloqueie lugares que não podem ser vendidos.</span>
        </div>
        <small>{deckCount === 2 ? '2 andares' : '1 andar'}</small>
      </div>

      <div className="admin-vehicle-features">
        {types.map((type) => {
          const feature = features.find((item) => item.type === type)
          const enabled = Boolean(feature)

          return (
            <div className="admin-vehicle-feature-row" key={type}>
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => toggle(type, event.target.checked)}
                />
                <span>{vehicleFeatureLabels[type]}</span>
              </label>

              {feature ? (
                <div className="admin-vehicle-feature-position">
                  {deckCount === 2 ? (
                    <select
                      value={feature.deck}
                      onChange={(event) =>
                        patch(type, { deck: Number(event.target.value) as 1 | 2 })
                      }
                      aria-label={'Andar de ' + vehicleFeatureLabels[type]}
                    >
                      <option value={1}>Piso inferior</option>
                      <option value={2}>Piso superior</option>
                    </select>
                  ) : null}

                  <select
                    value={feature.position}
                    onChange={(event) =>
                      patch(type, {
                        position: event.target.value as VehicleFeature['position'],
                      })
                    }
                    aria-label={'Zona de ' + vehicleFeatureLabels[type]}
                  >
                    <option value="FRONT">Frente</option>
                    <option value="MIDDLE">Meio</option>
                    <option value="REAR">Traseira</option>
                  </select>

                  <select
                    value={feature.side}
                    onChange={(event) =>
                      patch(type, {
                        side: event.target.value as VehicleFeature['side'],
                      })
                    }
                    aria-label={'Lado de ' + vehicleFeatureLabels[type]}
                  >
                    <option value="LEFT">Esquerda</option>
                    <option value="CENTER">Centro</option>
                    <option value="RIGHT">Direita</option>
                  </select>
                </div>
              ) : (
                <span className="admin-vehicle-feature-off">Não exibido no mapa</span>
              )}
            </div>
          )
        })}
      </div>

      <label className="admin-blocked-seats-field">
        <span>Assentos bloqueados</span>
        <input
          value={blockedSeats}
          onChange={(event) => onBlockedSeatsChange(event.target.value)}
          inputMode="numeric"
          placeholder="Ex.: 5, 6, 21"
        />
        <small>Números separados por vírgula. Eles aparecem como bloqueados e não podem ser reservados.</small>
      </label>
    </div>
  )
}

function TripsView({
  accessToken,
  trips,
  canManageSeats,
  onChanged,
}: {
  accessToken: string
  trips: AdminTrip[]
  canManageSeats: boolean
  onChanged: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [departureDate, setDepartureDate] = useState('')
  const [price, setPrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [pendingImage, setPendingImage] = useState<{
    blob: Blob
    filename: string
    previewUrl: string
  } | null>(null)
  const [busTemplates, setBusTemplates] = useState<BusTemplateOption[]>([])
  const [busTemplate, setBusTemplate] = useState('')
  const [capacity, setCapacity] = useState('')
  const [seatLayout, setSeatLayout] = useState<SeatLayout>('TWO_BY_TWO')
  const [deckCount, setDeckCount] = useState<1 | 2>(1)
  const [lowerDeckCapacity, setLowerDeckCapacity] = useState('')
  const [vehicleFeatures, setVehicleFeatures] = useState<VehicleFeature[]>([])
  const [blockedSeats, setBlockedSeats] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true

    void adminApi.busTemplates(accessToken)
      .then((templates) => {
        if (active) setBusTemplates(templates)
      })
      .catch(() => {
        if (active) setBusTemplates([])
      })

    return () => {
      active = false
    }
  }, [accessToken])

  const selectedTemplate = busTemplates.find((template) => template.key === busTemplate)
  const effectiveCapacity =
    busTemplate === 'CUSTOM'
      ? Number(capacity)
      : selectedTemplate?.capacity ?? 0
  const effectiveDeckCount =
    busTemplate === 'CUSTOM'
      ? deckCount
      : selectedTemplate?.deckCount ?? 1

  function chooseTemplate(next: string) {
    setBusTemplate(next)
    setBlockedSeats('')

    const option = busTemplates.find((template) => template.key === next)
    if (!option) {
      setCapacity('')
      setSeatLayout('TWO_BY_TWO')
      setDeckCount(1)
      setLowerDeckCapacity('')
      setVehicleFeatures([])
      return
    }

    if (option.key === 'CUSTOM') {
      setCapacity('')
      setSeatLayout('TWO_BY_TWO')
      setDeckCount(1)
      setLowerDeckCapacity('')
      setVehicleFeatures([])
      return
    }

    setCapacity(option.capacity?.toString() ?? '')
    setSeatLayout(option.seatLayout ?? 'TWO_BY_TWO')
    setDeckCount(option.deckCount ?? 1)
    setLowerDeckCapacity(option.lowerDeckCapacity?.toString() ?? '')
    setVehicleFeatures(option.defaultFeatures)
  }

  function changeDecks(next: 1 | 2) {
    setDeckCount(next)
    if (next === 1) {
      setLowerDeckCapacity('')
      setVehicleFeatures(
        vehicleFeatures
          .filter((feature) => feature.type !== 'STAIRS')
          .map((feature) => ({ ...feature, deck: 1 as const })),
      )
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (busTemplate === 'CUSTOM') {
      const parsed = Number(capacity)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 80) return

      if (deckCount === 2) {
        const lower = Number(lowerDeckCapacity)
        if (!Number.isInteger(lower) || lower < 1 || lower >= parsed) return
      }
    }

    const normalizedBlocked =
      busTemplate && effectiveCapacity
        ? parseBlockedSeatsInput(blockedSeats, effectiveCapacity)
        : []

    if (normalizedBlocked === null) return

    setSaving(true)
    try {
      const created = await adminApi.createTrip(accessToken, {
        title,
        origin,
        destination,
        departureDate: new Date(departureDate + 'T12:00:00').toISOString(),
        status: 'SCHEDULED',
        busTemplate: busTemplate || undefined,
        capacity: busTemplate === 'CUSTOM' ? Number(capacity) : undefined,
        seatLayout: busTemplate === 'CUSTOM' ? seatLayout : undefined,
        deckCount: busTemplate === 'CUSTOM' ? deckCount : undefined,
        lowerDeckCapacity:
          busTemplate === 'CUSTOM' && deckCount === 2
            ? Number(lowerDeckCapacity)
            : undefined,
        vehicleFeatures: busTemplate ? vehicleFeatures : undefined,
        blockedSeats: busTemplate ? normalizedBlocked : undefined,
        priceCents: price ? Math.round(Number(price.replace(',', '.')) * 100) : undefined,
        imageUrl: imageUrl.trim() || undefined,
      })

      if (pendingImage) {
        await adminApi.uploadTripImage(
          accessToken,
          created.id,
          pendingImage.blob,
          pendingImage.filename,
        )
        URL.revokeObjectURL(pendingImage.previewUrl)
      }

      setTitle('')
      setOrigin('')
      setDestination('')
      setDepartureDate('')
      setPrice('')
      setImageUrl('')
      setPendingImage(null)
      setBusTemplate('')
      setCapacity('')
      setSeatLayout('TWO_BY_TWO')
      setDeckCount(1)
      setLowerDeckCapacity('')
      setVehicleFeatures([])
      setBlockedSeats('')
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-workspace">
      <form className="admin-form-panel" onSubmit={submit}>
        <div><span className="eyebrow">Nova operação</span><h2>Viagem</h2></div>
        <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input placeholder="Origem" value={origin} onChange={(e) => setOrigin(e.target.value)} required />
        <input placeholder="Destino" value={destination} onChange={(e) => setDestination(e.target.value)} required />
        <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} required />
        <input inputMode="decimal" placeholder="Preço por pessoa em R$" value={price} onChange={(e) => setPrice(e.target.value)} />

        <TripPhotoPicker
          accessToken={accessToken}
          destination={destination}
          value={imageUrl}
          previewUrl={pendingImage?.previewUrl}
          busy={saving}
          onChooseUrl={(url) => {
            if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
            setPendingImage(null)
            setImageUrl(url)
          }}
          onPreparedFile={(blob, filename, previewUrl) => {
            if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
            setPendingImage({ blob, filename, previewUrl })
            setImageUrl('')
          }}
          onClear={() => {
            if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
            setPendingImage(null)
            setImageUrl('')
          }}
        />

        <div className="admin-bus-field">
          <label htmlFor="trip-bus-template">Ônibus e mapa de assentos</label>
          <select
            id="trip-bus-template"
            value={busTemplate}
            onChange={(event) => chooseTemplate(event.target.value)}
          >
            <option value="">Sem escolha de assentos</option>
            {busTemplates.map((template) => (
              <option value={template.key} key={template.key}>{template.label}</option>
            ))}
          </select>

          {selectedTemplate ? (
            <div className="admin-bus-preview">
              <div>
                <strong>{selectedTemplate.shortLabel}</strong>
                <span>{selectedTemplate.description}</span>
              </div>
              {selectedTemplate.capacity ? (
                <small>
                  {selectedTemplate.capacity} lugares · {selectedTemplate.seatLayout === 'TWO_BY_ONE' ? '2+1' : '2+2'} · {selectedTemplate.deckCount === 2 ? '2 andares' : '1 andar'}
                </small>
              ) : (
                <small>Configuração manual</small>
              )}
            </div>
          ) : (
            <small className="admin-form-hint">
              Se o pacote não usar ônibus com assento marcado, deixe esta opção desativada.
            </small>
          )}

          {busTemplate === 'CUSTOM' ? (
            <div className="admin-bus-custom admin-bus-custom--advanced">
              <input
                type="number"
                min="1"
                max="80"
                inputMode="numeric"
                placeholder="Quantidade de assentos"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                required
              />
              <select
                value={seatLayout}
                onChange={(event) => setSeatLayout(event.target.value as SeatLayout)}
                aria-label="Disposição dos assentos"
              >
                <option value="TWO_BY_TWO">2+2 · dois de cada lado</option>
                <option value="TWO_BY_ONE">2+1 · dois de um lado e um do outro</option>
              </select>
              <select
                value={deckCount}
                onChange={(event) => changeDecks(Number(event.target.value) as 1 | 2)}
                aria-label="Quantidade de andares"
              >
                <option value={1}>1 andar</option>
                <option value={2}>2 andares</option>
              </select>
              {deckCount === 2 ? (
                <input
                  type="number"
                  min="1"
                  max="79"
                  inputMode="numeric"
                  placeholder="Lugares no piso inferior"
                  value={lowerDeckCapacity}
                  onChange={(event) => setLowerDeckCapacity(event.target.value)}
                  required
                />
              ) : null}
            </div>
          ) : null}

          {busTemplate ? (
            <VehicleConfigurationFields
              deckCount={effectiveDeckCount as 1 | 2}
              features={vehicleFeatures}
              onFeaturesChange={setVehicleFeatures}
              blockedSeats={blockedSeats}
              onBlockedSeatsChange={setBlockedSeats}
            />
          ) : null}
        </div>

        <button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Criar viagem'}</button>
      </form>

      <article className="admin-data-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">Operação</span><h2>Viagens</h2></div><strong>{trips.length}</strong></div>
        <div className="admin-table">
          {trips.length ? trips.map((trip) => (
            <div className="admin-table-row admin-trip-row" key={trip.id}>
              <div>
                <strong>{trip.title}</strong>
                <span>{trip.origin} → {trip.destination} · {date.format(new Date(trip.departureDate))}</span>
              </div>
              <span>{trip.status}</span>
              <span>{trip.priceCents == null ? 'Sem preço' : money.format(trip.priceCents / 100)}</span>
              <TripBusControl
                accessToken={accessToken}
                trip={trip}
                templates={busTemplates}
                canManageSeats={canManageSeats}
                onChanged={onChanged}
              />
            </div>
          )) : <p className="admin-empty">Nenhuma viagem cadastrada no banco.</p>}
        </div>
      </article>
    </section>
  )
}

function TripBusControl({
  accessToken,
  trip,
  templates,
  canManageSeats,
  onChanged,
}: {
  accessToken: string
  trip: AdminTrip
  templates: BusTemplateOption[]
  canManageSeats: boolean
  onChanged: () => Promise<void>
}) {
  const initialTemplate = trip.busTemplate ?? (trip.capacity ? 'CUSTOM' : '')
  const [templateKey, setTemplateKey] = useState(initialTemplate)
  const [capacity, setCapacity] = useState(trip.capacity?.toString() ?? '')
  const [seatLayout, setSeatLayout] = useState<SeatLayout>(trip.seatLayout ?? 'TWO_BY_TWO')
  const [deckCount, setDeckCount] = useState<1 | 2>(trip.deckCount === 2 ? 2 : 1)
  const [lowerDeckCapacity, setLowerDeckCapacity] = useState(
    trip.lowerDeckCapacity?.toString() ?? '',
  )
  const [features, setFeatures] = useState<VehicleFeature[]>(
    trip.vehicleFeatures ?? [],
  )
  const [blockedSeats, setBlockedSeats] = useState(
    trip.blockedSeats.join(', '),
  )
  const [imageUrl, setImageUrl] = useState(trip.imageUrl ?? '')
  const [imageChanged, setImageChanged] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showSeatMap, setShowSeatMap] = useState(false)
  const [showBoarding, setShowBoarding] = useState(false)
  const [showAudit, setShowAudit] = useState(false)

  useEffect(() => {
    setTemplateKey(trip.busTemplate ?? (trip.capacity ? 'CUSTOM' : ''))
    setCapacity(trip.capacity?.toString() ?? '')
    setSeatLayout(trip.seatLayout ?? 'TWO_BY_TWO')
    setDeckCount(trip.deckCount === 2 ? 2 : 1)
    setLowerDeckCapacity(trip.lowerDeckCapacity?.toString() ?? '')
    setFeatures(trip.vehicleFeatures ?? [])
    setBlockedSeats(trip.blockedSeats.join(', '))
    setImageUrl(trip.imageUrl ?? '')
    setImageChanged(false)
  }, [
    trip.busTemplate,
    trip.capacity,
    trip.seatLayout,
    trip.deckCount,
    trip.lowerDeckCapacity,
    trip.vehicleFeatures,
    trip.blockedSeats,
    trip.imageUrl,
  ])

  const selected = templates.find((template) => template.key === templateKey)
  const effectiveCapacity =
    templateKey === 'CUSTOM'
      ? Number(capacity)
      : selected?.capacity ?? trip.capacity ?? 0
  const effectiveDeckCount =
    templateKey === 'CUSTOM'
      ? deckCount
      : selected?.deckCount ?? (trip.deckCount === 2 ? 2 : 1)

  function chooseTemplate(next: string) {
    setTemplateKey(next)
    const option = templates.find((template) => template.key === next)

    if (!option) {
      setFeatures([])
      setBlockedSeats('')
      return
    }

    if (option.key === 'CUSTOM') {
      if (!capacity) setCapacity(trip.capacity?.toString() ?? '')
      setSeatLayout(trip.seatLayout ?? 'TWO_BY_TWO')
      setDeckCount(trip.deckCount === 2 ? 2 : 1)
      setLowerDeckCapacity(trip.lowerDeckCapacity?.toString() ?? '')
      return
    }

    setCapacity(option.capacity?.toString() ?? '')
    setSeatLayout(option.seatLayout ?? 'TWO_BY_TWO')
    setDeckCount(option.deckCount ?? 1)
    setLowerDeckCapacity(option.lowerDeckCapacity?.toString() ?? '')
    setFeatures(option.defaultFeatures)
    setBlockedSeats('')
  }

  function changeDecks(next: 1 | 2) {
    setDeckCount(next)
    if (next === 1) {
      setLowerDeckCapacity('')
      setFeatures(
        features
          .filter((feature) => feature.type !== 'STAIRS')
          .map((feature) => ({ ...feature, deck: 1 as const })),
      )
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!templateKey) {
      setSaving(true)
      try {
        await adminApi.updateTrip(accessToken, trip.id, {
          busTemplate: null,
          capacity: null,
          seatLayout: null,
          deckCount: null,
          lowerDeckCapacity: null,
          vehicleFeatures: [],
          blockedSeats: [],
          ...(imageChanged ? { imageUrl: imageUrl.trim() || null } : {}),
        })
        await onChanged()
      } finally {
        setSaving(false)
      }
      return
    }

    if (!effectiveCapacity || effectiveCapacity < 1 || effectiveCapacity > 80) return
    const normalizedBlocked = parseBlockedSeatsInput(blockedSeats, effectiveCapacity)
    if (normalizedBlocked === null) return

    if (templateKey === 'CUSTOM') {
      const parsed = Number(capacity)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 80) return

      if (deckCount === 2) {
        const lower = Number(lowerDeckCapacity)
        if (!Number.isInteger(lower) || lower < 1 || lower >= parsed) return
      }

      setSaving(true)
      try {
        await adminApi.updateTrip(accessToken, trip.id, {
          busTemplate: 'CUSTOM',
          capacity: parsed,
          seatLayout,
          deckCount,
          lowerDeckCapacity:
            deckCount === 2 ? Number(lowerDeckCapacity) : null,
          vehicleFeatures: features,
          blockedSeats: normalizedBlocked,
          ...(imageChanged ? { imageUrl: imageUrl.trim() || null } : {}),
        })
        await onChanged()
      } finally {
        setSaving(false)
      }
      return
    }

    setSaving(true)
    try {
      await adminApi.updateTrip(accessToken, trip.id, {
        busTemplate: templateKey,
        vehicleFeatures: features,
        blockedSeats: normalizedBlocked,
        ...(imageChanged ? { imageUrl: imageUrl.trim() || null } : {}),
      })
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="admin-bus-control admin-bus-control--advanced" onSubmit={save}>
      <div className="admin-bus-control-summary">
        <strong>
          {selected?.shortLabel ??
            (trip.capacity ? 'Personalizado · ' + trip.capacity : 'Assentos desativados')}
        </strong>
        <span>
          {trip.capacity
            ? trip.capacity +
              ' lugares · ' +
              (trip.seatLayout === 'TWO_BY_ONE' ? '2+1' : '2+2') +
              (trip.deckCount === 2 ? ' · 2 andares' : '') +
              (trip.blockedSeats.length ? ' · ' + trip.blockedSeats.length + ' bloqueado(s)' : '')
            : 'Mapa não exibido ao viajante'}
        </span>
      </div>

      <div className="admin-trip-photo-editor">
        <TripPhotoPicker
          accessToken={accessToken}
          destination={trip.destination}
          value={imageUrl}
          previewUrl={adminTripImageUrl(trip)}
          busy={saving || photoBusy}
          onChooseUrl={(url) => {
            setImageUrl(url)
            setImageChanged(true)
          }}
          onPreparedFile={async (blob, filename, previewUrl) => {
            setPhotoBusy(true)
            try {
              await adminApi.uploadTripImage(
                accessToken,
                trip.id,
                blob,
                filename,
              )
              URL.revokeObjectURL(previewUrl)
              setImageUrl('')
              setImageChanged(false)
              await onChanged()
            } finally {
              setPhotoBusy(false)
            }
          }}
          onClear={async () => {
            setPhotoBusy(true)
            try {
              await adminApi.clearTripImage(accessToken, trip.id)
              setImageUrl('')
              setImageChanged(false)
              await onChanged()
            } finally {
              setPhotoBusy(false)
            }
          }}
        />
      </div>

      <select
        value={templateKey}
        onChange={(event) => chooseTemplate(event.target.value)}
        aria-label={'Modelo de ônibus de ' + trip.title}
      >
        <option value="">Sem assentos</option>
        {templates.map((template) => (
          <option value={template.key} key={template.key}>{template.shortLabel}</option>
        ))}
      </select>

      {templateKey === 'CUSTOM' ? (
        <div className="admin-bus-control-custom admin-bus-control-custom--advanced">
          <input
            type="number"
            min="1"
            max="80"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            aria-label={'Lotação de ' + trip.title}
          />
          <select
            value={seatLayout}
            onChange={(event) => setSeatLayout(event.target.value as SeatLayout)}
            aria-label={'Disposição de assentos de ' + trip.title}
          >
            <option value="TWO_BY_TWO">2+2</option>
            <option value="TWO_BY_ONE">2+1</option>
          </select>
          <select
            value={deckCount}
            onChange={(event) => changeDecks(Number(event.target.value) as 1 | 2)}
            aria-label={'Andares de ' + trip.title}
          >
            <option value={1}>1 andar</option>
            <option value={2}>2 andares</option>
          </select>
          {deckCount === 2 ? (
            <input
              type="number"
              min="1"
              max="79"
              value={lowerDeckCapacity}
              onChange={(event) => setLowerDeckCapacity(event.target.value)}
              aria-label={'Lugares no piso inferior de ' + trip.title}
            />
          ) : null}
        </div>
      ) : null}

      {templateKey ? (
        <VehicleConfigurationFields
          deckCount={effectiveDeckCount as 1 | 2}
          features={features}
          onFeaturesChange={setFeatures}
          blockedSeats={blockedSeats}
          onBlockedSeatsChange={setBlockedSeats}
        />
      ) : null}

      <button type="submit" disabled={saving}>
        {saving ? 'Salvando' : 'Salvar alterações'}
      </button>

      {canManageSeats ? (
        <div className="admin-trip-operation-actions">
          {trip.capacity ? (
            <button
              type="button"
              className="admin-seat-map-open"
              onClick={() => setShowSeatMap(true)}
            >
              Gerenciar assentos
            </button>
          ) : null}

          <button
            type="button"
            className="admin-boarding-open"
            onClick={() => setShowBoarding(true)}
          >
            Lista de embarque
          </button>

          <button
            type="button"
            className="admin-audit-open"
            onClick={() => setShowAudit(true)}
          >
            Auditoria
          </button>
        </div>
      ) : null}

      {showSeatMap ? (
        <AdminSeatMapDialog
          accessToken={accessToken}
          tripId={trip.id}
          onClose={() => setShowSeatMap(false)}
          onChanged={onChanged}
        />
      ) : null}

      {showBoarding ? (
        <TripBoardingDialog
          accessToken={accessToken}
          tripId={trip.id}
          onClose={() => setShowBoarding(false)}
          onCompleted={onChanged}
        />
      ) : null}

      {showAudit ? (
        <TripAuditDialog
          accessToken={accessToken}
          tripId={trip.id}
          onClose={() => setShowAudit(false)}
        />
      ) : null}
    </form>
  )
}

function reservationWhatsAppMessage(reservation: AdminReservation) {
  const seats = reservation.seatAssignments.length
    ? ' Assentos: ' +
      reservation.seatAssignments
        .map((seat) => seat.seatNumber)
        .join(', ') +
      '.'
    : ''

  if (reservation.status === 'CONFIRMED') {
    return `Olá, ${reservation.client.fullName}! Sua reserva para ${reservation.trip.title} está confirmada. Embarque: ${date.format(new Date(reservation.trip.departureDate))}.${seats} Qualquer dúvida, fale com a Próximo Destino.`
  }

  if (reservation.status === 'CANCELLED') {
    const bonus =
      reservation.client.bonusBalanceCents > 0
        ? ` Você possui ${money.format(reservation.client.bonusBalanceCents / 100)} em bônus disponível para uma próxima viagem.`
        : ''
    return `Olá, ${reservation.client.fullName}. Sua reserva para ${reservation.trip.title} foi cancelada.${bonus} Se precisar, estamos à disposição.`
  }

  return `Olá, ${reservation.client.fullName}! Estamos acompanhando sua reserva para ${reservation.trip.title}, com embarque em ${date.format(new Date(reservation.trip.departureDate))}.${seats} Próximo Destino Turismo e Viagens.`
}

function ReservationsView({
  accessToken,
  clients,
  trips,
  reservations,
  canManagePassengers,
  canViewFinance,
  onChanged,
}: {
  accessToken: string
  clients: AdminClient[]
  trips: AdminTrip[]
  reservations: AdminReservation[]
  canManagePassengers: boolean
  canViewFinance: boolean
  onChanged: () => Promise<void>
}) {
  const [clientId, setClientId] = useState('')
  const [tripId, setTripId] = useState('')
  const [saving, setSaving] = useState(false)
  const [passengersReservationId, setPassengersReservationId] = useState<string | null>(null)
  const [cancelReservationId, setCancelReservationId] = useState<string | null>(null)
  const [bonusReservationId, setBonusReservationId] = useState<string | null>(null)
  const [financeReservationId, setFinanceReservationId] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await adminApi.createReservation(accessToken, clientId, tripId)
      setClientId('')
      setTripId('')
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(id: string, status: AdminReservation['status']) {
    await adminApi.updateReservationStatus(accessToken, id, status)
    await onChanged()
  }

  return (
    <section className="admin-workspace">
      <form className="admin-form-panel" onSubmit={submit}>
        <div><span className="eyebrow">Nova operação</span><h2>Reserva</h2></div>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
          <option value="">Selecione o cliente</option>
          {clients.map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}
        </select>
        <select value={tripId} onChange={(e) => setTripId(e.target.value)} required>
          <option value="">Selecione a viagem</option>
          {trips.map((trip) => <option value={trip.id} key={trip.id}>{trip.title}</option>)}
        </select>
        <button type="submit" disabled={saving || !clients.length || !trips.length}>{saving ? 'Salvando...' : 'Criar reserva'}</button>
      </form>

      <article className="admin-data-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">Operação</span><h2>Reservas</h2></div><strong>{reservations.length}</strong></div>
        <div className="admin-table">
          {reservations.length ? reservations.map((reservation) => (
            <div className="admin-table-row admin-table-row--reservation" key={reservation.id}>
              <div>
                <strong>{reservation.client.fullName}</strong>
                <span>
                  {reservation.trip.title} · {date.format(new Date(reservation.trip.departureDate))}
                  {' · '}
                  {reservation.passengerCount} passageiro{reservation.passengerCount === 1 ? '' : 's'}
                  {reservation.seatAssignments.length
                    ? ' · Assentos ' + reservation.seatAssignments.map((seat) => seat.seatNumber).join(', ')
                    : ''}
                  {reservation.client.bonusBalanceCents > 0
                    ? ' · Bônus ' + money.format(reservation.client.bonusBalanceCents / 100)
                    : ''}
                </span>
                {reservation.cancellationRequestStatus === 'PENDING' ? (
                  <span className="admin-cancellation-request-badge">
                    Cancelamento solicitado pelo passageiro
                  </span>
                ) : reservation.cancellationRequestStatus === 'REJECTED' ? (
                  <span className="admin-cancellation-request-badge admin-cancellation-request-badge--rejected">
                    Solicitação de cancelamento recusada
                  </span>
                ) : null}
              </div>
              <div className="admin-reservation-actions">
                <select
                  value={reservation.status}
                  disabled={reservation.status === 'CANCELLED'}
                  onChange={(e) => void changeStatus(reservation.id, e.target.value as AdminReservation['status'])}
                >
                  <option value="PENDING">Pendente</option>
                  <option value="CONFIRMED">Confirmada</option>
                  <option value="COMPLETED">Concluída</option>
                  {reservation.status === 'CANCELLED' ? (
                    <option value="CANCELLED">Cancelada</option>
                  ) : null}
                </select>
                {canManagePassengers && reservation.status !== 'CANCELLED' ? (
                  <button
                    type="button"
                    onClick={() => setPassengersReservationId(reservation.id)}
                  >
                    Passageiros
                  </button>
                ) : null}
                {canViewFinance ? (
                  <button
                    type="button"
                    className="admin-reservation-finance"
                    onClick={() => setFinanceReservationId(reservation.id)}
                  >
                    Financeiro
                  </button>
                ) : null}
                {reservation.client.phone ? (
                  <button
                    type="button"
                    className="admin-reservation-whatsapp"
                    onClick={() =>
                      openWhatsAppTo(
                        reservation.client.phone!,
                        reservationWhatsAppMessage(reservation),
                      )
                    }
                  >
                    WhatsApp
                  </button>
                ) : null}
                {canManagePassengers &&
                reservation.status !== 'CANCELLED' &&
                reservation.status !== 'COMPLETED' &&
                reservation.client.bonusBalanceCents > 0 ? (
                  <button
                    type="button"
                    className="admin-reservation-bonus"
                    onClick={() => setBonusReservationId(reservation.id)}
                  >
                    Usar bônus
                  </button>
                ) : null}
                {canManagePassengers &&
                reservation.status !== 'CANCELLED' &&
                reservation.status !== 'COMPLETED' ? (
                  <button
                    type="button"
                    className="admin-reservation-cancel"
                    onClick={() => setCancelReservationId(reservation.id)}
                  >
                    {reservation.cancellationRequestStatus === 'PENDING'
                      ? 'Analisar cancelamento'
                      : 'Cancelar'}
                  </button>
                ) : null}
              </div>
            </div>
          )) : <p className="admin-empty">Nenhuma reserva cadastrada ainda.</p>}
        </div>
      </article>

      {passengersReservationId ? (
        <ReservationPassengersDialog
          accessToken={accessToken}
          reservationId={passengersReservationId}
          onClose={() => setPassengersReservationId(null)}
          onChanged={onChanged}
        />
      ) : null}

      {cancelReservationId ? (
        <ReservationCancelDialog
          accessToken={accessToken}
          reservation={
            reservations.find((item) => item.id === cancelReservationId)!
          }
          onClose={() => setCancelReservationId(null)}
          onChanged={onChanged}
        />
      ) : null}

      {bonusReservationId ? (
        <ReservationBonusDialog
          accessToken={accessToken}
          reservation={
            reservations.find((item) => item.id === bonusReservationId)!
          }
          onClose={() => setBonusReservationId(null)}
          onChanged={onChanged}
        />
      ) : null}

      {financeReservationId ? (
        <ReservationFinanceDialog
          accessToken={accessToken}
          reservationId={financeReservationId}
          onClose={() => setFinanceReservationId(null)}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  )
}


function PaymentSettings({ accessToken }: { accessToken: string }) {
  const [status, setStatus] = useState<PaymentConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    try {
      setStatus(await adminApi.paymentConnection(accessToken))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    function applyOAuthResult(status: string | undefined) {
      setMessage(
        status === 'success'
          ? 'Mercado Pago conectado com sucesso.'
          : 'Não foi possível concluir a conexão.',
      )
      void load()
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'MERCADO_PAGO_OAUTH') return
      applyOAuthResult(event.data.status)
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== 'mercado-pago-oauth-result' || !event.newValue) return
      try {
        const payload = JSON.parse(event.newValue) as { type?: string; status?: string }
        if (payload.type === 'MERCADO_PAGO_OAUTH') applyOAuthResult(payload.status)
      } catch {
        // sinal inválido
      }
    }

    window.addEventListener('message', onMessage)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('storage', onStorage)
    }
  }, [accessToken])

  async function connect() {
    setWorking(true)
    setMessage('')
    try {
      const result = await adminApi.connectMercadoPago(accessToken)
      window.location.assign(result.authorizationUrl)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Falha ao iniciar conexão.')
      setWorking(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar o Mercado Pago desta plataforma?')) return
    setWorking(true)
    setMessage('')
    try {
      await adminApi.disconnectMercadoPago(accessToken)
      setMessage('Mercado Pago desconectado.')
      await load()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Falha ao desconectar.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="admin-settings-workspace">
      <div className="admin-settings-heading">
        <div>
          <span className="eyebrow">Configurações da plataforma</span>
          <h2>Pagamentos</h2>
          <p>Conecte a conta que receberá PIX e pagamentos com cartão.</p>
        </div>
        <Settings size={22} />
      </div>

      <article className="payment-connection-card">
        <div className="payment-connection-brand">
          <span className="payment-connection-icon"><CreditCard size={20} /></span>
          <div>
            <strong>Mercado Pago</strong>
            <span>PIX e cartão com autorização segura</span>
          </div>
        </div>

        {loading ? (
          <div className="payment-connection-state">Verificando conexão...</div>
        ) : status?.connected ? (
          <>
            <div
              className={
                status.readyForPayments
                  ? 'payment-connection-success'
                  : 'payment-connection-success payment-connection-success--pending'
              }
            >
              <CheckCircle2 size={20} />
              <div>
                <strong>
                  {status.readyForPayments
                    ? 'Conectado e pronto para receber'
                    : 'Conta conectada'}
                </strong>
                <span>
                  {status.readyForPayments
                    ? 'PIX e cartão estão liberados para compra online.'
                    : 'Sua conta já foi autorizada. A ativação central dos pagamentos ainda está sendo concluída pela plataforma; você não precisa fazer nada.'}
                  {status.liveMode === false ? ' Conta em modo de teste.' : ''}
                  {status.connectedAt
                    ? ' Conectada em ' + new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(status.connectedAt)) + '.'
                    : ''}
                </span>
              </div>
            </div>
            <div className="payment-connection-actions">
              <button type="button" className="payment-secondary-action" onClick={() => void disconnect()} disabled={working}>
                Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="payment-onboarding-steps" aria-label="Etapas para ativar pagamentos">
              <div>
                <span>1</span>
                <p><strong>Conectar conta</strong><small>Use sua conta Mercado Pago.</small></p>
              </div>
              <div>
                <span>2</span>
                <p><strong>Autorizar</strong><small>Confirme a permissão no Mercado Pago.</small></p>
              </div>
              <div>
                <span>3</span>
                <p><strong>Começar a receber</strong><small>PIX e cartão ficam disponíveis.</small></p>
              </div>
            </div>

            <div className="payment-connection-copy">
              <strong>
                {status?.platformConfigured
                  ? 'Pronto para conectar'
                  : 'Recurso sendo preparado pela plataforma'}
              </strong>
              <span>
                {status?.platformConfigured
                  ? 'Você não precisa copiar chaves, tokens ou códigos. A autorização acontece diretamente no Mercado Pago.'
                  : 'Nenhuma ação técnica é necessária nesta tela. Quando a integração central estiver habilitada, o botão será liberado automaticamente.'}
              </span>
            </div>
            <div className="payment-connection-actions">
              <button
                type="button"
                className="payment-primary-action"
                onClick={() => void connect()}
                disabled={working || !status?.platformConfigured}
              >
                {working ? 'Abrindo Mercado Pago...' : 'Conectar Mercado Pago'}
                <ExternalLink size={15} />
              </button>
            </div>
          </>
        )}

        {message ? <p className="payment-connection-message">{message}</p> : null}
      </article>
    </section>
  )
}
