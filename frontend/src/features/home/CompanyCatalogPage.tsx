import { useEffect, useState, type FormEvent } from 'react'
import { fetchCompanyCatalog, fetchCompanySeats, fetchCompanyTrip, type CompanyCatalog, type CompanyPublicTrip, type PublicCompany } from '../../lib/companyPublicApi'
import type { PublicSeatMap } from '../../lib/publicApi'
import './company-catalog.css'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' })
const tripFromLocation = () => new URLSearchParams(window.location.search).get('trip') || ''
const emptyFilters = { origin: '', destination: '', departureDate: '' }

export function CompanyCatalogPage({ slug, onClientAccess }: { slug: string; onClientAccess: () => void }) {
  const [tripId, setTripId] = useState(tripFromLocation)
  const [filters, setFilters] = useState(emptyFilters)
  const [query, setQuery] = useState(emptyFilters)
  const [catalog, setCatalog] = useState<CompanyCatalog | null>(null)
  const [detail, setDetail] = useState<{ company: PublicCompany; trip: CompanyPublicTrip } | null>(null)
  const [seats, setSeats] = useState<Partial<PublicSeatMap> | null>(null)
  const [seatError, setSeatError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const onPop = () => setTripId(tripFromLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setSeatError(''); setCatalog(null); setDetail(null); setSeats(null)
    const load = async () => {
      try {
        if (tripId) {
          // Independent reads start together; seat failure must not invent availability.
          const [trip, map] = await Promise.allSettled([
            fetchCompanyTrip(slug, tripId, controller.signal), fetchCompanySeats(slug, tripId, controller.signal),
          ])
          if (controller.signal.aborted) return
          if (trip.status === 'rejected') throw trip.reason
          setDetail(trip.value)
          if (map.status === 'fulfilled') setSeats(map.value)
          else setSeatError('Disponibilidade não confirmada. Atualize a consulta antes de se orientar por estes dados.')
        } else {
          const result = await fetchCompanyCatalog(slug, query, controller.signal)
          if (!controller.signal.aborted) setCatalog(result)
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Consulta indisponível.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [slug, tripId, query, revision])

  const company = detail?.company ?? catalog?.company
  useEffect(() => {
    document.title = company ? `${company.tradeName} | Catálogo de viagens` : 'Catálogo de viagens'
    return () => { document.title = 'Próximo Destino' }
  }, [company])

  function navigate(id: string) {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('trip', id)
    else url.searchParams.delete('trip')
    window.history.pushState({}, '', url); setTripId(id)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  function search(event: FormEvent) { event.preventDefault(); setQuery({ ...filters }) }
  const trip = detail?.trip
  const occupied = new Set(seats?.occupiedSeats ?? [])
  const blocked = new Set(seats?.blockedSeats ?? [])
  return <main className="company-catalog">
    <header className="company-catalog-heading">
      <span>Catálogo de viagens</span>
      <h1>{company?.tradeName ?? 'Consulte as viagens da empresa'}</h1>
      <p>Consulta somente leitura. Novas reservas e compras por empresa ainda não estão disponíveis.</p>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading}>Atualizar consulta</button>
      {company ? <button type="button" onClick={onClientAccess}>Acessar minha reserva</button> : null}
    </header>
    {tripId ? <button type="button" onClick={() => navigate('')}>Voltar ao catálogo da empresa</button> :
      <form className="company-catalog-filters" onSubmit={search}>
        <label>Origem<input maxLength={160} value={filters.origin} onChange={e => setFilters({ ...filters, origin: e.target.value })} /></label>
        <label>Destino<input maxLength={160} value={filters.destination} onChange={e => setFilters({ ...filters, destination: e.target.value })} /></label>
        <label>Data de partida (UTC)<input type="date" value={filters.departureDate} onChange={e => setFilters({ ...filters, departureDate: e.target.value })} /></label>
        <button disabled={loading}>Buscar viagens</button>
      </form>}
    {loading ? <p role="status">Carregando consulta…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {catalog ? <>
      {!catalog.trips.length ? <p role="status">Nenhuma viagem disponível para estes filtros.</p> : null}
      {catalog.hasMore ? <p role="status">Exibindo até {catalog.limit} viagens. Refine os filtros para consultar outros destinos.</p> : null}
      <div className="company-catalog-grid">{catalog.trips.map(row => {
        const url = new URL(window.location.href); url.searchParams.set('trip', row.id)
        return <article className="company-catalog-card" key={row.id}>
          <span>{row.origin} → {row.destination}</span><h2>{row.title}</h2>
          <p>{date.format(new Date(row.departureDate))}</p>
          <strong>{row.priceCents === null ? 'Preço sob consulta' : money.format(row.priceCents / 100)}</strong>
          <a href={url.pathname + url.search} onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); navigate(row.id) } }}>Ver detalhes de {row.title}</a>
        </article>
      })}</div>
    </> : null}
    {trip ? <article className="company-catalog-card company-catalog-detail">
      <span>{trip.origin} → {trip.destination}</span><h2>{trip.title}</h2>
      <dl><div><dt>Partida</dt><dd>{date.format(new Date(trip.departureDate))}</dd></div>
        {trip.returnDate ? <div><dt>Retorno</dt><dd>{date.format(new Date(trip.returnDate))}</dd></div> : null}
        <div><dt>Preço por passageiro</dt><dd>{trip.priceCents === null ? 'Sob consulta' : money.format(trip.priceCents / 100)}</dd></div></dl>
      {trip.summary ? <p>{trip.summary}</p> : null}
      <section aria-labelledby="company-seat-heading"><h3 id="company-seat-heading">Disponibilidade de poltronas</h3>
        {seatError ? <p role="alert">{seatError}</p> : null}
        {seats && !seats.enabled ? <p>Mapa não disponível para esta viagem.</p> : null}
        {seats?.enabled && seats.capacity ? <>
          <p>{seats.availableCount} poltronas livres na última consulta. Esta consulta não seleciona nem garante uma poltrona.</p>
          <ul className="company-catalog-seats" aria-label="Disponibilidade somente leitura">{Array.from({ length: seats.capacity }, (_, i) => {
            const number = i + 1, state = blocked.has(number) ? 'Bloqueada' : occupied.has(number) ? 'Ocupada' : 'Livre'
            return <li key={number} className={`company-seat--${state.toLowerCase()}`} aria-label={`Poltrona ${number}: ${state}`}>{number}<small>{state}</small></li>
          })}</ul>
        </> : null}
      </section>
    </article> : null}
  </main>
}
