import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Plane,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Brand } from '../../components/Brand'
import { WhatsAppButton } from '../../components/WhatsAppButton'
import { fetchClientPortal, type ClientPortalData } from '../../lib/clientPortal'

type ClientPortalProps = {
  accessToken: string
  onLogout: () => void
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
})

const statusLabel: Record<ClientPortalData['status'], string> = {
  PENDING: 'Aguardando confirmação',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
}

export function ClientPortal({ accessToken, onLogout }: ClientPortalProps) {
  const [data, setData] = useState<ClientPortalData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    void fetchClientPortal(accessToken)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar sua viagem.')
      })

    return () => {
      active = false
    }
  }, [accessToken])

  const daysUntil = useMemo(() => {
    if (!data) return null
    const departure = new Date(data.trip.departureDate).getTime()
    return Math.max(0, Math.ceil((departure - Date.now()) / 86_400_000))
  }, [data])

  if (error) {
    return (
      <main className="client-login-panel">
        <div className="client-login-card">
          <Brand compact />
          <h2>Não foi possível abrir sua viagem</h2>
          <p>{error}</p>
          <button className="client-login-submit" type="button" onClick={onLogout}>Voltar ao acesso</button>
        </div>
      </main>
    )
  }

  if (!data) {
    return <div className="admin-loading">Carregando sua viagem...</div>
  }

  return (
    <div className="client-shell">
      <header className="client-topbar">
        <Brand compact />

        <nav className="client-nav" aria-label="Área do cliente">
          <button className="client-nav-item client-nav-item--active" type="button">Minha viagem</button>
        </nav>

        <div className="client-top-actions">
          <button className="text-button" type="button" onClick={onLogout}>Sair</button>
          <span className="client-avatar">{data.client.fullName.slice(0, 2).toUpperCase()}</span>
        </div>
      </header>

      <main className="client-main">
        <section
          className="client-hero"
          style={data.trip.imageUrl ? { backgroundImage: `linear-gradient(90deg, rgba(248,252,255,.98), rgba(248,252,255,.86) 55%, rgba(248,252,255,.56)), url("${data.trip.imageUrl}")` } : undefined}
        >
          <div className="client-hero-content">
            <span className="eyebrow">Sua próxima viagem</span>
            <h1>{data.trip.destination} está chegando.</h1>
            <p>{data.trip.summary || 'Acompanhe aqui os dados confirmados da sua reserva.'}</p>

            <div className="trip-countdown">
              <div><strong>{String(daysUntil ?? 0).padStart(2, '0')}</strong><span>dias</span></div>
              <i />
              <div><strong>{data.passengerCount}</strong><span>viajantes</span></div>
              <i />
              <div><strong>{statusLabel[data.status]}</strong><span>status</span></div>
            </div>
          </div>

          <div className="client-hero-badge">
            <Plane size={22} />
            <div>
              <strong>{data.trip.origin} → {data.trip.destination}</strong>
              <span>{date.format(new Date(data.trip.departureDate))}</span>
            </div>
          </div>
        </section>

        <section className="client-summary-grid">
          <article className="client-summary-card">
            <div className="summary-icon"><CalendarDays size={20} /></div>
            <span>Embarque</span>
            <strong>{date.format(new Date(data.trip.departureDate))}</strong>
            <small>{data.trip.returnDate ? `Retorno: ${date.format(new Date(data.trip.returnDate))}` : 'Retorno a confirmar'}</small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><Users size={20} /></div>
            <span>Passageiros</span>
            <strong>{data.passengerCount}</strong>
            <small>Vinculados a esta solicitação</small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><WalletCards size={20} /></div>
            <span>Valor de referência</span>
            <strong>{data.trip.priceCents == null ? 'A confirmar' : money.format(data.trip.priceCents / 100)}</strong>
            <small>Por pessoa, conforme cadastro da viagem</small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><ShieldCheck size={20} /></div>
            <span>Reserva</span>
            <strong>{statusLabel[data.status]}</strong>
            <small>ID {data.id.slice(-8).toUpperCase()}</small>
          </article>
        </section>

        <section className="client-content-grid">
          <article className="light-panel itinerary-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Viagem</span>
                <h2>Resumo da operação</h2>
              </div>
              <Plane size={20} />
            </div>

            <div className="timeline">
              <div className="timeline-item">
                <span className="timeline-time">01</span><i />
                <div><strong>Solicitação registrada</strong><span>{date.format(new Date(data.createdAt))}</span></div>
              </div>
              <div className="timeline-item">
                <span className="timeline-time">02</span><i />
                <div><strong>Análise da agência</strong><span>{data.status === 'PENDING' ? 'Aguardando confirmação da equipe' : statusLabel[data.status]}</span></div>
              </div>
              <div className="timeline-item">
                <span className="timeline-time">03</span><i />
                <div><strong>Embarque</strong><span>{data.trip.origin} → {data.trip.destination}</span></div>
              </div>
            </div>
          </article>

          <article className="light-panel documents-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Cadastro</span>
                <h2>Seus dados</h2>
              </div>
              <CheckCircle2 size={20} />
            </div>
            <div className="security-checklist">
              <span><CheckCircle2 size={15} /> {data.client.fullName}</span>
              <span><CheckCircle2 size={15} /> {data.client.email || 'E-mail não informado'}</span>
              <span><CheckCircle2 size={15} /> {data.client.phone || 'Telefone não informado'}</span>
            </div>
          </article>

          <article className="light-panel support-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Próximos passos</span>
                <h2>A agência confirma os serviços</h2>
              </div>
              <Clock3 size={20} />
            </div>
            <p>Passagens, hospedagem, transfers, documentos e condições financeiras serão liberados conforme a reserva avançar. Nenhum item não confirmado é exibido como contratado.</p>
          </article>

          <article className="light-panel support-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Assistência</span>
                <h2>Fale com a Próximo Destino</h2>
              </div>
              <MapPin size={20} />
            </div>
            <p>Use o atendimento da agência para ajustes, dúvidas ou confirmação de serviços.</p>
          </article>
        </section>
      </main>

      <WhatsAppButton message={`Olá! Preciso de ajuda com minha reserva ${data.id.slice(-8).toUpperCase()}.`} />
    </div>
  )
}
