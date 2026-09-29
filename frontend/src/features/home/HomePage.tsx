import { type FormEvent, useMemo, useState } from 'react'
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
import { WhatsAppButton } from '../../components/WhatsAppButton'
import {
  availableDestinations,
  availableOrigins,
  findTrips,
  searchableTrips,
} from '../../data/publicTrips'

type HomePageProps = {
  onClientAccess: () => void
  onAdminAccess: () => void
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

export function HomePage({ onClientAccess, onAdminAccess }: HomePageProps) {
  const origins = availableOrigins()
  const [origin, setOrigin] = useState(origins[0] ?? '')
  const [destination, setDestination] = useState('')
  const [departure, setDeparture] = useState('')
  const [passengers, setPassengers] = useState('2')
  const [searched, setSearched] = useState(false)

  const destinations = useMemo(() => availableDestinations(origin), [origin])
  const results = useMemo(
    () => (searched ? findTrips(origin, destination) : searchableTrips().slice(0, 6)),
    [destination, origin, searched],
  )

  function handleOriginChange(value: string) {
    setOrigin(value)
    setDestination('')
    setSearched(false)
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault()
    setSearched(true)
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
            <p>Escolha uma viagem disponível e deixe a agência cuidar do restante.</p>
          </div>

          <form className="travel-search-card" onSubmit={handleSearch}>
            <label>
              <span><MapPin size={15} /> Saindo de</span>
              <select value={origin} onChange={(event) => handleOriginChange(event.target.value)}>
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

            <button className="travel-search-submit" type="submit">
              <Search size={17} />
              Buscar viagem
            </button>
          </form>
        </section>

        <section className="availability-note">
          <ShieldCheck size={17} />
          <div>
            <strong>Busca vinculada à operação da agência</strong>
            <span>Somente destinos com viagens ativas ou programadas são exibidos.</span>
          </div>
        </section>

        <section className="public-section" id="destinos">
          <div className="public-section-heading">
            <div>
              <span className="public-kicker">Destinos disponíveis</span>
              <h2>{searched ? 'Viagens encontradas' : 'Escolha seu próximo destino'}</h2>
              <p>
                {searched
                  ? `${results.length} opção(ões) disponível(is) para a sua busca.`
                  : 'Viagens que já estão ativas ou programadas pela Próximo Destino.'}
              </p>
            </div>
            <button type="button" onClick={() => { setDestination(''); setSearched(false) }}>
              Ver todas
              <ArrowRight size={15} />
            </button>
          </div>

          <div className="public-destination-grid">
            {results.map((trip) => (
              <article className="public-destination-card" key={trip.id}>
                <div
                  className="public-destination-image"
                  style={{ backgroundImage: `url(${trip.image})` }}
                >
                  <span>{trip.tag}</span>
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
                    <span><CalendarDays size={14} /> {new Date(`${trip.departureDate}T12:00:00`).toLocaleDateString('pt-BR')}</span>
                    <span>{trip.nights} noites</span>
                  </div>

                  <div className="public-price">
                    <div>
                      <small>A partir de</small>
                      <strong>{money.format(trip.priceFrom)}</strong>
                      <span>por pessoa</span>
                    </div>
                    <button type="button" onClick={onClientAccess}>
                      Ver viagem
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {results.length === 0 && (
            <div className="empty-trips">
              <Sparkles size={23} />
              <h3>Nenhuma viagem disponível para essa combinação.</h3>
              <p>Escolha outro destino. Rotas sem operação ativa não aparecem na pesquisa.</p>
            </div>
          )}
        </section>

        <section className="public-benefits" id="como-funciona">
          <article>
            <span>01</span>
            <h3>Escolha</h3>
            <p>Veja apenas destinos que a agência realmente tem operação ativa ou já programada.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Reserve</h3>
            <p>A agência organiza passagem, hospedagem, transfer, passeios e condições de pagamento.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Acompanhe</h3>
            <p>Depois da contratação, roteiro, documentos e parcelas ficam no seu portal privado.</p>
          </article>
        </section>

        <section className="public-contact" id="atendimento">
          <div>
            <span className="public-kicker">Atendimento humano</span>
            <h2>Quer ajuda para escolher?</h2>
            <p>Converse com a agência e monte sua viagem com atendimento personalizado.</p>
          </div>
          <button type="button">
            <MessageCircle size={18} />
            Falar com a Próximo Destino
          </button>
        </section>
      </main>

      <footer className="public-footer">
        <Brand compact />
        <span>Próximo Destino · Turismo e viagens</span>
        <button type="button" onClick={onAdminAccess}>Área administrativa</button>
      </footer>

      <WhatsAppButton
        label="Falar no WhatsApp"
        message="Olá! Gostaria de informações sobre as viagens disponíveis."
      />
    </div>
  )
}
