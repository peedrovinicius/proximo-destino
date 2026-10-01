import {
  Check,
  Clock3,
  Search,
  UserCheck,
  UserX,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  adminApi,
  type AdminBoardingList,
  type BoardingStatus,
} from '../../lib/adminApi'

type Props = {
  accessToken: string
  tripId: string
  onClose: () => void
}

const statusLabel: Record<BoardingStatus, string> = {
  PENDING: 'Aguardando',
  BOARDED: 'Embarcou',
  ABSENT: 'Ausente',
}

export function TripBoardingDialog({
  accessToken,
  tripId,
  onClose,
}: Props) {
  const [data, setData] = useState<AdminBoardingList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'ALL' | BoardingStatus>('ALL')
  const [savingPassengerId, setSavingPassengerId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void adminApi.boardingList(accessToken, tripId)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar a lista de embarque.',
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

  const filteredPassengers = useMemo(() => {
    if (!data) return []

    const normalizedQuery = query.trim().toLowerCase()

    return data.passengers.filter((passenger) => {
      if (filter !== 'ALL' && passenger.boardingStatus !== filter) return false
      if (!normalizedQuery) return true

      const searchable = [
        passenger.fullName,
        passenger.document,
        passenger.reservation.client.fullName,
        passenger.reservation.id,
        passenger.seatAssignment?.seatNumber?.toString(),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchable.includes(normalizedQuery)
    })
  }, [data, filter, query])

  async function updateStatus(
    passengerId: string,
    status: BoardingStatus,
  ) {
    if (!data?.canUpdate || savingPassengerId) return

    setSavingPassengerId(passengerId)
    setError('')

    try {
      setData(
        await adminApi.updateBoardingStatus(
          accessToken,
          tripId,
          passengerId,
          status,
        ),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível atualizar o embarque.',
      )
    } finally {
      setSavingPassengerId(null)
    }
  }

  return (
    <div
      className="boarding-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="boarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="boarding-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="boarding-header">
          <div>
            <span>Operação de embarque</span>
            <h2 id="boarding-title">
              {data?.trip.title ?? 'Lista de embarque'}
            </h2>
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

          <button type="button" onClick={onClose} aria-label="Fechar lista de embarque">
            <X size={21} />
          </button>
        </header>

        {error ? <div className="boarding-error">{error}</div> : null}

        {data ? (
          <div className="boarding-summary">
            <button
              type="button"
              className={filter === 'ALL' ? 'active' : ''}
              onClick={() => setFilter('ALL')}
            >
              <strong>{data.summary.total}</strong>
              <span>Total</span>
            </button>
            <button
              type="button"
              className={filter === 'PENDING' ? 'active' : ''}
              onClick={() => setFilter('PENDING')}
            >
              <strong>{data.summary.pending}</strong>
              <span>Aguardando</span>
            </button>
            <button
              type="button"
              className={filter === 'BOARDED' ? 'active' : ''}
              onClick={() => setFilter('BOARDED')}
            >
              <strong>{data.summary.boarded}</strong>
              <span>Embarcaram</span>
            </button>
            <button
              type="button"
              className={filter === 'ABSENT' ? 'active' : ''}
              onClick={() => setFilter('ABSENT')}
            >
              <strong>{data.summary.absent}</strong>
              <span>Ausentes</span>
            </button>
          </div>
        ) : null}

        <div className="boarding-toolbar">
          <label>
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar passageiro, assento ou reserva"
            />
          </label>

          {data && !data.canUpdate ? (
            <span className="boarding-readonly">
              Operação encerrada
            </span>
          ) : null}
        </div>

        <div className="boarding-list">
          {loading ? (
            <p className="admin-empty">Carregando lista de embarque...</p>
          ) : filteredPassengers.length ? (
            filteredPassengers.map((passenger) => {
              const displayName =
                passenger.fullName?.trim() ||
                `Passageiro ${passenger.sequence} · ${passenger.reservation.client.fullName}`
              const saving = savingPassengerId === passenger.id

              return (
                <article
                  className={'boarding-row boarding-row--' + passenger.boardingStatus.toLowerCase()}
                  key={passenger.id}
                >
                  <div className="boarding-seat">
                    <span>Assento</span>
                    <strong>{passenger.seatAssignment?.seatNumber ?? '—'}</strong>
                  </div>

                  <div className="boarding-passenger">
                    <strong>{displayName}</strong>
                    <span>
                      {passenger.isPrimary ? 'Titular' : 'Acompanhante'}
                      {' · '}
                      Reserva #{passenger.reservation.id.slice(-8).toUpperCase()}
                    </span>
                    <small>
                      {passenger.document || 'Documento não informado'}
                      {passenger.reservation.client.phone
                        ? ' · ' + passenger.reservation.client.phone
                        : ''}
                    </small>
                  </div>

                  <div className={'boarding-status boarding-status--' + passenger.boardingStatus.toLowerCase()}>
                    {passenger.boardingStatus === 'BOARDED' ? (
                      <UserCheck size={15} />
                    ) : passenger.boardingStatus === 'ABSENT' ? (
                      <UserX size={15} />
                    ) : (
                      <Clock3 size={15} />
                    )}
                    <span>{statusLabel[passenger.boardingStatus]}</span>
                    {passenger.boardedAt ? (
                      <small>
                        {new Intl.DateTimeFormat('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(passenger.boardedAt))}
                      </small>
                    ) : null}
                  </div>

                  <div className="boarding-actions">
                    <button
                      type="button"
                      className="board"
                      disabled={!data?.canUpdate || saving}
                      onClick={() => void updateStatus(passenger.id, 'BOARDED')}
                    >
                      <Check size={14} />
                      Embarcou
                    </button>
                    <button
                      type="button"
                      className="absent"
                      disabled={!data?.canUpdate || saving}
                      onClick={() => void updateStatus(passenger.id, 'ABSENT')}
                    >
                      <UserX size={14} />
                      Ausente
                    </button>
                    {passenger.boardingStatus !== 'PENDING' ? (
                      <button
                        type="button"
                        className="pending"
                        disabled={!data?.canUpdate || saving}
                        onClick={() => void updateStatus(passenger.id, 'PENDING')}
                      >
                        <Clock3 size={14} />
                        Aguardando
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })
          ) : (
            <p className="admin-empty">
              Nenhum passageiro encontrado para este filtro.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
