import {
  Bell,
  CalendarHeart,
  CircleDollarSign,
  FileText,
  Gift,
  Plane,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Brand } from '../../components/Brand'
import {
  adminApi,
  type AdminClient,
  type AdminReservation,
  type AdminTrip,
  type DashboardData,
  type SearchResult,
} from '../../lib/adminApi'
import { openWhatsApp } from '../../lib/whatsapp'

type AdminDashboardProps = {
  accessToken: string
  onLogout: () => void
}

type Tab = 'overview' | 'clients' | 'trips' | 'reservations'

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })

export function AdminDashboard({ accessToken, onLogout }: AdminDashboardProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [trips, setTrips] = useState<AdminTrip[]>([])
  const [reservations, setReservations] = useState<AdminReservation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [dashboardData, clientData, tripData, reservationData] = await Promise.all([
        adminApi.dashboard(accessToken),
        adminApi.clients(accessToken),
        adminApi.trips(accessToken),
        adminApi.reservations(accessToken),
      ])
      setDashboard(dashboardData)
      setClients(clientData)
      setTrips(tripData)
      setReservations(reservationData)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o painel.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [accessToken])

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
    { label: 'Viagens ativas/programadas', value: dashboard?.metrics.activeTrips ?? 0, icon: Plane },
    { label: 'Reservas confirmadas', value: dashboard?.metrics.confirmedReservations ?? 0, icon: CircleDollarSign },
  ], [dashboard])

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Brand compact />

        <nav className="admin-nav" aria-label="Administração">
          <button className={tab === 'overview' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => setTab('overview')} type="button">Visão geral</button>
          <button className={tab === 'clients' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => setTab('clients')} type="button">Clientes</button>
          <button className={tab === 'trips' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => setTab('trips')} type="button">Viagens</button>
          <button className={tab === 'reservations' ? 'admin-nav-item admin-nav-item--active' : 'admin-nav-item'} onClick={() => setTab('reservations')} type="button">Reservas</button>
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
          <button className="round-action" type="button" aria-label="Notificações"><Bell size={17} /></button>
          <button className="admin-avatar" type="button" onClick={onLogout} title="Sair">PV</button>
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
                {searchResult.clients.length ? searchResult.clients.map((item) => <span key={item.id}>{item.fullName}<small>{item.email || item.phone || 'Sem contato'}</small></span>) : <em>Nenhum resultado</em>}
              </div>
              <div>
                <strong>Viagens</strong>
                {searchResult.trips.length ? searchResult.trips.map((item) => <span key={item.id}>{item.title}<small>{item.origin} → {item.destination}</small></span>) : <em>Nenhum resultado</em>}
              </div>
              <div>
                <strong>Reservas</strong>
                {searchResult.reservations.length ? searchResult.reservations.map((item) => <span key={item.id}>{item.client.fullName}<small>{item.trip.title} · {item.status}</small></span>) : <em>Nenhum resultado</em>}
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
          <TripsView accessToken={accessToken} trips={trips} onChanged={reload} />
        ) : null}

        {tab === 'reservations' ? (
          <ReservationsView
            accessToken={accessToken}
            clients={clients}
            trips={trips}
            reservations={reservations}
            onChanged={reload}
          />
        ) : null}
      </main>
    </div>
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
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await adminApi.createClient(accessToken, {
        fullName,
        email: email || undefined,
        phone: phone || undefined,
        birthDate: birthDate ? `${birthDate}T12:00:00.000Z` : undefined,
      })
      setFullName('')
      setEmail('')
      setPhone('')
      setBirthDate('')
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-workspace">
      <form className="admin-form-panel" onSubmit={submit}>
        <div><span className="eyebrow">Novo cadastro</span><h2>Cliente</h2></div>
        <input placeholder="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        <button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Cadastrar cliente'}</button>
      </form>

      <article className="admin-data-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">Base real</span><h2>Clientes</h2></div><strong>{clients.length}</strong></div>
        <div className="admin-table">
          {clients.length ? clients.map((client) => (
            <div className="admin-table-row" key={client.id}>
              <div><strong>{client.fullName}</strong><span>{client.email || 'Sem e-mail'} · {client.phone || 'Sem telefone'}</span></div>
              <span>{client._count.companions} acompanhantes</span>
              <span>{client._count.reservations} reservas</span>
            </div>
          )) : <p className="admin-empty">Nenhum cliente cadastrado ainda.</p>}
        </div>
      </article>
    </section>
  )
}

function TripsView({
  accessToken,
  trips,
  onChanged,
}: {
  accessToken: string
  trips: AdminTrip[]
  onChanged: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [departureDate, setDepartureDate] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await adminApi.createTrip(accessToken, {
        title,
        origin,
        destination,
        departureDate: new Date(`${departureDate}T12:00:00`).toISOString(),
        status: 'SCHEDULED',
        priceCents: price ? Math.round(Number(price.replace(',', '.')) * 100) : undefined,
      })
      setTitle('')
      setOrigin('')
      setDestination('')
      setDepartureDate('')
      setPrice('')
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
        <button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Criar viagem'}</button>
      </form>

      <article className="admin-data-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">Operação</span><h2>Viagens</h2></div><strong>{trips.length}</strong></div>
        <div className="admin-table">
          {trips.length ? trips.map((trip) => (
            <div className="admin-table-row" key={trip.id}>
              <div><strong>{trip.title}</strong><span>{trip.origin} → {trip.destination} · {date.format(new Date(trip.departureDate))}</span></div>
              <span>{trip.status}</span>
              <span>{trip.priceCents == null ? 'Sem preço' : money.format(trip.priceCents / 100)}</span>
            </div>
          )) : <p className="admin-empty">Nenhuma viagem cadastrada no banco.</p>}
        </div>
      </article>
    </section>
  )
}

function ReservationsView({
  accessToken,
  clients,
  trips,
  reservations,
  onChanged,
}: {
  accessToken: string
  clients: AdminClient[]
  trips: AdminTrip[]
  reservations: AdminReservation[]
  onChanged: () => Promise<void>
}) {
  const [clientId, setClientId] = useState('')
  const [tripId, setTripId] = useState('')
  const [saving, setSaving] = useState(false)

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
              <div><strong>{reservation.client.fullName}</strong><span>{reservation.trip.title} · {date.format(new Date(reservation.trip.departureDate))}</span></div>
              <select value={reservation.status} onChange={(e) => void changeStatus(reservation.id, e.target.value as AdminReservation['status'])}>
                <option value="PENDING">Pendente</option>
                <option value="CONFIRMED">Confirmada</option>
                <option value="COMPLETED">Concluída</option>
                <option value="CANCELLED">Cancelada</option>
              </select>
            </div>
          )) : <p className="admin-empty">Nenhuma reserva cadastrada ainda.</p>}
        </div>
      </article>
    </section>
  )
}
