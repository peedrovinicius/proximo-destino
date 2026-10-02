import { Ban, CheckCircle2, WalletCards, X } from 'lucide-react'
import { useState } from 'react'
import { adminApi, type AdminReservation } from '../../lib/adminApi'

type Props = {
  accessToken: string
  reservation: AdminReservation
  onClose: () => void
  onChanged: () => Promise<void>
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function ReservationCancelDialog({
  accessToken,
  reservation,
  onClose,
  onChanged,
}: Props) {
  const [creditAsBonus, setCreditAsBonus] = useState(true)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    paidCents: number
    bonusGrantedCents: number
  } | null>(null)
  const [error, setError] = useState('')

  async function confirm() {
    if (submitting) return

    setSubmitting(true)
    setError('')
    try {
      const response = await adminApi.cancelReservation(
        accessToken,
        reservation.id,
        {
          creditAsBonus,
          reason: reason.trim() || undefined,
        },
      )
      setResult({
        paidCents: response.paidCents,
        bonusGrantedCents: response.bonusGrantedCents,
      })
      await onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível cancelar a reserva.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="reservation-cancel-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="reservation-cancel-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-cancel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Cancelamento da reserva</span>
            <h2 id="reservation-cancel-title">{reservation.client.fullName}</h2>
            <small>{reservation.trip.title}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}

        {result ? (
          <div className="reservation-cancel-result">
            <CheckCircle2 size={22} />
            <div>
              <strong>Reserva cancelada e assentos liberados</strong>
              <span>
                Valor pago identificado: {money.format(result.paidCents / 100)}.
              </span>
              <span>
                Bônus gerado: {money.format(result.bonusGrantedCents / 100)}.
              </span>
            </div>
            <button type="button" onClick={onClose}>Concluir</button>
          </div>
        ) : (
          <>
            <div className="reservation-cancel-warning">
              <Ban size={19} />
              <div>
                <strong>O cancelamento libera imediatamente as poltronas.</strong>
                <span>
                  Serviços pendentes são cancelados e parcelas ainda abertas deixam de ser cobradas. Valores já pagos permanecem registrados.
                </span>
              </div>
            </div>

            <label className="reservation-cancel-bonus">
              <input
                type="checkbox"
                checked={creditAsBonus}
                onChange={(event) => setCreditAsBonus(event.target.checked)}
              />
              <WalletCards size={19} />
              <div>
                <strong>Converter o valor pago elegível em bônus</strong>
                <span>
                  O cliente poderá usar esse saldo como desconto em uma próxima viagem.
                </span>
              </div>
            </label>

            <label className="reservation-cancel-reason">
              <span>Motivo do cancelamento</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: cliente solicitou cancelamento e optou por manter o valor como crédito."
                maxLength={300}
              />
            </label>

            <div className="reservation-cancel-actions">
              <button
                type="button"
                className="secondary"
                disabled={submitting}
                onClick={onClose}
              >
                Voltar
              </button>
              <button
                type="button"
                className="danger"
                disabled={submitting}
                onClick={() => void confirm()}
              >
                {submitting ? 'Cancelando...' : 'Confirmar cancelamento'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
