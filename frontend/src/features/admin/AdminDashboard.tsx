import { ChangePasswordDialog } from './ChangePasswordDialog'
import { ReservationAccessDialog } from './ReservationAccessDialog'
import {
  ArrowLeft,
  Bell,
  CalendarHeart,
  CircleDollarSign,
  FileText,
  Gift,
  Globe2,
  CreditCard,
  History,
  ChevronDown,
  ExternalLink,
  Settings,
  CheckCircle2,
  LogOut,
  Mail,
  Bus,
  Search,
  ShieldCheck,
  Phone,
  Users,
  X,
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
  type AdminAuditTrail,
  type AdminClient,
  type AdminNotification,
  type AdminNotificationFeed,
  type AdminPaymentsDashboard,
  type AdminPurchaseOrder,
  type AdminReservation,
  type AdminTrip,
  type BusTemplateOption,
  type DashboardData,
  type EmailAutomationStatus,
  type SeatLayout,
  type PaymentConnectionStatus,
  type SearchResult,
  type SecurityPosture,
  type WhatsAppAutomationStatus,
  type VehicleFeature,
} from '../../lib/adminApi'
import { openWhatsApp, openWhatsAppTo } from '../../lib/whatsapp'
import { cpfDigits, formatCpf, isValidCpf } from '../../lib/cpf'
import { adminCapabilities } from '../../lib/adminPermissions'

type AdminDashboardProps = {
  accessToken: string
  onExitToSite: () => void
  onLogout: () => void
  onPasswordChanged?: () => void
}

type Tab =
  | 'overview'
  | 'clients'
  | 'trips'
  | 'reservations'
  | 'quotes'
  | 'payments'
  | 'finance'
  | 'audit'
  | 'settings'

