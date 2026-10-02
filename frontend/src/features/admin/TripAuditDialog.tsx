import {
  Armchair,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  History,
  Lock,
  Unlock,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  adminApi,
  type AdminOperationalAudit,
} from '../../lib/adminApi'

type Props = {
  accessToken: string
  tripId: string
  onClose: () => void
}

const eventLabels: Record<string, string> = {
  OPS_SEAT_CLIENT_ASSIGNED: 'Cliente cadastrado na poltrona',
  OPS_SEAT_BLOCKED: 'Poltrona bloqueada',
  OPS_SEAT_RELEASED: 'Poltrona liberada',
  OPS_SEAT_MOVED: 'Passageiro mudou de poltrona',
  OPS_BOARDING_UPDATED: 'Embarque atualizado',
  OPS_BOARDING_BULK_UPDATED: 'Embarque em massa atualizado',
  OPS_TRIP_COMPLETED: 'Viagem concluída',
}

function EventIcon({ eventType }: { eventType: string }) {
  if (eventType === 'OPS_SEAT_CLIENT_ASSIGNED') return <UserPlus size={16} />
  if (eventType === 'OPS_SEAT_MOVED') return <ArrowRightLeft size={16} />
  if (eventType === 'OPS_SEAT_BLOCKED') return <Lock size={16} />
  if (eventType === 'OPS_SEAT_RELEASED') return <Unlock size={16} />
  if (eventType === 'OPS_TRIP_COMPLETED') return <CheckCircle2 size={16} />
  if (eventType.includes('BOARDING')) return <UserCheck size={16} />
  return <History size={16} />
}

function metaText(
  eventType: string,
  metadata: Record<string, unknown> | null,
) {
  if (!metadata) return ''

  const seat = typeof metadata.seatNumber === 'number'
    ? 'Poltrona ' + metadata.seatNumber
    : ''
  const reservation = typeof metadata.reservationId === 'string'
    ? 'Reserva #' + metadata.reservationId.slice(-8).toUpperCase()
    : ''

  if (eventType === 'OPS_SEAT_CLIENT_ASSIGNED') {
    return [seat, reservation].filter(Boolean).join(' · ')
  }

  if (eventType === 'OPS_SEAT_BLOCKED' || eventType === 'OPS_SEAT_RELEASED') {
    return seat
  }

  if (eventType === 'OPS_SEAT_MOVED') {
    const from =
      typeof metadata.fromSeatNumber === 'number'
        ? 'Poltrona ' + metadata.fromSeatNumber
        : ''
    const to =
      typeof metadata.toSeatNumber === 'number'
        ? 'Poltrona ' + metadata.toSeatNumber
        : ''
    return [
      from && to ? from + ' → ' + to : from || to,
      reservation,
    ].filter(Boolean).join(' · ')
  }

  if (eventType === 'OPS_BOARDING_UPDATED') {
    const from = typeof metadata.fromStatus === 'string' ? metadata.fromStatus : ''
    const to = typeof metadata.toStatus === 'string' ? metadata.toStatus : ''
    return [
      seat,
      reservation,
      from && to ? from + ' → ' + to : to,
    ].filter(Boolean).join(' · ')
  }

  if (eventType === 'OPS_BOARDING_BULK_UPDATED') {
    const count =
      typeof metadata.passengerCount === 'number'
        ? metadata.passengerCount + ' passageiro(s)'
        : ''
    const to = typeof metadata.toStatus === 'string' ? metadata.toStatus : ''
    return [count, to].filter(Boolean).join(' · ')
  }

  return ''
}

export function TripAuditDialog({
  accessToken,
  tripId,
  onClose,
}: Props) {
  const [data, setData] = useState<AdminOperationalAudit | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    void adminApi.operationalAudit(accessToken, tripId)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar a auditoria.',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      active = false
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [accessToken, onClose, tripId])

  const events = useMemo(() => data?.events ?? [], [data])

  return (
    <div
      className="trip-audit-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="trip-audit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-audit-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="trip-audit-header">
          <div>
            <span>Rastreabilidade operacional</span>
            <h2 id="trip-audit-title">{data?.trip.title ?? 'Auditoria da viagem'}</h2>
            {data ? (
              <small>
                {data.trip.origin} → {data.trip.destination}
                {' · '}
                {new Intl.DateTimeFormat('pt-BR', {
                  dateStyle: 'medium',
                }).format(new Date(data.trip.departureDate))}
              </small>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar auditoria">
            <X size={20} />
          </button>
        </header>

        <div className="trip-audit-note">
          <History size={16} />
          <span>
            Registro somente leitura das ações críticas feitas pelo Admin nesta viagem.
          </span>
        </div>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}

        <div className="trip-audit-list">
          {loading ? (
            <p className="admin-empty">Carregando histórico operacional...</p>
          ) : events.length ? (
            events.map((event) => {
              const details = metaText(event.eventType, event.metadata)
              return (
                <article className="trip-audit-event" key={event.id}>
                  <span className="trip-audit-event-icon">
                    <EventIcon eventType={event.eventType} />
                  </span>

                  <div className="trip-audit-event-copy">
                    <strong>
                      {eventLabels[event.eventType] ?? event.eventType}
                    </strong>
                    {details ? <span>{details}</span> : null}
                    <small>
                      {event.user?.email ?? 'Usuário não disponível'}
                      {' · '}
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(event.createdAt))}
                    </small>
                  </div>

                  <span className="trip-audit-event-code">
                    {event.user?.role ?? 'SISTEMA'}
                  </span>
                </article>
              )
            })
          ) : (
            <div className="trip-audit-empty">
              <Clock3 size={20} />
              <strong>Nenhuma ação operacional registrada ainda</strong>
              <span>
                Novos bloqueios, cadastros em poltrona, embarques e encerramentos aparecerão aqui.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
