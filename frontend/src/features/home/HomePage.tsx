import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  MapPin,
  MessageCircle,
  Plane,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { Brand } from '../../components/Brand'
import { PublicFooter, type InstitutionalPageKey } from '../../components/PublicFooter'
import { TravelAiAssistant } from '../../components/TravelAiAssistant'
import { WhatsAppButton } from '../../components/WhatsAppButton'
import { fetchPublicTrips, type PublicTrip } from '../../lib/publicApi'
import { openWhatsApp } from '../../lib/whatsapp'
import { TripDetailsPage } from './TripDetailsPage'

type HomePageProps = {
  onClientAccess: () => void
  onAdminAccess: () => void
  onInstitutionalNavigate: (page: InstitutionalPageKey) => void
}

const fallbackImage =
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=84'

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

export function HomePage({
  onClientAccess,
  onAdminAccess,
  onInstitutionalNavigate,
}: HomePageProps) {
  const [catalog, setCatalog] = useState<PublicTrip[]>([])
  const [results, setResults] = useState<PublicTrip[]>([])
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [departure, setDeparture] = useState('')
  const [passengers, setPassengers] = useState('2')
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void fetchPublicTrips()
      .then((items) => {
        if (!active) return
        setCatalog(items)
        setResults(items.slice(0, 6))
        const firstOrigin = [...new Set(items.map((trip) => trip.origin))].sort()[0]
        if (firstOrigin) setOrigin(firstOrigin)
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as viagens.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const origins = useMemo(
    () => [...new Set(catalog.map((trip) => trip.origin))].sort(),
    [catalog],
  )

  const destinations = useMemo(
    () => [
      ...new Set(
        catalog
          .filter((trip) => !origin || trip.origin === origin)
          .map((trip) => trip.destination),
      ),
    ].sort(),
    [catalog, origin],
  )

  if (selectedTripId) {
    return (
      <TripDetailsPage
        tripId={selectedTripId}
        defaultPassengers={Number(passengers)}
        onBack={() => setSelectedTripId(null)}
        onClientAccess={onClientAccess}
      />
    )
  }

  function handleOriginChange(value: string) {
    setOrigin(value)
    setDestination('')
    setSearched(false)
    setResults(
      catalog
        .filter((trip) => !value || trip.origin === value)
        .slice(0, 6),
    )
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const items = await fetchPublicTrips({
        origin: origin || undefined,
        destination: destination || undefined,
        departureDate: departure || undefined,
      })
      setResults(items)
      setSearched(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a busca.')
    } finally {
      setLoading(false)
    }
  }

  function showAll() {
    setDestination('')
    setDeparture('')
    setSearched(false)
    setResults(
      catalog
        .filter((trip) => !origin || trip.origin === origin)
        .slice(0, 6),
    )
  }

  return (
    <div className="public-home">
      <header className="public-header">
        <button className="public-brand-button" type="button" aria-label="Próximo Destino">
          <Brand compact />
        </button>

        <nav className="public-nav" aria-label="Navegação pública">
          <a href="#destinos">Destinos</a>
          <a href="#viagens">Viagens</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#atendimento">Atendimento</a>
        </nav>

        <div className="public-header-actions">
          <button className="public-client-access" type="button" onClick={onClientAccess}>
            Minha viagem
          </button>
          <button className="public-admin-access" type="button" onClick={onAdminAccess}>
            Administração
          </button>
        </div>
      </header>

      <main>
        <section className="public-hero">
          <div className="public-hero-shade" />
          <div className="public-hero-copy">
            <span className="public-kicker">Próximo Destino Turismo e Viagens</span>
            <h1>Para onde você quer ir agora?</h1>
            <p>Escolha uma viagem cadastrada pela agência e solicite sua reserva online.</p>
          </div>

          <form className="travel-search-card" onSubmit={handleSearch}>
            <label>
              <span><MapPin size={15} /> Saindo de</span>
              <select value={origin} onChange={(event) => handleOriginChange(event.target.value)}>
                <option value="">Todas as origens</option>
                {origins.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label>
              <span><Plane size={15} /> Indo para</span>
              <select value={destination} onChange={(event) => setDestination(event.target.value)}>
                <option value="">Todos os destinos disponíveis</option>
                {destinations.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label>
              <span><CalendarDays size={15} /> Ida</span>
              <input
                type="date"
                value={departure}
                onChange={(event) => setDeparture(event.target.value)}
                aria-label="Data de ida"
              />
            </label>

            <label>
              <span><Users size={15} /> Passageiros</span>
              <select value={passengers} onChange={(event) => setPassengers(event.target.value)}>
                <option value="1">1 passageiro</option>
                <option value="2">2 passageiros</option>
                <option value="3">3 passageiros</option>
                <option value="4">4 passageiros</option>
                <option value="5">5 passageiros</option>
              </select>
            </label>

            <button className="travel-search-submit" type="submit" disabled={loading}>
              <Search size={17} />
              {loading ? 'Buscando...' : 'Buscar viagem'}
            </button>
          </form>
        </section>

        <section className="availability-note">
          <ShieldCheck size={17} />
          <div>
            <strong>Catálogo conectado à operação da agência</strong>
            <span>Somente viagens ativas ou programadas no banco de produção são exibidas.</span>
          </div>
        </section>

        <section className="public-section" id="destinos">
          <div className="public-section-heading">
            <div>
              <span className="public-kicker">Destinos disponíveis</span>
              <h2>{searched ? 'Viagens encontradas' : 'Escolha seu próximo destino'}</h2>
              <p>
                {searched
                  ? results.length === 1
                    ? '1 viagem disponível para a sua busca.'
                    : `${results.length} viagens disponíveis para a sua busca.`
                  : origin
                    ? `Viagens ativas ou programadas saindo de ${origin}.`
                    : 'Viagens ativas ou programadas pela agência.'}
              </p>
            </div>
            <button type="button" onClick={showAll}>
              Ver todas
              <ArrowRight size={15} />
            </button>
          </div>

          {error ? <div className="admin-error" role="alert">{error}</div> : null}

          <div className="public-destination-grid" id="viagens">
            {results.map((trip) => {
              const nights = trip.returnDate
                ? Math.max(
                    0,
                    Math.round(
                      (new Date(trip.returnDate).getTime() -
                        new Date(trip.departureDate).getTime()) /
                        86_400_000,
                    ),
                  )
                : null

              return (
                <article className="public-destination-card" key={trip.id}>
                  <div
                    className="public-destination-image"
                    style={{ backgroundImage: `url(${trip.imageUrl || fallbackImage})` }}
                  >
                    <span>{trip.title}</span>
                    <em>{trip.status === 'ACTIVE' ? 'Disponível agora' : 'Programada'}</em>
                  </div>

                  <div className="public-destination-content">
                    <div className="public-route">
                      <div>
                        <small>{trip.origin}</small>
                        <strong>{trip.destination}</strong>
                      </div>
                      <Plane size={18} />
                    </div>

                    <div className="public-trip-meta">
                      <span><CalendarDays size={14} /> {new Date(trip.departureDate).toLocaleDateString('pt-BR')}</span>
                      <span>{nights == null ? 'Retorno a confirmar' : `${nights} noites`}</span>
                    </div>

                    <div className="public-price">
                      <div>
                        <small>A partir de</small>
                        <strong>{trip.priceCents == null ? 'Sob consulta' : money.format(trip.priceCents / 100)}</strong>
                        <span>por pessoa</span>
                      </div>
                      <button type="button" onClick={() => setSelectedTripId(trip.id)}>
                        Ver viagem
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          {!loading && results.length === 0 && (
            <div className="empty-trips">
              <Sparkles size={23} />
              <h3>Nenhuma viagem disponível para essa combinação.</h3>
              <p>Quando a agência publicar uma viagem ativa ou programada, ela aparecerá aqui automaticamente.</p>
            </div>
          )}
        </section>

        <section className="public-benefits" id="como-funciona">
          <article>
            <span>01</span>
            <h3>Escolha</h3>
            <p>Veja somente viagens que existem no sistema operacional da agência.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Solicite</h3>
            <p>Envie seus dados e receba um código individual para acompanhar a solicitação.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Acompanhe</h3>
            <p>A situação da reserva e os dados confirmados ficam no portal privado do viajante.</p>
          </article>
        </section>

        <section className="public-contact" id="atendimento">
          <div>
            <span className="public-kicker">Atendimento humano</span>
            <h2>Quer ajuda para escolher?</h2>
            <p>Converse com a agência e monte sua viagem com atendimento personalizado.</p>
          </div>
          <button
            type="button"
            onClick={() => openWhatsApp('Olá! Gostaria de ajuda para escolher uma viagem disponível.')}
          >
            <MessageCircle size={18} />
            Falar com a Próximo Destino
          </button>
        </section>
      </main>

      <PublicFooter
        onNavigate={onInstitutionalNavigate}
        onAdminAccess={onAdminAccess}
      />

      <TravelAiAssistant />

      <WhatsAppButton
        label="+55 85 99428-4379"
        message="Olá! Gostaria de informações sobre as viagens disponíveis."
      />
    </div>
  )
}
