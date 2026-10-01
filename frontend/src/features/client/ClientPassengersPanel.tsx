import { CheckCircle2, PencilLine, Save, ShieldCheck, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  updateClientPassengers,
  type ClientPortalData,
} from '../../lib/clientPortal'

type PassengerDraft = {
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
  data: ClientPortalData
  onUpdated: (data: ClientPortalData) => void
}

export function ClientPassengersPanel({
  accessToken,
  data,
  onUpdated,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PassengerDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setDraft(
      data.passengers.map((passenger) => ({
        id: passenger.id,
        sequence: passenger.sequence,
        fullName: passenger.fullName ?? '',
        document: passenger.document ?? '',
        birthDate: passenger.birthDate?.slice(0, 10) ?? '',
        isPrimary: passenger.isPrimary,
        seatNumber: passenger.seatAssignment?.seatNumber ?? null,
      })),
    )
  }, [data.passengers])

  const identified = useMemo(
    () => draft.filter((passenger) => passenger.fullName.trim()).length,
    [draft],
  )

  function patch(id: string, values: Partial<PassengerDraft>) {
    setDraft((current) =>
      current.map((passenger) =>
        passenger.id === id ? { ...passenger, ...values } : passenger,
      ),
    )
    setError('')
    setMessage('')
  }

  function cancel() {
    setDraft(
      data.passengers.map((passenger) => ({
        id: passenger.id,
        sequence: passenger.sequence,
        fullName: passenger.fullName ?? '',
        document: passenger.document ?? '',
        birthDate: passenger.birthDate?.slice(0, 10) ?? '',
        isPrimary: passenger.isPrimary,
        seatNumber: passenger.seatAssignment?.seatNumber ?? null,
      })),
    )
    setEditing(false)
    setError('')
    setMessage('')
  }

  async function save() {
    const missing = draft.find((passenger) => passenger.fullName.trim().length < 2)
    if (missing) {
      setError(`Informe o nome completo do passageiro ${missing.sequence}.`)
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    try {
      const updated = await updateClientPassengers(
        accessToken,
        draft.map((passenger) => ({
          id: passenger.id,
          fullName: passenger.fullName.trim(),
          document: passenger.document.trim() || null,
          birthDate: passenger.birthDate
            ? new Date(passenger.birthDate + 'T12:00:00.000Z').toISOString()
            : null,
        })),
      )
      onUpdated(updated)
      setEditing(false)
      setMessage('Dados dos passageiros atualizados.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível atualizar os passageiros.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="client-passengers-panel">
      <div className="client-passengers-heading">
        <div>
          <span className="eyebrow">Passageiros</span>
          <h2>Dados de quem vai viajar</h2>
          <p>
            Confira os nomes e documentos antes do embarque. Os assentos aparecem
            apenas como referência.
          </p>
        </div>

        {data.canEditPassengers ? (
          editing ? (
            <button className="client-passengers-cancel" type="button" onClick={cancel}>
              <X size={15} />
              Cancelar
            </button>
          ) : (
            <button
              className="client-passengers-edit"
              type="button"
              onClick={() => {
                setEditing(true)
                setMessage('')
                setError('')
              }}
            >
              <PencilLine size={15} />
              Corrigir dados
            </button>
          )
        ) : (
          <span className="client-passengers-locked">
            <ShieldCheck size={14} />
            Edição encerrada
          </span>
        )}
      </div>

      {error ? <div className="client-passengers-error">{error}</div> : null}
      {message ? <div className="client-passengers-success">{message}</div> : null}

      <div className="client-passengers-list">
        {draft.map((passenger) => (
          <article className="client-passenger-card" key={passenger.id}>
            <div className="client-passenger-card-title">
              <span className="client-passenger-avatar">
                <UserRound size={16} />
              </span>
              <div>
                <strong>Passageiro {passenger.sequence}</strong>
                <small>{passenger.isPrimary ? 'Titular da reserva' : 'Acompanhante'}</small>
              </div>
              {passenger.seatNumber ? (
                <em>Assento {passenger.seatNumber}</em>
              ) : null}
            </div>

            {editing ? (
              <div className="client-passenger-form">
                <label>
                  <span>Nome completo</span>
                  <input
                    value={passenger.fullName}
                    onChange={(event) =>
                      patch(passenger.id, { fullName: event.target.value })
                    }
                    autoComplete={passenger.isPrimary ? 'name' : 'off'}
                    required
                  />
                </label>

                <label>
                  <span>Documento</span>
                  <input
                    value={passenger.document}
                    onChange={(event) =>
                      patch(passenger.id, { document: event.target.value })
                    }
                    placeholder="CPF ou documento"
                    inputMode="text"
                  />
                </label>

                <label>
                  <span>Data de nascimento</span>
                  <input
                    type="date"
                    value={passenger.birthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) =>
                      patch(passenger.id, { birthDate: event.target.value })
                    }
                  />
                </label>
              </div>
            ) : (
              <div className="client-passenger-readonly">
                <span>
                  <small>Nome</small>
                  <strong>{passenger.fullName || 'Não informado'}</strong>
                </span>
                <span>
                  <small>Documento</small>
                  <strong>{passenger.document || 'Não informado'}</strong>
                </span>
                <span>
                  <small>Nascimento</small>
                  <strong>
                    {passenger.birthDate
                      ? new Intl.DateTimeFormat('pt-BR').format(
                          new Date(passenger.birthDate),
                        )
                      : 'Não informado'}
                  </strong>
                </span>
              </div>
            )}
          </article>
        ))}
      </div>

      <footer className="client-passengers-footer">
        <div>
          <CheckCircle2 size={15} />
          <span>
            <strong>{identified} de {draft.length}</strong> passageiros identificados
          </span>
        </div>

        {editing ? (
          <button type="button" onClick={() => void save()} disabled={saving}>
            <Save size={15} />
            {saving ? 'Salvando...' : 'Salvar correções'}
          </button>
        ) : null}
      </footer>
    </section>
  )
}