const adminTabs = new Set<Tab>([
  'overview',
  'clients',
  'trips',
  'reservations',
  'quotes',
  'payments',
  'finance',
  'audit',
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

function adminRoleLabel(role: string | null) {
  if (role === 'ADMIN') return 'Administrador'
  if (role === 'AGENT') return 'Agente'
  if (role === 'FINANCE') return 'Financeiro'
  return 'Acesso restrito'
}

export function AdminDashboard({
  accessToken,
  onExitToSite,
  onLogout,
  onPasswordChanged,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<Tab>(() => tabFromLocation())
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [trips, setTrips] = useState<AdminTrip[]>([])
  const [reservations, setReservations] = useState<AdminReservation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationFeed, setNotificationFeed] =
    useState<AdminNotificationFeed | null>(null)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const scrollPositions = useRef<Partial<Record<Tab, number>>>({})
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const userRole = useMemo(() => roleFromToken(accessToken), [accessToken])
  const capabilities = useMemo(
    () => adminCapabilities(userRole),
    [userRole],
  )
  const isAdmin = userRole === 'ADMIN'

  useEffect(() => {
    function onSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMobileSearchOpen(true)
        window.setTimeout(() => searchInputRef.current?.focus(), 0)
      }

      if (event.key === 'Escape') {
        setMobileSearchOpen(false)
        setSearchResult(null)
        searchInputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', onSearchShortcut)
    return () => window.removeEventListener('keydown', onSearchShortcut)
  }, [])

  function canAccessTab(candidate: Tab) {
    if (candidate === 'overview') return true
    if (candidate === 'clients') return capabilities.viewClients
    if (candidate === 'trips') return capabilities.viewTrips
    if (candidate === 'reservations') return capabilities.viewReservations
    if (candidate === 'quotes') return capabilities.viewQuotes
    if (candidate === 'payments') return capabilities.viewPayments
    if (candidate === 'finance') return capabilities.viewFinance
    if (candidate === 'audit') return capabilities.viewAudit
    if (candidate === 'settings') return capabilities.viewSettings
    return false
  }

  function navigateTab(next: Tab, replace = false) {
    const target = canAccessTab(next) ? next : 'overview'

    if (target === tab) {
      setAccountMenuOpen(false)
      return
    }

    scrollPositions.current[tab] = window.scrollY

    const url = new URL(window.location.href)
    url.searchParams.set('screen', 'admin')
    url.searchParams.set('tab', target)
    url.searchParams.delete('paymentConnection')
    window.history[replace ? 'replaceState' : 'pushState'](
      { screen: 'admin', tab: target },
      '',
      url,
    )

    setTab(target)
    setSearchResult(null)
    setAccountMenuOpen(false)

    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: scrollPositions.current[target] ?? 0,
        behavior: 'auto',
      })
    })
  }

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [
        dashboardData,
        clientData,
        tripData,
        reservationData,
        notificationData,
      ] = await Promise.all([
        adminApi.dashboard(accessToken),
        capabilities.viewClients
          ? adminApi.clients(accessToken)
          : Promise.resolve([]),
        capabilities.viewTrips
          ? adminApi.trips(accessToken)
          : Promise.resolve([]),
        adminApi.reservations(accessToken),
        adminApi.notifications(accessToken).catch(() => null),
      ])
      setDashboard(dashboardData)
      setClients(clientData)
      setTrips(tripData)
      setReservations(reservationData)
      if (notificationData) setNotificationFeed(notificationData)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o painel.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [accessToken, capabilities.viewClients, capabilities.viewTrips])

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
      const requested = tabFromLocation()
      const next = canAccessTab(requested) ? requested : 'overview'
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
    if (!canAccessTab(tab)) {
      navigateTab('overview', true)
    }
  }, [capabilities, tab])

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

  const notificationCount = notificationFeed?.unreadCount ?? 0

  async function refreshNotifications() {
    setNotificationsLoading(true)
    try {
      setNotificationFeed(await adminApi.notifications(accessToken))
    } catch {
      // O restante do painel continua disponível se o histórico falhar.
    } finally {
      setNotificationsLoading(false)
    }
  }

  async function toggleNotifications() {
    const next = !notificationsOpen
    setNotificationsOpen(next)
    setAccountMenuOpen(false)
    if (!next) return
    await refreshNotifications()
  }

  async function openNotification(notification: AdminNotification) {
    if (!notification.isRead) {
      try {
        const read = await adminApi.markNotificationRead(
          accessToken,
          notification.id,
        )
        setNotificationFeed((current) =>
          current
            ? {
                unreadCount: Math.max(0, current.unreadCount - 1),
                items: current.items.map((item) =>
                  item.id === read.id ? read : item,
                ),
              }
            : current,
        )
      } catch {
        // A navegação continua mesmo se a marcação de leitura falhar.
      }
    }

    setNotificationsOpen(false)
    const target = notification.actionTab as Tab | null
    if (target && adminTabs.has(target) && canAccessTab(target)) {
      navigateTab(target)
    }
  }

  async function markAllNotificationsRead() {
    try {
      await adminApi.markAllNotificationsRead(accessToken)
      setNotificationFeed((current) =>
        current
          ? {
              unreadCount: 0,
              items: current.items.map((item) => ({
                ...item,
                isRead: true,
                readAt: item.readAt ?? new Date().toISOString(),
              })),
            }
          : current,
      )
    } catch {
      // Mantém o histórico visível e permite tentar novamente.
    }
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Brand compact />

        <nav
          className="admin-nav"
          aria-label="Administração"
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLButtonElement) {
              event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
            }
          }}
        >
          <button aria-current={tab === 'overview' ? 'page' : undefined} className={tab === 'overview' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('overview')} type="button">Visão geral</button>
          {capabilities.viewClients ? (
            <button aria-current={tab === 'clients' ? 'page' : undefined} className={tab === 'clients' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('clients')} type="button">Clientes</button>
          ) : null}
          {capabilities.viewTrips ? (
            <button aria-current={tab === 'trips' ? 'page' : undefined} className={tab === 'trips' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('trips')} type="button">Viagens</button>
          ) : null}
          {capabilities.viewReservations ? (
            <button aria-current={tab === 'reservations' ? 'page' : undefined} className={tab === 'reservations' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('reservations')} type="button">Reservas</button>
          ) : null}
          {capabilities.viewQuotes ? (
            <button aria-current={tab === 'quotes' ? 'page' : undefined} className={tab === 'quotes' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('quotes')} type="button">Cotações</button>
          ) : null}
          {capabilities.viewPayments ? (
            <button aria-current={tab === 'payments' ? 'page' : undefined} className={tab === 'payments' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('payments')} type="button">Pagamentos</button>
          ) : null}
          {capabilities.viewFinance ? (
            <button aria-current={tab === 'finance' ? 'page' : undefined} className={tab === 'finance' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('finance')} type="button">Financeiro</button>
          ) : null}
          {capabilities.viewAudit ? (
            <button aria-current={tab === 'audit' ? 'page' : undefined} className={tab === 'audit' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('audit')} type="button">Auditoria</button>
          ) : null}
          {capabilities.viewSettings ? (
            <button aria-current={tab === 'settings' ? 'page' : undefined} className={tab === 'settings' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => navigateTab('settings')} type="button">Configurações</button>
          ) : null}
        </nav>

        <div className="admin-actions">
          <button
            className="admin-search-toggle round-action"
            type="button"
            aria-label="Abrir pesquisa"
            aria-expanded={mobileSearchOpen}
            onClick={() => {
              setMobileSearchOpen((value) => {
                const next = !value
                if (next) {
                  window.setTimeout(() => searchInputRef.current?.focus(), 0)
                }
                return next
              })
            }}
          >
            <Search size={17} />
          </button>
          <form
            className={mobileSearchOpen ? 'admin-search admin-search--open' : 'admin-search'}
            onSubmit={(event) => {
              void handleSearch(event)
              setMobileSearchOpen(false)
            }}
          >
            <button
              className="admin-search-submit"
              type="submit"
              aria-label="Pesquisar"
              title="Pesquisar"
            >
              <Search size={16} />
            </button>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                if (!event.target.value) setSearchResult(null)
              }}
              aria-label="Pesquisa global"
              placeholder={
                userRole === 'FINANCE'
                  ? 'Buscar reserva por cliente, viagem ou código...'
                  : 'Buscar cliente, viagem ou reserva...'
              }
            />
            {searchQuery ? (
              <button
                className="admin-search-clear"
                type="button"
                aria-label="Limpar pesquisa"
                title="Limpar pesquisa"
                onClick={() => {
                  setSearchQuery('')
                  setSearchResult(null)
                  searchInputRef.current?.focus()
                }}
              >
                <X size={14} />
              </button>
            ) : (
              <span className="admin-search-shortcut" aria-hidden="true">⌘K</span>
            )}
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
                    <span>
                      {notificationCount
                        ? `${notificationCount} não lida(s) · histórico salvo`
                        : 'Histórico salvo · tudo em dia'}
                    </span>
                  </div>
                  <div className="admin-notification-head-actions">
                    {notificationCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => void markAllNotificationsRead()}
                      >
                        Marcar todas
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                    >
                      Fechar
                    </button>
                  </div>
                </div>

                {notificationsLoading ? (
                  <span className="admin-notification-loading">
                    Atualizando histórico...
                  </span>
                ) : notificationFeed?.items.length ? (
                  <div className="admin-notification-list">
                    {notificationFeed.items.map((notification) => (
                      <button
                        type="button"
                        className={
                          notification.isRead
                            ? 'admin-notification-item admin-notification-item--read'
                            : 'admin-notification-item admin-notification-item--unread'
                        }
                        key={notification.id}
                        onClick={() => void openNotification(notification)}
                      >
                        <span className="admin-notification-item-icon">
                          {notificationIcon(notification.type)}
                        </span>
                        <div>
                          <strong>{notification.title}</strong>
                          <span>{notification.message}</span>
                          <small>
                            {new Intl.DateTimeFormat('pt-BR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }).format(new Date(notification.createdAt))}
                            {notification.isRead ? ' · Lida' : ' · Não lida'}
                          </small>
                        </div>
                        {!notification.isRead ? (
                          <i
                            className="admin-notification-unread-dot"
                            aria-label="Não lida"
                          />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="admin-notification-empty">
                    Nenhuma notificação no histórico.
                  </span>
                )}
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
                  <strong>{adminRoleLabel(userRole)}</strong>
                  <span>Sessão protegida · permissões por função</span>
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
                <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setChangingPassword(true) }}>Alterar minha senha</button>
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
          <div className="security-pill">
            <ShieldCheck size={16} />
            {adminRoleLabel(userRole)} · acesso protegido
          </div>
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
              {capabilities.viewClients ? (
                <div>
                  <strong>Clientes</strong>
                  {searchResult.clients.length ? searchResult.clients.map((item) => (
                    <button type="button" className="admin-search-result-link" key={item.id} onClick={() => navigateTab('clients')}>
                      {item.fullName}<small>{item.email || item.phone || 'Sem contato'}</small>
                    </button>
                  )) : <em>Nenhum resultado</em>}
                </div>
              ) : null}
              {capabilities.viewTrips ? (
                <div>
                  <strong>Viagens</strong>
                  {searchResult.trips.length ? searchResult.trips.map((item) => (
                    <button type="button" className="admin-search-result-link" key={item.id} onClick={() => navigateTab('trips')}>
                      {item.title}<small>{item.origin} → {item.destination}</small>
                    </button>
                  )) : <em>Nenhum resultado</em>}
                </div>
              ) : null}
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
              {capabilities.viewClients ? (
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
              ) : null}

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

        {tab === 'clients' && capabilities.viewClients ? (
          <ClientsView accessToken={accessToken} clients={clients} onChanged={reload} />
        ) : null}

        {tab === 'trips' && capabilities.viewTrips ? (
          <TripsView
            accessToken={accessToken}
            trips={trips}
            canManageSeats={isAdmin}
            onChanged={reload}
          />
        ) : null}

        {tab === 'reservations' && capabilities.viewReservations ? (
          <ReservationsView
            accessToken={accessToken}
            clients={clients}
            trips={trips}
            reservations={reservations}
            canCreateReservation={capabilities.createReservations}
            canChangeStatus={capabilities.changeReservationStatus}
            canManagePassengers={capabilities.managePassengers}
            canCancelReservations={capabilities.cancelReservations}
            canManageBonus={capabilities.manageBonus}
            canViewFinance={capabilities.viewFinance}
            onChanged={reload}
          />
        ) : null}

        {tab === 'quotes' && capabilities.viewQuotes ? (
          <QuotesWorkspace accessToken={accessToken} reservations={reservations} />
        ) : null}

        {tab === 'payments' && capabilities.viewPayments ? (
          <PaymentsWorkspace accessToken={accessToken} />
        ) : null}

        {tab === 'finance' && capabilities.viewFinance ? (
          <FinanceWorkspace accessToken={accessToken} />
        ) : null}

        {tab === 'audit' && capabilities.viewAudit ? (
          <AuditWorkspace accessToken={accessToken} />
        ) : null}

        {tab === 'settings' && capabilities.viewSettings ? (
          <PaymentSettings accessToken={accessToken} />
        ) : null}
      </main>
      {changingPassword ? <ChangePasswordDialog token={accessToken} onClose={() => setChangingPassword(false)} onChanged={onPasswordChanged || onLogout} /> : null}
    </div>
  )
}

function notificationIcon(type: string) {
  if (type === 'PAYMENT_PENDING') return <CreditCard size={16} />
  if (type === 'TRIP_UPCOMING') return <Bus size={16} />
  if (type === 'BIRTHDAY') return <CalendarHeart size={16} />
  if (type === 'CANCELLATION_REQUEST') return <FileText size={16} />
  return <Bell size={16} />
}

function auditCategoryLabel(category: string) {
  if (category === 'RESERVATIONS') return 'Reservas'
  if (category === 'CLIENTS') return 'Clientes'
  if (category === 'TRIPS') return 'Viagens'
  if (category === 'SEATS') return 'Assentos e embarque'
  if (category === 'FINANCE') return 'Financeiro'
  if (category === 'COMMERCIAL') return 'Comercial'
  if (category === 'SETTINGS') return 'Configurações'
  return 'Outros'
}

function auditEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    OPS_RESERVATION_CREATED: 'Reserva criada',
    OPS_RESERVATION_STATUS_CHANGED: 'Status da reserva alterado',
    OPS_RESERVATION_PASSENGERS_UPDATED: 'Passageiros da reserva atualizados',
    OPS_RESERVATION_CANCELLED: 'Reserva cancelada',
    OPS_CANCELLATION_REQUEST_REJECTED: 'Cancelamento recusado',
    OPS_CLIENT_CREATED: 'Cliente criado',
    OPS_CLIENT_UPDATED: 'Cliente atualizado',
    OPS_CLIENT_BONUS_REMOVED: 'Bônus removido',
    OPS_CLIENT_BONUS_USED: 'Bônus utilizado',
    OPS_TRIP_CREATED: 'Viagem criada',
    OPS_TRIP_UPDATED: 'Viagem atualizada',
    OPS_TRIP_IMAGE_UPDATED: 'Imagem da viagem atualizada',
    OPS_TRIP_IMAGE_CLEARED: 'Imagem da viagem removida',
    OPS_TRIP_COMPLETED: 'Viagem concluída',
    OPS_SEAT_BLOCKED: 'Assento bloqueado',
    OPS_SEAT_RELEASED: 'Assento liberado',
    OPS_SEAT_CLIENT_ASSIGNED: 'Passageiro alocado em assento',
    OPS_SEAT_ASSIGNMENT_MOVED: 'Passageiro movido de assento',
    OPS_BOARDING_STATUS_CHANGED: 'Status de embarque alterado',
    OPS_BOARDING_BULK_UPDATED: 'Embarque atualizado em lote',
    OPS_BOARDING_QR_SCANNED: 'QR Code de embarque validado',
    OPS_PAYMENT_RECONCILED: 'Pagamento online reconciliado',
    OPS_PAYMENT_REFUNDED: 'Pagamento online estornado',
    OPS_MANUAL_PAYMENT_RECEIVED: 'Recebimento manual registrado',
    OPS_MANUAL_PAYMENT_REVERSED: 'Recebimento manual estornado',
    OPS_FINANCE_PLAN_CREATED: 'Plano financeiro criado',
    OPS_INSTALLMENT_STATUS_CHANGED: 'Status de parcela alterado',
    OPS_QUOTE_CREATED: 'Cotação criada',
    OPS_QUOTE_ITEM_ADDED: 'Item adicionado à cotação',
    OPS_QUOTE_ITEM_REMOVED: 'Item removido da cotação',
    OPS_QUOTE_SENT: 'Cotação enviada',
    OPS_QUOTE_REVISED: 'Cotação revisada',
    OPS_SERVICE_STATUS_CHANGED: 'Status de serviço alterado',
    OPS_MERCADO_PAGO_CONNECTED: 'Mercado Pago conectado',
    OPS_MERCADO_PAGO_DISCONNECTED: 'Mercado Pago desconectado',
  }

  return (
    labels[eventType] ??
    eventType
      .replace(/^OPS_/, '')
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

function auditMetadataSummary(metadata: Record<string, unknown> | null) {
  if (!metadata) return []
  const parts: string[] = []

  const shortId = (value: unknown) =>
    typeof value === 'string'
      ? '#' + value.slice(-8).toUpperCase()
      : null

  const reservationId = shortId(metadata.reservationId)
  if (reservationId) parts.push('Reserva ' + reservationId)

  const tripId = shortId(metadata.tripId)
  if (tripId) parts.push('Viagem ' + tripId)

  const clientId = shortId(metadata.clientId)
  if (clientId) parts.push('Cliente ' + clientId)

  const quoteId = shortId(metadata.quoteId)
  if (quoteId) parts.push('Cotação ' + quoteId)

  if (typeof metadata.seatNumber === 'number') {
    parts.push('Assento ' + metadata.seatNumber)
  }

  if (
    typeof metadata.fromSeatNumber === 'number' &&
    typeof metadata.toSeatNumber === 'number'
  ) {
    parts.push(
      'Assento ' +
        metadata.fromSeatNumber +
        ' → ' +
        metadata.toSeatNumber,
    )
  }

  if (
    typeof metadata.beforeStatus === 'string' &&
    typeof metadata.afterStatus === 'string'
  ) {
    parts.push(metadata.beforeStatus + ' → ' + metadata.afterStatus)
  }

  if (typeof metadata.amountCents === 'number') {
    parts.push(money.format(metadata.amountCents / 100))
  } else if (typeof metadata.totalCents === 'number') {
    parts.push(money.format(metadata.totalCents / 100))
  }

  if (typeof metadata.method === 'string') {
    parts.push('Método ' + metadata.method)
  }

  if (Array.isArray(metadata.changedFields)) {
    const fields = metadata.changedFields
      .filter((value): value is string => typeof value === 'string')
      .slice(0, 6)
    if (fields.length) parts.push('Campos: ' + fields.join(', '))
  }

  return parts.slice(0, 5)
}

function paymentStatusLabel(status: AdminPurchaseOrder['status']) {
  if (status === 'PAID') return 'Pago'
  if (status === 'PENDING_PAYMENT') return 'Aguardando'
  if (status === 'PARTIALLY_REFUNDED') return 'Estorno parcial'
  if (status === 'REFUNDED') return 'Estornado'
  if (status === 'EXPIRED') return 'Expirado'
  return 'Cancelado'
}

function paymentMethodLabel(
  method: AdminPurchaseOrder['paymentMethod'] | 'CASH',
) {
  if (method === 'CARD') return 'Cartão'
  if (method === 'PIX') return 'PIX'
  if (method === 'CASH') return 'Dinheiro'
  if (method === 'BOLETO') return 'Boleto'
  return 'Transferência'
}

function PaymentsWorkspace({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<AdminPaymentsDashboard | null>(null)
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminPurchaseOrder['status']>('ALL')
  const [methodFilter, setMethodFilter] = useState<
    'ALL' | AdminPurchaseOrder['paymentMethod'] | 'CASH'
  >('ALL')
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
      if (
        methodFilter !== 'ALL' &&
        order.paymentMethod !== methodFilter
      ) {
        return false
      }
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

  const manualPayments = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    return (data?.manualPayments ?? []).filter((payment) => {
      if (
        methodFilter !== 'ALL' &&
        payment.method !== methodFilter
      ) {
        return false
      }

      if (
        statusFilter !== 'ALL' &&
        !(
          (statusFilter === 'PAID' && payment.status === 'RECEIVED') ||
          (statusFilter === 'REFUNDED' && payment.status === 'REVERSED')
        )
      ) {
        return false
      }

      if (!normalized) return true

      return [
        payment.id,
        payment.reference ?? '',
        payment.reservation.id,
        payment.reservation.client.fullName,
        payment.reservation.client.email ?? '',
        payment.reservation.client.phone ?? '',
        payment.reservation.trip.title,
        payment.reservation.trip.origin,
        payment.reservation.trip.destination,
      ].some((value) => value.toLowerCase().includes(normalized))
    })
  }, [data, methodFilter, query, statusFilter])

  const summary = data?.summary

  return (
    <section className="admin-payments-workspace">
      <div className="admin-payments-heading">
        <div>
          <span className="eyebrow">Financeiro integrado</span>
          <h2>Pagamentos</h2>
          <p>{data?.summaryOnly ? 'Resumo somente leitura dos pedidos online e recebimentos manuais da própria empresa. Não inclui saldos de crédito ou parcelas em aberto; detalhes e alterações permanecem bloqueados.' : 'PIX, cartão, dinheiro, transferência e boleto em uma única visão.'}</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {error ? <div className="admin-error" role="alert">{error}</div> : null}

      {error && data?.summaryOnly ? <p role="status">Os valores abaixo são do último resumo carregado e não foram atualizados. Tente novamente antes de utilizá-los.</p> : null}
      <div className="admin-payment-metrics">
        <article>
          <small>Recebido</small>
          <strong>{money.format((summary?.paidCents ?? 0) / 100)}</strong>
          <span>
            {summary?.paidOrders ?? 0} online · {summary?.manualReceivedCount ?? 0} manual(is)
          </span>
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
          <span>
            {summary?.refundedOrders ?? 0} online · {summary?.manualReversedCount ?? 0} manual(is)
          </span>
        </article>
      </div>

      {!data?.summaryOnly ? <>
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
            <option value="CASH">Dinheiro</option>
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

      <article className="admin-manual-payment-list">
        <div className="admin-manual-payment-list-head">
          <div>
            <span className="eyebrow">Recebimentos manuais</span>
            <strong>Dinheiro, transferência e boleto</strong>
          </div>
          <span>
            {money.format((summary?.manualReceivedCents ?? 0) / 100)} recebido
            {(summary?.manualReversedCents ?? 0) > 0
              ? ` · ${money.format(
                  (summary?.manualReversedCents ?? 0) / 100,
                )} estornado`
              : ''}
          </span>
        </div>

        {loading ? (
          <p className="admin-empty">Carregando recebimentos...</p>
        ) : manualPayments.length ? (
          manualPayments.map((payment) => (
            <div className="admin-manual-payment-row" key={payment.id}>
              <div className="admin-payment-main">
                <strong>{payment.reservation.client.fullName}</strong>
                <span>{payment.reservation.trip.title}</span>
                <small>
                  {date.format(
                    new Date(payment.reservation.trip.departureDate),
                  )}
                  {' · '}
                  {payment.reservation.trip.origin} →{' '}
                  {payment.reservation.trip.destination}
                </small>
              </div>

              <div>
                <strong>{paymentMethodLabel(payment.method)}</strong>
                <span>{date.format(new Date(payment.paidAt))}</span>
                <small>
                  {payment.reference
                    ? `Ref. ${payment.reference}`
                    : 'Sem referência'}
                </small>
              </div>

              <div>
                <strong>
                  #{payment.reservation.id.slice(-8).toUpperCase()}
                </strong>
                <span>
                  {payment.installment
                    ? payment.installment.sequence === 0
                      ? 'Entrada'
                      : `Parcela ${payment.installment.sequence}`
                    : 'Sem parcela vinculada'}
                </span>
                <small>
                  {payment.recordedBy?.email || 'Sistema'}
                </small>
              </div>

              <div className="admin-payment-value">
                <strong>{money.format(payment.amountCents / 100)}</strong>
                <span>
                  {payment.note || 'Recebimento registrado'}
                </span>
              </div>

              <div className="admin-payment-status-actions">
                <span
                  className={
                    'admin-payment-status admin-payment-status--' +
                    (payment.status === 'RECEIVED'
                      ? 'paid'
                      : 'refunded')
                  }
                >
                  {payment.status === 'RECEIVED'
                    ? 'Recebido'
                    : 'Estornado'}
                </span>
                {payment.reservation.client.phone ? (
                  <button
                    type="button"
                    className="admin-payment-whatsapp"
                    onClick={() =>
                      openWhatsAppTo(
                        payment.reservation.client.phone!,
                        payment.status === 'RECEIVED'
                          ? `Olá, ${payment.reservation.client.fullName}! Registramos o recebimento de ${money.format(
                              payment.amountCents / 100,
                            )} por ${paymentMethodLabel(
                              payment.method,
                            )} referente a ${payment.reservation.trip.title}.`
                          : `Olá, ${payment.reservation.client.fullName}. O lançamento de ${money.format(
                              payment.amountCents / 100,
                            )} referente a ${payment.reservation.trip.title} foi estornado em nosso financeiro.`,
                      )
                    }
                  >
                    WhatsApp
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <p className="admin-empty">
            Nenhum recebimento manual encontrado para estes filtros.
          </p>
        )}
      </article>

      </> : null}
    </section>
  )
}

function AuditWorkspace({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<AdminAuditTrail | null>(null)
  const [category, setCategory] = useState('ALL')
  const [role, setRole] = useState('ALL')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setData(
        await adminApi.auditTrail(accessToken, {
          category,
          role,
          q: query.trim() || undefined,
          from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
          to: to
            ? new Date(to + 'T23:59:59.999').toISOString()
            : undefined,
        }),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível carregar a auditoria.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [accessToken])

  const categories = [
    ['ALL', 'Todas'],
    ['RESERVATIONS', 'Reservas'],
    ['CLIENTS', 'Clientes'],
    ['TRIPS', 'Viagens'],
    ['SEATS', 'Assentos e embarque'],
    ['FINANCE', 'Financeiro'],
    ['COMMERCIAL', 'Comercial'],
    ['SETTINGS', 'Configurações'],
  ]

  return (
    <section className="admin-audit-workspace">
      <div className="admin-audit-heading">
        <div>
          <span className="eyebrow">Rastreabilidade operacional</span>
          <h2>Auditoria</h2>
          <p>
            Histórico central das ações críticas realizadas por Admin,
            Financeiro e Agente.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <History size={15} />
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {error ? <div className="admin-error" role="alert">{error}</div> : null}

      <div className="admin-audit-metrics">
        <article>
          <small>Eventos no filtro</small>
          <strong>{data?.summary.total ?? 0}</strong>
          <span>até 250 exibidos</span>
        </article>
        <article>
          <small>Admin</small>
          <strong>{data?.summary.byRole.ADMIN ?? 0}</strong>
          <span>ações administrativas</span>
        </article>
        <article>
          <small>Financeiro</small>
          <strong>{data?.summary.byRole.FINANCE ?? 0}</strong>
          <span>ações financeiras</span>
        </article>
        <article>
          <small>Agente</small>
          <strong>{data?.summary.byRole.AGENT ?? 0}</strong>
          <span>ações operacionais</span>
        </article>
      </div>

      <form
        className="admin-audit-filters"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <label className="search">
          <span>Buscar</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Evento, usuário, reserva, viagem ou ID"
          />
        </label>

        <label>
          <span>Categoria</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Responsável</span>
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="ALL">Todos</option>
            <option value="ADMIN">Admin</option>
            <option value="FINANCE">Financeiro</option>
            <option value="AGENT">Agente</option>
          </select>
        </label>

        <label>
          <span>De</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>

        <label>
          <span>Até</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>

        <button type="submit" disabled={loading}>
          <Search size={14} />
          Aplicar filtros
        </button>
      </form>

      <article className="admin-audit-list">
        {loading ? (
          <p className="admin-empty">Carregando trilha de auditoria...</p>
        ) : data?.events.length ? (
          data.events.map((event) => {
            const details = auditMetadataSummary(event.metadata)
            return (
              <div className="admin-audit-row" key={event.id}>
                <span
                  className={
                    'admin-audit-category admin-audit-category--' +
                    event.category.toLowerCase()
                  }
                >
                  {auditCategoryLabel(event.category)}
                </span>

                <div className="admin-audit-event">
                  <strong>{auditEventLabel(event.eventType)}</strong>
                  <span>
                    {details.length
                      ? details.join(' · ')
                      : 'Evento operacional registrado'}
                  </span>
                  <small>{event.eventType}</small>
                </div>

                <div className="admin-audit-actor">
                  <strong>{event.user?.email || 'Sistema'}</strong>
                  <span>{event.user?.role || 'SYSTEM'}</span>
                </div>

                <time dateTime={event.createdAt}>
                  {new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  }).format(new Date(event.createdAt))}
                </time>
              </div>
            )
          })
        ) : (
          <p className="admin-empty">
            Nenhum evento encontrado para estes filtros.
          </p>
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
  canCreateReservation,
  canChangeStatus,
  canManagePassengers,
  canCancelReservations,
  canManageBonus,
  canViewFinance,
  onChanged,
}: {
  accessToken: string
  clients: AdminClient[]
  trips: AdminTrip[]
  reservations: AdminReservation[]
  canCreateReservation: boolean
  canChangeStatus: boolean
  canManagePassengers: boolean
  canCancelReservations: boolean
  canManageBonus: boolean
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
  const [accessReservation, setAccessReservation] = useState<AdminReservation | null>(null)

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
      {canCreateReservation ? (
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
      ) : (
        <div className="admin-permission-note">
          <ShieldCheck size={15} />
          <span>Visualização financeira: criação e alteração operacional de reservas ficam bloqueadas.</span>
        </div>
      )}

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
                  {reservation.seatAssignments?.length
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
                {roleFromToken(accessToken) === 'ADMIN' && reservation.companyPortalAccess ? (
                  <button type="button" onClick={() => setAccessReservation(reservation)}>Acesso ao portal</button>
                ) : null}
                {canChangeStatus ? (
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
                ) : (
                  <span className="admin-reservation-status-readonly">
                    {reservation.status === 'PENDING'
                      ? 'Pendente'
                      : reservation.status === 'CONFIRMED'
                        ? 'Confirmada'
                        : reservation.status === 'COMPLETED'
                          ? 'Concluída'
                          : 'Cancelada'}
                  </span>
                )}
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
                {canManageBonus &&
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
                {canCancelReservations &&
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

      {accessReservation ? <ReservationAccessDialog key={accessReservation.id} token={accessToken}
        reservation={accessReservation} onClose={() => setAccessReservation(null)} /> : null}

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
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppAutomationStatus | null>(null)
  const [emailStatus, setEmailStatus] = useState<EmailAutomationStatus | null>(null)
  const [securityPosture, setSecurityPosture] = useState<SecurityPosture | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [whatsappWorking, setWhatsappWorking] = useState(false)
  const [emailWorking, setEmailWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [whatsappMessage, setWhatsappMessage] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailFromName, setEmailFromName] = useState('Próximo Destino')
  const [emailFromEmail, setEmailFromEmail] = useState('')
  const [emailReplyTo, setEmailReplyTo] = useState('')
  const [emailAdminCopy, setEmailAdminCopy] = useState('')
  const [mercadoClientId, setMercadoClientId] = useState('')
  const [mercadoClientSecret, setMercadoClientSecret] = useState('')
  const [mercadoWebhookSecret, setMercadoWebhookSecret] = useState('')
  const [showPaymentConfig, setShowPaymentConfig] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [payment, whatsapp, email, security] = await Promise.all([
        adminApi.paymentConnection(accessToken),
        adminApi.whatsappAutomationStatus(accessToken),
        adminApi.emailAutomationStatus(accessToken),
        adminApi.securityPosture(accessToken),
      ])
      setStatus(payment)
      setWhatsappStatus(whatsapp)
      setEmailStatus(email)
      setSecurityPosture(security)
      setEmailFromName(email.fromName || 'Próximo Destino')
      setEmailFromEmail(email.fromEmail || '')
      setEmailReplyTo(email.replyTo || '')
      setEmailAdminCopy(email.adminCopyEmail || '')
    } finally {
      setLoading(false)
    }
  }

  async function processWhatsapp() {
    setWhatsappWorking(true)
    setWhatsappMessage('')
    try {
      const next = await adminApi.processWhatsAppOutbox(accessToken)
      setWhatsappStatus(next)
      setWhatsappMessage(
        next.providerConfigured
          ? `Fila processada: ${next.processed} item(ns) verificado(s).`
          : 'A fila foi atualizada, mas a API oficial do WhatsApp ainda não está conectada.',
      )
    } catch (cause) {
      setWhatsappMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível processar a fila do WhatsApp.',
      )
    } finally {
      setWhatsappWorking(false)
    }
  }


  async function processEmail() {
    setEmailWorking(true)
    setEmailMessage('')
    try {
      const next = await adminApi.processEmailOutbox(accessToken)
      setEmailStatus(next)
      setEmailMessage(
        next.providerConfigured
          ? `Fila processada: ${next.processed} e-mail(s) verificado(s).`
          : 'Os e-mails estão sendo registrados, mas o provedor de envio ainda não está conectado.',
      )
    } catch (cause) {
      setEmailMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível processar a fila de e-mail.',
      )
    } finally {
      setEmailWorking(false)
    }
  }

  async function connectEmailOAuth() {
    setEmailWorking(true)
    setEmailMessage('')
    try {
      const result = await adminApi.connectResendOAuth(accessToken)
      window.location.assign(result.authorizationUrl)
    } catch (cause) {
      setEmailMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível abrir a autorização do Resend.',
      )
      setEmailWorking(false)
    }
  }

  async function saveEmailSettings() {
    if (!emailFromEmail.trim()) {
      setEmailMessage('Informe o e-mail remetente.')
      return
    }

    setEmailWorking(true)
    setEmailMessage('')
    try {
      const next = await adminApi.updateEmailProviderSettings(
        accessToken,
        {
          fromName: emailFromName.trim() || undefined,
          fromEmail: emailFromEmail.trim(),
          replyToEmail: emailReplyTo.trim() || undefined,
          adminCopyEmail: emailAdminCopy.trim() || undefined,
        },
      )
      setEmailStatus(next)
      setEmailMessage(
        next.productionReady
          ? 'Remetente atualizado. Faça um teste antes de ativar a automação.'
          : 'Remetente salvo. Verifique esse domínio no Resend para liberar clientes.',
      )
    } catch (cause) {
      setEmailMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar o remetente.',
      )
    } finally {
      setEmailWorking(false)
    }
  }

  async function disconnectEmail() {
    if (!window.confirm('Desconectar o provedor de e-mail desta plataforma?')) {
      return
    }
    setEmailWorking(true)
    setEmailMessage('')
    try {
      await adminApi.disconnectEmailProvider(accessToken)
      setEmailMessage('Provedor de e-mail desconectado.')
      await load()
    } catch (cause) {
      setEmailMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível desconectar o e-mail.',
      )
    } finally {
      setEmailWorking(false)
    }
  }

  async function toggleEmailAutomation() {
    if (!emailStatus?.connected) return
    setEmailWorking(true)
    setEmailMessage('')
    try {
      const next = await adminApi.setEmailAutomation(
        accessToken,
        !emailStatus.enabled,
      )
      setEmailStatus(next)
      setEmailMessage(
        next.enabled
          ? 'Envio automático ativado.'
          : 'Envio automático pausado. Novos eventos continuam salvos na fila.',
      )
    } catch (cause) {
      setEmailMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível alterar a automação de e-mail.',
      )
    } finally {
      setEmailWorking(false)
    }
  }

  async function sendEmailTest() {
    setEmailWorking(true)
    setEmailMessage('')
    try {
      const result = await adminApi.sendEmailTest(accessToken)
      const next = await adminApi.emailAutomationStatus(accessToken)
      setEmailStatus(next)

      if (!result.providerConfigured) {
        setEmailMessage(
          'Teste criado na fila, mas o Resend ainda não está conectado.',
        )
      } else if (result.status === 'SENT') {
        setEmailMessage(
          'E-mail de teste enviado com sucesso para o endereço administrativo.',
        )
      } else if (result.status === 'FAILED') {
        setEmailMessage(
          result.errorMessage ||
            'O provedor recusou o e-mail de teste. Verifique a configuração.',
        )
      } else {
        setEmailMessage('E-mail de teste adicionado à fila.')
      }
    } catch (cause) {
      setEmailMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível enviar o e-mail de teste.',
      )
    } finally {
      setEmailWorking(false)
    }
  }

  useEffect(() => {
    void load()

    const url = new URL(window.location.href)
    const emailConnectionResult =
      url.searchParams.get('emailConnection')

    if (emailConnectionResult) {
      setEmailMessage(
        emailConnectionResult === 'success'
          ? 'Conta Resend conectada. Revise o remetente, envie um teste e ative a automação.'
          : 'Não foi possível concluir a autorização do Resend.',
      )
      url.searchParams.delete('emailConnection')
      window.history.replaceState(
        window.history.state,
        '',
        url.pathname + url.search + url.hash,
      )
      void load()
    }

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
      if (
        event.key !== 'mercado-pago-oauth-result' ||
        !event.newValue
      ) {
        return
      }
      try {
        const payload = JSON.parse(event.newValue) as {
          type?: string
          status?: string
        }
        if (payload.type === 'MERCADO_PAGO_OAUTH') {
          applyOAuthResult(payload.status)
        }
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

  async function saveMercadoPagoPlatform() {
    if (
      !mercadoClientId.trim() ||
      !mercadoClientSecret.trim() ||
      !mercadoWebhookSecret.trim()
    ) {
      setMessage('Informe Client ID, Client Secret e segredo do webhook.')
      return
    }

    setWorking(true)
    setMessage('')
    try {
      const next = await adminApi.configureMercadoPagoPlatform(
        accessToken,
        {
          clientId: mercadoClientId.trim(),
          clientSecret: mercadoClientSecret.trim(),
          webhookSecret: mercadoWebhookSecret.trim(),
        },
      )
      setStatus(next)
      setMercadoClientId('')
      setMercadoClientSecret('')
      setMercadoWebhookSecret('')
      setShowPaymentConfig(false)
      setMessage(
        'Configuração salva com segurança. Agora conecte sua conta Mercado Pago.',
      )
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a configuração do Mercado Pago.',
      )
    } finally {
      setWorking(false)
    }
  }

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
          <h2>Integrações</h2>
          <p>Gerencie pagamentos e comunicações automáticas da operação.</p>
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

        {!loading && (!status?.platformConfigured || showPaymentConfig) ? (
          <>
            <div className="email-connection-form">
              <label>
                <span>Client ID</span>
                <input
                  value={mercadoClientId}
                  onChange={(event) => setMercadoClientId(event.target.value)}
                  placeholder="Client ID da aplicação Mercado Pago"
                  autoComplete="off"
                />
              </label>

              <label>
                <span>Client Secret</span>
                <input
                  type="password"
                  value={mercadoClientSecret}
                  onChange={(event) => setMercadoClientSecret(event.target.value)}
                  placeholder="Client Secret"
                  autoComplete="new-password"
                />
                <small>O valor é criptografado antes de ser persistido.</small>
              </label>

              <label>
                <span>Segredo do webhook</span>
                <input
                  type="password"
                  value={mercadoWebhookSecret}
                  onChange={(event) => setMercadoWebhookSecret(event.target.value)}
                  placeholder="Secret signature do webhook"
                  autoComplete="new-password"
                />
                <small>Usado para validar cada notificação de pagamento.</small>
              </label>
            </div>

            <div className="payment-connection-actions">
              <button
                type="button"
                className="payment-primary-action"
                onClick={() => void saveMercadoPagoPlatform()}
                disabled={
                  working ||
                  !mercadoClientId.trim() ||
                  !mercadoClientSecret.trim() ||
                  !mercadoWebhookSecret.trim()
                }
              >
                {working ? 'Salvando...' : 'Salvar configuração segura'}
              </button>
              {status?.platformConfigured ? (
                <button
                  type="button"
                  className="payment-secondary-action"
                  onClick={() => setShowPaymentConfig(false)}
                  disabled={working}
                >
                  Cancelar
                </button>
              ) : null}
            </div>
          </>
        ) : null}

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
              <button
                type="button"
                className="payment-secondary-action"
                onClick={() => setShowPaymentConfig(true)}
                disabled={working}
              >
                Atualizar credenciais
              </button>
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
                  : 'Configuração inicial necessária'}
              </strong>
              <span>
                {status?.platformConfigured
                  ? 'As credenciais centrais já estão protegidas. Agora basta autorizar sua conta diretamente no Mercado Pago.'
                  : 'Informe acima o Client ID, o Client Secret e o segredo do webhook da sua aplicação Mercado Pago. Os segredos ficam criptografados no banco.'}
              </span>
            </div>
            <div className="payment-connection-actions">
              {status?.platformConfigured && !showPaymentConfig ? (
                <button
                  type="button"
                  className="payment-secondary-action"
                  onClick={() => setShowPaymentConfig(true)}
                  disabled={working}
                >
                  Atualizar credenciais
                </button>
              ) : null}
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

      <article className="whatsapp-automation-card">
        <div className="payment-connection-brand">
          <span className="whatsapp-automation-icon"><Phone size={20} /></span>
          <div>
            <strong>WhatsApp automático</strong>
            <span>Confirmação, pagamento, cancelamento, lembrete de viagem e aniversário</span>
          </div>
        </div>

        {loading ? (
          <div className="payment-connection-state">Verificando automação...</div>
        ) : (
          <>
            <div
              className={
                whatsappStatus?.providerConfigured
                  ? 'whatsapp-automation-state whatsapp-automation-state--ready'
                  : 'whatsapp-automation-state whatsapp-automation-state--waiting'
              }
            >
              {whatsappStatus?.providerConfigured ? (
                <CheckCircle2 size={20} />
              ) : (
                <Phone size={20} />
              )}
              <div>
                <strong>
                  {whatsappStatus?.providerConfigured
                    ? 'API oficial conectada'
                    : 'Fila automática ativa · aguardando API oficial'}
                </strong>
                <span>
                  {whatsappStatus?.providerConfigured
                    ? 'Os eventos podem ser enviados automaticamente pela Cloud API.'
                    : 'Os eventos já são gravados com segurança no banco. Nenhuma mensagem é marcada como enviada enquanto a conexão oficial não estiver configurada.'}
                </span>
              </div>
            </div>

            <div className="whatsapp-automation-metrics">
              <div>
                <small>Pendentes</small>
                <strong>{whatsappStatus?.counts.pending ?? 0}</strong>
              </div>
              <div>
                <small>Enviadas</small>
                <strong>{whatsappStatus?.counts.sent ?? 0}</strong>
              </div>
              <div>
                <small>Falhas</small>
                <strong>{whatsappStatus?.counts.failed ?? 0}</strong>
              </div>
            </div>

            <div className="whatsapp-automation-events">
              <span>Reserva confirmada</span>
              <span>Pagamento confirmado</span>
              <span>Cancelamento</span>
              <span>Lembrete 24h</span>
              <span>Aniversário</span>
            </div>

            <div className="payment-connection-actions">
              <button
                type="button"
                className="payment-secondary-action"
                onClick={() => void processWhatsapp()}
                disabled={whatsappWorking}
              >
                {whatsappWorking ? 'Processando...' : 'Processar fila agora'}
              </button>
            </div>
            {whatsappMessage ? (
              <p className="payment-connection-message">{whatsappMessage}</p>
            ) : null}
          </>
        )}
      </article>
      <article className="whatsapp-automation-card">
        <div className="payment-connection-brand">
          <span className="whatsapp-automation-icon"><Mail size={20} /></span>
          <div>
            <strong>E-mail transacional</strong>
            <span>Conta Resend conectada pelo dono · cliente + cópia administrativa</span>
          </div>
        </div>

        {loading ? (
          <div className="payment-connection-state">Verificando e-mail...</div>
        ) : emailStatus?.connected ? (
          <>
            <div
              className={
                emailStatus.productionReady
                  ? 'whatsapp-automation-state whatsapp-automation-state--ready'
                  : 'whatsapp-automation-state whatsapp-automation-state--waiting'
              }
            >
              {emailStatus.productionReady ? (
                <CheckCircle2 size={20} />
              ) : (
                <Mail size={20} />
              )}
              <div>
                <strong>
                  {emailStatus.connectionMode === 'OAUTH'
                    ? emailStatus.productionReady
                      ? emailStatus.enabled
                        ? 'Conta Resend conectada · envio automático ativo'
                        : 'Conta Resend conectada · automação pausada'
                      : 'Conta Resend conectada · remetente em modo de teste'
                    : 'Conectado por chave · migração para login disponível'}
                </strong>
                <span>
                  {emailStatus.connectionMode === 'OAUTH'
                    ? emailStatus.productionReady
                      ? 'A autorização usa OAuth com renovação automática. Nenhuma senha ou chave precisa ser copiada pelo dono.'
                      : 'A conta já está autorizada. Defina abaixo um remetente de domínio próprio verificado no Resend para liberar os clientes.'
                    : 'A integração atual continua funcionando, mas você pode migrar para login Resend sem interromper a fila.'}
                </span>
              </div>
            </div>

            <div className="email-connection-details">
              <div>
                <small>Conexão</small>
                <strong>
                  {emailStatus.connectionMode === 'OAUTH'
                    ? 'Login Resend (OAuth)'
                    : 'Chave de API (legado)'}
                </strong>
              </div>
              <div>
                <small>Remetente</small>
                <strong>{emailStatus.from || 'Não informado'}</strong>
              </div>
              <div>
                <small>Cópia administrativa</small>
                <strong>{emailStatus.adminCopyEmail || 'Administradores ativos'}</strong>
              </div>
            </div>

            <div className="email-connection-form">
              <label>
                <span>Nome do remetente</span>
                <input
                  value={emailFromName}
                  onChange={(event) => setEmailFromName(event.target.value)}
                  placeholder="Próximo Destino"
                />
              </label>

              <label>
                <span>E-mail remetente</span>
                <input
                  type="email"
                  value={emailFromEmail}
                  onChange={(event) => setEmailFromEmail(event.target.value)}
                  placeholder="atendimento@seudominio.com.br"
                />
                <small>O domínio precisa estar verificado no Resend.</small>
              </label>

              <label>
                <span>Responder para</span>
                <input
                  type="email"
                  value={emailReplyTo}
                  onChange={(event) => setEmailReplyTo(event.target.value)}
                  placeholder="atendimento@seudominio.com.br"
                />
              </label>

              <label>
                <span>Cópia administrativa</span>
                <input
                  type="email"
                  value={emailAdminCopy}
                  onChange={(event) => setEmailAdminCopy(event.target.value)}
                  placeholder="administracao@seudominio.com.br"
                />
                <small>Recebe BCC sem aparecer para o cliente.</small>
              </label>
            </div>

            <div className="whatsapp-automation-metrics">
              <div>
                <small>Pendentes</small>
                <strong>{emailStatus.counts.pending}</strong>
              </div>
              <div>
                <small>Enviados</small>
                <strong>{emailStatus.counts.sent}</strong>
              </div>
              <div>
                <small>Falhas</small>
                <strong>{emailStatus.counts.failed}</strong>
              </div>
            </div>

            <div className="whatsapp-automation-events">
              <span>Nova reserva</span>
              <span>Pagamento</span>
              <span>Cotação</span>
              <span>Cancelamento</span>
              <span>Estorno</span>
              <span>Voucher / comprovante</span>
              <span>Lembrete 24h</span>
              <span>Aniversário</span>
            </div>

            <div className="payment-connection-actions">
              {emailStatus.connectionMode !== 'OAUTH' ? (
                <button
                  type="button"
                  className="payment-primary-action"
                  onClick={() => void connectEmailOAuth()}
                  disabled={emailWorking}
                >
                  {emailWorking ? 'Abrindo Resend...' : 'Conectar conta Resend'}
                  <ExternalLink size={15} />
                </button>
              ) : null}
              <button
                type="button"
                className="payment-secondary-action"
                onClick={() => void saveEmailSettings()}
                disabled={emailWorking || !emailFromEmail.trim()}
              >
                Salvar remetente
              </button>
              <button
                type="button"
                className="payment-secondary-action"
                onClick={() => void sendEmailTest()}
                disabled={emailWorking || !emailStatus.adminCopyConfigured}
              >
                Enviar e-mail de teste
              </button>
              <button
                type="button"
                className="payment-secondary-action"
                onClick={() => void toggleEmailAutomation()}
                disabled={
                  emailWorking ||
                  (!emailStatus.productionReady && !emailStatus.enabled)
                }
              >
                {emailStatus.enabled ? 'Pausar automação' : 'Ativar automação'}
              </button>
              <button
                type="button"
                className="payment-secondary-action"
                onClick={() => void processEmail()}
                disabled={emailWorking}
              >
                Processar fila
              </button>
              <button
                type="button"
                className="payment-secondary-action"
                onClick={() => void disconnectEmail()}
                disabled={emailWorking}
              >
                Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="payment-onboarding-steps" aria-label="Etapas para conectar e-mail">
              <div>
                <span>1</span>
                <p><strong>Entrar no Resend</strong><small>O dono autoriza a conta na página oficial.</small></p>
              </div>
              <div>
                <span>2</span>
                <p><strong>Definir remetente</strong><small>Escolha o e-mail verificado da empresa.</small></p>
              </div>
              <div>
                <span>3</span>
                <p><strong>Testar e ativar</strong><small>Valide a entrega antes de liberar clientes.</small></p>
              </div>
            </div>

            <div className="payment-connection-copy">
              <strong>Sem senha e sem copiar chave</strong>
              <span>
                A autorização acontece diretamente no Resend via OAuth. A Próximo Destino recebe apenas a permissão necessária para enviar e-mails.
              </span>
            </div>

            <div className="payment-connection-actions">
              <button
                type="button"
                className="payment-primary-action"
                onClick={() => void connectEmailOAuth()}
                disabled={emailWorking}
              >
                {emailWorking ? 'Abrindo Resend...' : 'Conectar Resend'}
                <ExternalLink size={15} />
              </button>
            </div>
          </>
        )}

        {emailMessage ? (
          <p className="payment-connection-message">{emailMessage}</p>
        ) : null}
      </article>

      <article className="security-posture-card">
        <div className="payment-connection-brand">
          <span className="security-posture-icon">
            <ShieldCheck size={20} />
          </span>
          <div>
            <strong>Segurança da plataforma</strong>
            <span>Verificação automática dos cinco controles críticos</span>
          </div>
        </div>

        {loading ? (
          <div className="payment-connection-state">
            Verificando controles de segurança...
          </div>
        ) : securityPosture ? (
          <>
            <div
              className={
                securityPosture.healthy
                  ? 'security-posture-summary security-posture-summary--ready'
                  : 'security-posture-summary security-posture-summary--attention'
              }
            >
              <ShieldCheck size={20} />
              <div>
                <strong>
                  {securityPosture.healthy
                    ? 'Todos os controles críticos estão ativos'
                    : 'Há controle de segurança que exige atenção'}
                </strong>
                <span>
                  Última verificação em{' '}
                  {new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(securityPosture.checkedAt))}
                </span>
              </div>
            </div>

            <div className="security-checklist">
              {securityPosture.checks.map((check, index) => (
                <div
                  className={
                    check.healthy
                      ? 'security-check security-check--ready'
                      : 'security-check security-check--attention'
                  }
                  key={check.id}
                >
                  <span className="security-check-number">{index + 1}</span>
                  <div>
                    <strong>{check.title}</strong>
                    <small>{check.detail}</small>
                  </div>
                  <span
                    className="security-check-status"
                    aria-label={check.healthy ? 'Protegido' : 'Atenção'}
                  >
                    {check.healthy ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <ShieldCheck size={17} />
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="security-posture-footnote">
              <strong>Defesa em profundidade</strong>
              <span>
                O navegador não acessa o PostgreSQL diretamente. As permissões
                continuam sendo aplicadas pela API autenticada; o RLS funciona
                como barreira adicional para acessos diretos não autorizados.
              </span>
            </div>
          </>
        ) : (
          <div className="payment-connection-state">
            Não foi possível carregar o diagnóstico de segurança.
          </div>
        )}
      </article>
    </section>
  )
}
