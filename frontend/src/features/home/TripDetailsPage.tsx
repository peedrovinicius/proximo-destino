import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Plane,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Brand } from '../../components/Brand'
import {
  fetchPublicTrip,
  requestReservation,
  type PublicTrip,
  type ReservationRequestResult,
} from '../../lib/publicApi'

type TripDetailsPageProps = {
  tripId: string
  defaultPassengers: number
  onBack: () => void
  onClientAccess: () => void
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
})

export function TripDetailsPage({
  tripId,
  defaultPassengers,
  onBack,
  onClientAccess,
}: TripDetailsPageProps) {
  const [trip, setTrip] = useState<PublicTrip | null>(null)
  const [error, setError] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [passengerCount, setPassengerCount] = useState(defaultPassengers)
  const [submitting, setSubmitting] = useState(false)
  const [requestResult, setRequestResult] = useState<ReservationRequestResult | null>(null)

  useEffect(() => {
    let active = true

    void fetchPublicTrip(tripId)
      .then((result) => {
        if (active) setTrip(result)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Viagem indisponível.')
      })

    return () => {
      active = false
    }
  }, [tripId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trip) return

    setSubmitting(true)
    setError('')

    try {
      const result = await requestReservation({
        tripId: trip.id,
        fullName,
        email,
        phone,
        passengerCount,
      })
      setRequestResult(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar sua solicitação.')
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !trip) {
    return (
      <main className="trip-details-shell">
        <button className="trip-details-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar</button>
        <div className="empty-trips"><h3>Viagem indisponível</h3><p>{error}</p></div>
      </main>
    )
  }

  if (!trip) {
    return <div className="admin-loading">Carregando viagem...</div>
  }

  const nights = trip.returnDate
    ? Math.max(
        0,
        Math.round(
          (new Date(trip.returnDate).getTime() - new Date(trip.departureDate).getTime()) /
          86_400_000,
        ),
      )
    : null

  return (
    <div className="trip-details-page">
      <header className="public-header">
        <button className="public-brand-button" type="button" onClick={onBack} aria-label="Próximo Destino">
          <Brand compact />
        </button>
        <button className="trip-details-back" type="button" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar às viagens
        </button>
        <button className="public-client-access" type="button" onClick={onClientAccess}>Minha viagem</button>
      </header>

      <main className="trip-details-shell">
        <section
          className="trip-details-hero"
          style={trip.imageUrl ? { backgroundImage: `linear-gradient(90deg, rgba(10,35,56,.82), rgba(10,35,56,.28)), url("${trip.imageUrl}")` } : undefined}
        >
          <div>
            <span className="public-kicker">{trip.status === 'ACTIVE' ? 'Disponível agora' : 'Viagem programada'}</span>
            <h1>{trip.title}</h1>
            <p>{trip.summary || 'Solicite sua reserva e a agência confirma os serviços e condições.'}</p>
          </div>
        </section>

        <section className="trip-details-grid">
          <article className="trip-details-info">
            <div className="trip-route-large">
              <div><small>Origem</small><strong>{trip.origin}</strong></div>
              <Plane size={22} />
              <div><small>Destino</small><strong>{trip.destination}</strong></div>
            </div>

            <div className="trip-detail-facts">
              <span><CalendarDays size={16} /><strong>Ida</strong>{date.format(new Date(trip.departureDate))}</span>
              <span><CalendarDays size={16} /><strong>Retorno</strong>{trip.returnDate ? date.format(new Date(trip.returnDate)) : 'A confirmar'}</span>
              <span><Users size={16} /><strong>Duração</strong>{nights == null ? 'A confirmar' : `${nights} noites`}</span>
              <span><MapPin size={16} /><strong>Capacidade</strong>{trip.capacity == null ? 'Sob consulta' : `Até ${trip.capacity} viajantes`}</span>
            </div>

            <div className="trip-details-price">
              <span>A partir de</span>
              <strong>{trip.priceCents == null ? 'Sob consulta' : money.format(trip.priceCents / 100)}</strong>
              <small>por pessoa. Serviços e condições finais são confirmados pela agência.</small>
            </div>

            <div className="availability-note">
              <ShieldCheck size={17} />
              <div>
                <strong>Solicitação sem cobrança automática</strong>
                <span>O envio abaixo registra interesse. A reserva permanece pendente até confirmação da agência.</span>
              </div>
            </div>
          </article>

          <aside className="trip-reservation-card">
            {requestResult ? (
              <div className="reservation-success">
                <CheckCircle2 size={30} />
                <span className="eyebrow">Solicitação registrada</span>
                <h2>Guarde seu código de acesso</h2>
                <code>{requestResult.accessCode}</code>
                <p>Use este código junto com <strong>{email}</strong> em “Minha viagem”. Ele não será exibido novamente.</p>
                <button type="button" onClick={onClientAccess}>Acessar minha viagem</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <span className="eyebrow">Quero esta viagem</span>
                <h2>Solicitar reserva</h2>
                <p>A equipe recebe seus dados e confirma disponibilidade e condições.</p>

                <label>
                  Nome completo
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </label>
                <label>
                  E-mail
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                  WhatsApp
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(85) 99999-9999" required />
                </label>
                <label>
                  Passageiros
                  <select value={passengerCount} onChange={(e) => setPassengerCount(Number(e.target.value))}>
                    {[1,2,3,4,5,6,7,8,9,10].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>

                {error ? <p className="admin-login-error" role="alert">{error}</p> : null}

                <button type="submit" disabled={submitting}>
                  {submitting ? 'Registrando...' : 'Enviar solicitação'}
                </button>
              </form>
            )}
          </aside>
        </section>
      </main>
    </div>
  )
}
