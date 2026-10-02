import { TicketPercent, WalletCards, X } from 'lucide-react'
import { useMemo, useState } from 'react'
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

export function ReservationBonusDialog({
  accessToken,
  reservation,
  onClose,
  onChanged,
}: Props) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const amountCents = useMemo(() => {
    const normalized = amount.replace(/./g, '').replace(',', '.')
    const value = Number(normalized)
    return Number.isFinite(value) ? Math.round(value * 100) : 0
  }, [amount])

  async function apply() {
    if (
      submitting ||
      amountCents <= 0 ||
      amountCents > reservation.client.bonusBalanceCents
    ) {
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const result = await adminApi.applyReservationBonus(
        accessToken,
        reservation.id,
        amountCents,
        note.trim() || undefined,
      )
      setSuccess(
        'Bônus aplicado. Novo valor da cotação: ' +
          money.format(result.quoteTotalCents / 100),
      )
      await onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível aplicar o bônus.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="reservation-bonus-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="reservation-bonus-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-bonus-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Desconto com bônus</span>
            <h2 id="reservation-bonus-title">{reservation.client.fullName}</h2>
            <small>{reservation.trip.title}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}

        <div className="reservation-bonus-balance">
          <WalletCards size={21} />
          <div>
            <span>Saldo disponível</span>
            <strong>
              {money.format(reservation.client.bonusBalanceCents / 100)}
            </strong>
          </div>
        </div>

        {success ? (
          <div className="reservation-bonus-success">
            <TicketPercent size={18} />
            <span>{success}</span>
            <button type="button" onClick={onClose}>Concluir</button>
          </div>
        ) : (
          <>
            <label>
              <span>Valor a usar como desconto</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0,00"
              />
            </label>
            <label>
              <span>Observação</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ex.: crédito do cancelamento anterior"
              />
            </label>

            <p>
              O bônus é aplicado à cotação aprovada antes da geração do plano financeiro. O histórico permanece visível para a agência e para o passageiro.
            </p>

            <div className="reservation-bonus-actions">
              <button type="button" className="secondary" onClick={onClose}>
                Voltar
              </button>
              <button
                type="button"
                disabled={
                  submitting ||
                  amountCents <= 0 ||
                  amountCents > reservation.client.bonusBalanceCents
                }
                onClick={() => void apply()}
              >
                <TicketPercent size={15} />
                {submitting ? 'Aplicando...' : 'Aplicar bônus'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
