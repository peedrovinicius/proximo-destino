import { Save, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  adminApi,
  type AdminReservationPassengers,
} from '../../lib/adminApi'

type DraftPassenger = {
  id: string
  sequence: number
  fullName: string
  document: string
  birthDate: string
  isPrimary: boolean
  seatNumber: number | null
}

type Props = {
  accessToken: string
  reservationId: string
  onClose: () => void
  onChanged: () => Promise<void>
}

export function ReservationPassengersDialog({
  accessToken,
  reservationId,
  onClose,
  onChanged,
}: Props) {
  const [data, setData] = useState<AdminReservationPassengers | null>(null)
  const [draft, setDraft] = useState<DraftPassenger[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    void adminApi.reservationPassengers(accessToken, reservationId)
      .then((result) => {
        if (!active) return
        setData(result)
        setDraft(
          result.passengers.map((passenger) => ({
            id: passenger.id,
            sequence: passenger.sequence,
            fullName: passenger.fullName ?? '',
            document: passenger.document ?? '',
            birthDate: passenger.birthDate?.slice(0, 10) ?? '',
            isPrimary: passenger.isPrimary,
            seatNumber: passenger.seatAssignment?.seatNumber ?? null,
          })),
        )
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Falha ao carregar passageiros.')
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
  }, [accessToken, onClose, reservationId])

  const reservationSeats = useMemo(
    () => (data?.seatAssignments ?? []).map((item) => item.seatNumber).sort((a, b) => a - b),
    [data?.seatAssignments],
  )

  function patch(id: string, values: Partial<DraftPassenger>) {
    setDraft((current) =>
      current.map((passenger) =>
        passenger.id === id ? { ...passenger, ...values } : passenger,
      ),
    )
    setMessage('')
  }

  function seatIsUsedByAnother(seat: number, passengerId: string) {
    return draft.some(
      (passenger) =>
        passenger.id !== passengerId && passenger.seatNumber === seat,
    )
  }

  async function save() {
    const primary = draft.find((passenger) => passenger.isPrimary)
    if (!primary?.fullName.trim()) {
      setError('Informe o nome do passageiro titular.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    try {
      const result = await adminApi.updateReservationPassengers(
        accessToken,
        reservationId,
        draft.map((passenger) => ({
          id: passenger.id,
          fullName: passenger.fullName.trim() || null,
          document: passenger.document.trim() || null,
          birthDate: passenger.birthDate
            ? new Date(passenger.birthDate + 'T12:00:00.000Z').toISOString()
            : null,
          seatNumber: passenger.seatNumber,
        })),
      )

      setData(result)
      setDraft(
        result.passengers.map((passenger) => ({
          id: passenger.id,
          sequence: passenger.sequence,
          fullName: passenger.fullName ?? '',
          document: passenger.document ?? '',
          birthDate: passenger.birthDate?.slice(0, 10) ?? '',
          isPrimary: passenger.isPrimary,
          seatNumber: passenger.seatAssignment?.seatNumber ?? null,
        })),
      )
      setMessage('Passageiros e assentos atualizados.')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar passageiros.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="reservation-passengers-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="reservation-passengers-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-passengers-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="reservation-passengers-header">
          <div>
            <span>Reserva #{reservationId.slice(-8).toUpperCase()}</span>
            <h2 id="reservation-passengers-title">Passageiros e assentos</h2>
            {data ? (
              <small>
                {data.client.fullName} · {data.trip.title} · {data.passengerCount} passageiro
                {data.passengerCount === 1 ? '' : 's'}
              </small>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar passageiros">
            <X size={21} />
          </button>
        </header>

        {error ? <div className="reservation-passengers-error">{error}</div> : null}
        {message ? <div className="reservation-passengers-success">{message}</div> : null}

        <div className="reservation-passengers-body">
          {loading ? (
            <p className="admin-empty">Carregando passageiros...</p>
          ) : draft.length ? (
            draft.map((passenger) => (
              <article className="reservation-passenger-card" key={passenger.id}>
                <div className="reservation-passenger-number">
                  <span><UserRound size={16} /></span>
                  <div>
                    <strong>Passageiro {passenger.sequence}</strong>
                    <small>{passenger.isPrimary ? 'Titular da reserva' : 'Acompanhante'}</small>
                  </div>
                </div>

                <label>
                  <span>Nome completo</span>
                  <input
                    value={passenger.fullName}
                    onChange={(event) => patch(passenger.id, { fullName: event.target.value })}
                    placeholder={passenger.isPrimary ? 'Nome do titular' : 'Nome do passageiro'}
                  />
                </label>

                <label>
                  <span>Documento</span>
                  <input
                    value={passenger.document}
                    onChange={(event) => patch(passenger.id, { document: event.target.value })}
                    placeholder="CPF ou documento"
                  />
                </label>

                <label>
                  <span>Data de nascimento</span>
                  <input
                    type="date"
                    value={passenger.birthDate}
                    onChange={(event) => patch(passenger.id, { birthDate: event.target.value })}
                  />
                </label>

                <label>
                  <span>Assento</span>
                  <select
                    value={passenger.seatNumber ?? ''}
                    onChange={(event) =>
                      patch(passenger.id, {
                        seatNumber: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  >
                    <option value="">Sem assento vinculado</option>
                    {reservationSeats.map((seat) => (
                      <option
                        value={seat}
                        key={seat}
                        disabled={seatIsUsedByAnother(seat, passenger.id)}
                      >
                        Assento {seat}
                      </option>
                    ))}
                  </select>
                </label>
              </article>
            ))
          ) : (
            <p className="admin-empty">Nenhum passageiro disponível.</p>
          )}
        </div>

        <footer className="reservation-passengers-footer">
          <div>
            <strong>{draft.filter((item) => item.fullName.trim()).length} de {draft.length}</strong>
            <span>passageiros identificados</span>
          </div>
          <button type="button" onClick={() => void save()} disabled={saving || loading}>
            <Save size={16} />
            {saving ? 'Salvando...' : 'Salvar passageiros'}
          </button>
        </footer>
      </section>
    </div>
  )
}
