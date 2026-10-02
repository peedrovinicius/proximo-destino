import {
  ArrowDownCircle,
  ArrowUpCircle,
  MinusCircle,
  WalletCards,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  adminApi,
  type AdminClientCredits,
} from '../../lib/adminApi'

type Props = {
  accessToken: string
  clientId: string
  onClose: () => void
  onChanged: () => Promise<void>
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function typeLabel(type: AdminClientCredits['transactions'][number]['type']) {
  if (type === 'CANCELLATION_CREDIT') return 'Crédito por cancelamento'
  if (type === 'BONUS_USED') return 'Bônus usado em viagem'
  return 'Bônus retirado pelo Admin'
}

export function ClientBonusDialog({
  accessToken,
  clientId,
  onClose,
  onChanged,
}: Props) {
  const [data, setData] = useState<AdminClientCredits | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setData(await adminApi.clientCredits(accessToken, clientId))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível carregar o bônus.',
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
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [accessToken, clientId, onClose])

  const amountCents = useMemo(() => {
    const normalized = amount.replace(/./g, '').replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
  }, [amount])

  async function removeBonus() {
    if (!data || amountCents <= 0 || amountCents > data.balanceCents) return

    setRemoving(true)
    setError('')
    try {
      const result = await adminApi.removeClientBonus(
        accessToken,
        clientId,
        amountCents,
        reason.trim() || undefined,
      )
      setData(result)
      setAmount('')
      setReason('')
      await onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível retirar o bônus.',
      )
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="client-bonus-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="client-bonus-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-bonus-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="client-bonus-header">
          <div>
            <span>Crédito da agência</span>
            <h2 id="client-bonus-title">
              {data?.client.fullName ?? 'Bônus do cliente'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}

        <div className="client-bonus-balance">
          <WalletCards size={22} />
          <div>
            <span>Saldo disponível</span>
            <strong>
              {loading
                ? 'Carregando...'
                : money.format((data?.balanceCents ?? 0) / 100)}
            </strong>
            <small>
              Pode ser usado como desconto em uma próxima viagem.
            </small>
          </div>
        </div>

        <div className="client-bonus-remove">
          <div>
            <strong>Retirar bônus</strong>
            <span>
              Use quando precisar reduzir ou zerar manualmente o saldo.
            </span>
          </div>

          <div className="client-bonus-remove-grid">
            <label>
              <span>Valor</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0,00"
              />
            </label>
            <label>
              <span>Motivo</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: ajuste solicitado pelo cliente"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={
              removing ||
              amountCents <= 0 ||
              amountCents > (data?.balanceCents ?? 0)
            }
            onClick={() => void removeBonus()}
          >
            <MinusCircle size={15} />
            {removing ? 'Retirando...' : 'Retirar do saldo'}
          </button>
        </div>

        <div className="client-bonus-history">
          <div className="client-bonus-history-title">
            <strong>Histórico</strong>
            <span>{data?.transactions.length ?? 0} movimentações</span>
          </div>

          {loading ? (
            <p>Carregando histórico...</p>
          ) : data?.transactions.length ? (
            data.transactions.map((transaction) => {
              const positive = transaction.amountCents > 0
              return (
                <article key={transaction.id}>
                  <span
                    className={
                      'client-bonus-history-icon ' +
                      (positive ? 'positive' : 'negative')
                    }
                  >
                    {positive ? (
                      <ArrowUpCircle size={17} />
                    ) : (
                      <ArrowDownCircle size={17} />
                    )}
                  </span>
                  <div>
                    <strong>{typeLabel(transaction.type)}</strong>
                    <span>
                      {transaction.note || 'Movimentação de bônus'}
                      {transaction.reservation
                        ? ' · ' + transaction.reservation.trip.title
                        : ''}
                    </span>
                    <small>
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(transaction.createdAt))}
                      {transaction.actor?.email
                        ? ' · ' + transaction.actor.email
                        : ''}
                    </small>
                  </div>
                  <strong className={positive ? 'positive' : 'negative'}>
                    {positive ? '+' : '-'}
                    {money.format(Math.abs(transaction.amountCents) / 100)}
                  </strong>
                </article>
              )
            })
          ) : (
            <p>Nenhuma movimentação de bônus ainda.</p>
          )}
        </div>
      </section>
    </div>
  )
}
