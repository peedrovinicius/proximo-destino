import { CalendarDays, FileText, Save, UserRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import {
  adminApi,
  type AdminClientDetail,
} from '../../lib/adminApi'
import { cpfDigits, formatCpf, isValidCpf } from '../../lib/cpf'

type Props = {
  accessToken: string
  clientId: string
  onClose: () => void
  onChanged: () => Promise<void>
}

const shortDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

function toInputDate(value: string | null) {
  return value ? value.slice(0, 10) : ''
}

export function ClientDataDialog({
  accessToken,
  clientId,
  onClose,
  onChanged,
}: Props) {
  const [data, setData] = useState<AdminClientDetail | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [cpf, setCpf] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await adminApi.client(accessToken, clientId)
      setData(result)
      setFullName(result.fullName)
      setEmail(result.email ?? '')
      setPhone(result.phone ?? '')
      setCpf(formatCpf(result.document))
      setBirthDate(toInputDate(result.birthDate))
      setNotes(result.notes ?? '')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível carregar os dados do cliente.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [accessToken, clientId, onClose])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const cpfNormalized = cpfDigits(cpf)
    if (cpfNormalized && !isValidCpf(cpfNormalized)) {
      setError('Informe um CPF válido.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await adminApi.updateClient(accessToken, clientId, {
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        birthDate: birthDate ? `${birthDate}T12:00:00.000Z` : null,
        document: cpfNormalized || null,
        notes: notes.trim(),
      })
      await onChanged()
      await load()
      setSuccess('Dados do cliente atualizados.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar os dados.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="client-data-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="client-data-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-data-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="client-data-header">
          <div>
            <span>Cadastro do cliente</span>
            <h2 id="client-data-title">{data?.fullName ?? 'Dados pessoais'}</h2>
            <small>Informações usadas nas reservas, documentos e atendimento.</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" disabled={saving}>
            <X size={20} />
          </button>
        </header>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}
        {success ? <div className="client-data-success">{success}</div> : null}

        {loading ? (
          <div className="client-data-loading">Carregando cadastro...</div>
        ) : (
          <form className="client-data-form" onSubmit={submit}>
            <div className="client-data-section-heading">
              <UserRound size={18} />
              <div>
                <strong>Dados pessoais</strong>
                <span>Identificação e contato do passageiro principal.</span>
              </div>
            </div>

            <div className="client-data-grid">
              <label className="wide">
                <span>Nome completo</span>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  maxLength={160}
                  required
                />
              </label>

              <label>
                <span>CPF</span>
                <input
                  value={cpf}
                  onChange={(event) => setCpf(formatCpf(event.target.value))}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  placeholder="000.000.000-00"
                />
              </label>

              <label>
                <span>Data de nascimento</span>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(event) => setBirthDate(event.target.value)}
                />
              </label>

              <label>
                <span>Telefone / WhatsApp</span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  maxLength={32}
                  placeholder="(85) 99999-9999"
                />
              </label>

              <label>
                <span>E-mail</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                  placeholder="cliente@email.com"
                />
              </label>

              <label className="wide">
                <span>Observações</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={2000}
                  placeholder="Preferências, informações de atendimento ou observações relevantes."
                />
              </label>
            </div>

            <div className="client-data-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>
                Voltar
              </button>
              <button type="submit" disabled={saving || !fullName.trim()}>
                <Save size={15} />
                {saving ? 'Salvando...' : 'Salvar dados'}
              </button>
            </div>

            <div className="client-data-section-heading client-data-section-heading--history">
              <FileText size={18} />
              <div>
                <strong>Histórico do cliente</strong>
                <span>Reservas e acompanhantes já vinculados.</span>
              </div>
            </div>

            <div className="client-data-stats">
              <article>
                <span>Acompanhantes</span>
                <strong>{data?.companions.length ?? 0}</strong>
              </article>
              <article>
                <span>Reservas</span>
                <strong>{data?.reservations.length ?? 0}</strong>
              </article>
              <article>
                <span>Cadastro</span>
                <strong>
                  {data?.createdAt
                    ? shortDate.format(new Date(data.createdAt))
                    : '—'}
                </strong>
              </article>
            </div>

            {data?.reservations.length ? (
              <div className="client-data-reservations">
                {data.reservations.slice(0, 5).map((reservation) => (
                  <article key={reservation.id}>
                    <CalendarDays size={16} />
                    <div>
                      <strong>{reservation.trip.title}</strong>
                      <span>
                        {shortDate.format(new Date(reservation.trip.departureDate))}
                        {' · '}
                        {reservation.status}
                        {reservation.seatAssignments.length
                          ? ' · Assentos ' +
                            reservation.seatAssignments
                              .map((seat) => seat.seatNumber)
                              .join(', ')
                          : ''}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </form>
        )}
      </section>
    </div>
  )
}
