import {
  ArrowDownCircle,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  adminApi,
  type AdminReservationFinance,
} from '../../lib/adminApi'

type Props = {
  accessToken: string
  reservationId: string
  onClose: () => void
  onChanged: () => Promise<void>
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function paymentStatusLabel(status: NonNullable<AdminReservationFinance['purchaseOrder']>['status']) {
  if (status === 'PAID') return 'Pago'
  if (status === 'PENDING_PAYMENT') return 'Aguardando pagamento'
  if (status === 'PARTIALLY_REFUNDED') return 'Estorno parcial'
  if (status === 'REFUNDED') return 'Estornado'
  if (status === 'EXPIRED') return 'Expirado'
  return 'Cancelado'
}

function paymentMethodLabel(method: NonNullable<AdminReservationFinance['purchaseOrder']>['paymentMethod']) {
  if (method === 'CARD') return 'Cartão'
  if (method === 'PIX') return 'PIX'
  if (method === 'BOLETO') return 'Boleto'
  return 'Transferência'
}

function installmentLabel(status: 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED') {
  if (status === 'PAID') return 'Pago'
  if (status === 'OVERDUE') return 'Vencido'
  if (status === 'CANCELLED') return 'Cancelado'
  return 'Em aberto'
}

export function ReservationFinanceDialog({
  accessToken,
  reservationId,
  onClose,
  onChanged,
}: Props) {
  const [data, setData] = useState<AdminReservationFinance | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [confirmRefund, setConfirmRefund] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setData(await adminApi.reservationFinance(accessToken, reservationId))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível carregar o financeiro da reserva.',
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
      if (event.key === 'Escape' && !working) onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [accessToken, reservationId, onClose])

  const refundAmountCents = useMemo(() => {
    const normalized = refundAmount.replace(/\./g, '').replace(',', '.')
    const value = Number(normalized)
    return Number.isFinite(value) ? Math.round(value * 100) : 0
  }, [refundAmount])

  async function reconcile() {
    if (working) return
    setWorking(true)
    setError('')
    setMessage('')

    try {
      const result = await adminApi.reconcileReservationPayment(
        accessToken,
        reservationId,
      )
      setData(result)
      setMessage('Pagamento reconciliado com o Mercado Pago.')
      await onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível reconciliar o pagamento.',
      )
    } finally {
      setWorking(false)
    }
  }

  async function refund() {
    if (
      !data ||
      working ||
      refundAmountCents <= 0 ||
      refundAmountCents > data.summary.refundableCents
    ) {
      return
    }

    setWorking(true)
    setError('')
    setMessage('')

    try {
      const result = await adminApi.refundReservationPayment(
        accessToken,
        reservationId,
        refundAmountCents,
        refundReason.trim() || undefined,
      )
      setData(result)
      setRefundAmount('')
      setRefundReason('')
      setConfirmRefund(false)
      setMessage(
        'Estorno solicitado ao Mercado Pago e registrado na reserva.',
      )
      await onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível realizar o estorno.',
      )
    } finally {
      setWorking(false)
    }
  }

  const canRefund =
    Boolean(data?.purchaseOrder) &&
    data?.reservation.status === 'CANCELLED' &&
    (data?.summary.refundableCents ?? 0) > 0

  return (
    <div
      className="reservation-finance-overlay"
      role="presentation"
      onMouseDown={() => {
        if (!working) onClose()
      }}
    >
      <section
        className="reservation-finance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-finance-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="reservation-finance-header">
          <div>
            <span>Centro financeiro da reserva</span>
            <h2 id="reservation-finance-title">
              {data?.reservation.client.fullName ?? 'Financeiro'}
            </h2>
            {data ? (
              <small>
                {data.reservation.trip.title} · #{data.reservation.id.slice(-8).toUpperCase()}
              </small>
            ) : null}
          </div>

          <button
            type="button"
            aria-label="Fechar financeiro"
            disabled={working}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}
        {message ? (
          <div className="reservation-finance-success">
            <CheckCircle2 size={16} />
            <span>{message}</span>
          </div>
        ) : null}

        {loading || !data ? (
          <div className="reservation-finance-loading">
            Carregando dados financeiros...
          </div>
        ) : (
          <>
            <div className="reservation-finance-summary">
              <article>
                <span>Total</span>
                <strong>{money.format(data.summary.totalCents / 100)}</strong>
                <small>Valor contratado</small>
              </article>
              <article>
                <span>Recebido</span>
                <strong>{money.format(data.summary.grossPaidCents / 100)}</strong>
                <small>Antes de estornos</small>
              </article>
              <article>
                <span>Estornado</span>
                <strong>{money.format(data.summary.refundedCents / 100)}</strong>
                <small>Valor devolvido</small>
              </article>
              <article>
                <span>Saldo líquido</span>
                <strong>{money.format(data.summary.netPaidCents / 100)}</strong>
                <small>
                  {data.summary.outstandingCents > 0
                    ? money.format(data.summary.outstandingCents / 100) + ' pendente'
                    : 'Sem saldo pendente'}
                </small>
              </article>
            </div>

            {data.purchaseOrder ? (
              <section className="reservation-finance-provider">
                <div className="reservation-finance-section-head">
                  <div>
                    <span>Pagamento online</span>
                    <strong>Mercado Pago</strong>
                  </div>
                  <span
                    className={
                      'reservation-finance-status reservation-finance-status--' +
                      data.purchaseOrder.status.toLowerCase()
                    }
                  >
                    {paymentStatusLabel(data.purchaseOrder.status)}
                  </span>
                </div>

                <div className="reservation-finance-provider-grid">
                  <div>
                    <span>Método</span>
                    <strong>{paymentMethodLabel(data.purchaseOrder.paymentMethod)}</strong>
                  </div>
                  <div>
                    <span>Valor</span>
                    <strong>{money.format(data.purchaseOrder.totalCents / 100)}</strong>
                  </div>
                  <div>
                    <span>Status no gateway</span>
                    <strong>{data.purchaseOrder.providerStatus || 'Aguardando sincronização'}</strong>
                  </div>
                  <div>
                    <span>Última conciliação</span>
                    <strong>
                      {data.purchaseOrder.lastReconciledAt
                        ? dateTime.format(new Date(data.purchaseOrder.lastReconciledAt))
                        : 'Ainda não realizada'}
                    </strong>
                  </div>
                </div>

                <div className="reservation-finance-provider-actions">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void reconcile()}
                  >
                    <RefreshCw size={15} />
                    {working ? 'Processando...' : 'Reconciliar agora'}
                  </button>
                </div>
              </section>
            ) : null}

            {data.financePlan ? (
              <section className="reservation-finance-installments">
                <div className="reservation-finance-section-head">
                  <div>
                    <span>Plano financeiro</span>
                    <strong>Parcelas da reserva</strong>
                  </div>
                  <WalletCards size={18} />
                </div>

                <div className="reservation-finance-installment-list">
                  {data.financePlan.installments.map((installment) => (
                    <article key={installment.id}>
                      <div>
                        <strong>
                          {installment.sequence === 0
                            ? 'Entrada'
                            : 'Parcela ' + installment.sequence}
                        </strong>
                        <span>
                          Vencimento{' '}
                          {new Intl.DateTimeFormat('pt-BR', {
                            dateStyle: 'short',
                          }).format(new Date(installment.dueDate))}
                        </span>
                      </div>
                      <strong>{money.format(installment.amountCents / 100)}</strong>
                      <span
                        className={
                          'reservation-finance-installment-status reservation-finance-installment-status--' +
                          installment.status.toLowerCase()
                        }
                      >
                        {installmentLabel(installment.status)}
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {data.credits.length ? (
              <section className="reservation-finance-credits">
                <div className="reservation-finance-section-head">
                  <div>
                    <span>Créditos e bônus</span>
                    <strong>Movimentações desta reserva</strong>
                  </div>
                  <CircleDollarSign size={18} />
                </div>

                <div className="reservation-finance-credit-list">
                  {data.credits.map((credit) => (
                    <article key={credit.id}>
                      <ArrowDownCircle
                        size={16}
                        className={credit.amountCents > 0 ? 'positive' : 'negative'}
                      />
                      <div>
                        <strong>
                          {credit.type === 'CANCELLATION_CREDIT'
                            ? 'Bônus gerado'
                            : credit.type === 'BONUS_USED'
                              ? 'Bônus utilizado'
                              : 'Ajuste de bônus'}
                        </strong>
                        <span>{credit.note || 'Movimentação registrada'}</span>
                      </div>
                      <strong className={credit.amountCents > 0 ? 'positive' : 'negative'}>
                        {credit.amountCents > 0 ? '+' : '-'}
                        {money.format(Math.abs(credit.amountCents) / 100)}
                      </strong>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="reservation-finance-refund">
              <div className="reservation-finance-section-head">
                <div>
                  <span>Estorno / reembolso</span>
                  <strong>
                    {canRefund
                      ? 'Valor disponível para devolver'
                      : 'Sem estorno disponível agora'}
                  </strong>
                </div>
                <RotateCcw size={18} />
              </div>

              {canRefund ? (
                <>
                  <div className="reservation-finance-refundable">
                    <ShieldCheck size={18} />
                    <div>
                      <span>Máximo reembolsável</span>
                      <strong>
                        {money.format(data.summary.refundableCents / 100)}
                      </strong>
                    </div>
                  </div>

                  <div className="reservation-finance-refund-form">
                    <label>
                      <span>Valor do estorno</span>
                      <input
                        inputMode="decimal"
                        value={refundAmount}
                        onChange={(event) => {
                          setRefundAmount(event.target.value)
                          setConfirmRefund(false)
                        }}
                        placeholder="0,00"
                      />
                    </label>

                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setRefundAmount(
                          (data.summary.refundableCents / 100)
                            .toFixed(2)
                            .replace('.', ','),
                        )
                        setConfirmRefund(false)
                      }}
                    >
                      Estornar tudo
                    </button>

                    <label className="reason">
                      <span>Motivo</span>
                      <input
                        value={refundReason}
                        onChange={(event) => setRefundReason(event.target.value)}
                        placeholder="Ex.: cancelamento solicitado pelo cliente"
                        maxLength={300}
                      />
                    </label>
                  </div>

                  {confirmRefund ? (
                    <div className="reservation-finance-refund-confirm">
                      <div>
                        <strong>
                          Confirmar estorno de{' '}
                          {money.format(refundAmountCents / 100)}?
                        </strong>
                        <span>
                          Esta ação envia a solicitação ao Mercado Pago e não pode ser desfeita pela plataforma.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="danger"
                        disabled={working}
                        onClick={() => void refund()}
                      >
                        <RotateCcw size={15} />
                        {working ? 'Estornando...' : 'Confirmar estorno'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={working}
                        onClick={() => setConfirmRefund(false)}
                      >
                        Voltar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="reservation-finance-refund-start"
                      disabled={
                        working ||
                        refundAmountCents <= 0 ||
                        refundAmountCents > data.summary.refundableCents
                      }
                      onClick={() => setConfirmRefund(true)}
                    >
                      <RotateCcw size={15} />
                      Revisar estorno
                    </button>
                  )}
                </>
              ) : (
                <p className="reservation-finance-note">
                  O estorno automático fica disponível para compras online pagas depois que a reserva é cancelada. Pagamentos manuais permanecem registrados no plano financeiro.
                </p>
              )}
            </section>

            <section className="reservation-finance-history">
              <div className="reservation-finance-section-head">
                <div>
                  <span>Auditoria</span>
                  <strong>Histórico financeiro</strong>
                </div>
                <Clock3 size={18} />
              </div>

              {data.events.length ? (
                data.events.map((event) => (
                  <article key={event.id}>
                    <span className="reservation-finance-history-icon">
                      {event.eventType === 'OPS_PAYMENT_REFUNDED' ? (
                        <RotateCcw size={15} />
                      ) : (
                        <RefreshCw size={15} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {event.eventType === 'OPS_PAYMENT_REFUNDED'
                          ? 'Estorno realizado'
                          : 'Pagamento reconciliado'}
                      </strong>
                      <span>
                        {event.user?.email || 'Sistema'}
                        {' · '}
                        {dateTime.format(new Date(event.createdAt))}
                      </span>
                    </div>
                    {event.eventType === 'OPS_PAYMENT_REFUNDED' &&
                    typeof event.metadata?.amountCents === 'number' ? (
                      <strong>
                        {money.format(event.metadata.amountCents / 100)}
                      </strong>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="reservation-finance-note">
                  Ainda não há movimentações de reconciliação ou estorno.
                </p>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  )
}
