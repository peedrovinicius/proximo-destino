import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Download,
  MapPin,
  Bus,
  ShieldCheck,
  Users,
  WalletCards,
  Gift,
  ArrowDownCircle,
  ArrowUpCircle,
  Armchair,
  Ban,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Brand } from '../../components/Brand'
import { SeatSelector } from '../../components/SeatSelector'
import { WhatsAppButton } from '../../components/WhatsAppButton'
import { ClientPassengersPanel } from './ClientPassengersPanel'
import {
  approveClientQuote,
  fetchClientPortal,
  openClientDocumentPdf,
  rejectClientQuote,
  requestClientCancellation,
  retryClientPayment,
  updateClientSeats,
  type ClientPaymentStartResult,
  type ClientPortalData,
} from '../../lib/clientPortal'

type ClientPortalProps = {
  accessToken: string
  onExitToSite: () => void
  onLogout: () => void
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
})

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const statusLabel: Record<ClientPortalData['status'], string> = {
  PENDING: 'Aguardando confirmação',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
}

const categoryLabel = {
  FLIGHT: 'Passagem',
  HOTEL: 'Hospedagem',
  TRANSFER: 'Transfer',
  TOUR: 'Passeio',
  INSURANCE: 'Seguro',
  OTHER: 'Outro',
} as const

const serviceStatusLabel = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
} as const

const installmentStatusLabel = {
  OPEN: 'Em aberto',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
} as const

export function ClientPortal({
  accessToken,
  onExitToSite,
  onLogout,
}: ClientPortalProps) {
  const [data, setData] = useState<ClientPortalData | null>(null)
  const [error, setError] = useState('')
  const [responding, setResponding] = useState(false)
  const [paymentStarting, setPaymentStarting] = useState(false)
  const [paymentResult, setPaymentResult] = useState<ClientPaymentStartResult | null>(null)
  const [pixCopied, setPixCopied] = useState(false)
  const [seatSelectorOpen, setSeatSelectorOpen] = useState(false)
  const seatTriggerRef = useRef<HTMLElement | null>(null)
  const [seatSaving, setSeatSaving] = useState(false)
  const [cancellationOpen, setCancellationOpen] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')
  const [cancellationSubmitting, setCancellationSubmitting] = useState(false)

  async function loadPortal() {
    setError('')
    try {
      setData(await fetchClientPortal(accessToken))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar sua viagem.')
    }
  }

  useEffect(() => {
    void loadPortal()
  }, [accessToken])

  const daysUntil = useMemo(() => {
    if (!data) return null
    const departure = new Date(data.trip.departureDate).getTime()
    return Math.max(0, Math.ceil((departure - Date.now()) / 86_400_000))
  }, [data])

  async function answerQuote(action: 'approve' | 'reject') {
    if (!data?.quotes[0]) return
    setResponding(true)
    setError('')

    try {
      if (action === 'approve') {
        await approveClientQuote(accessToken, data.quotes[0].id)
      } else {
        await rejectClientQuote(accessToken, data.quotes[0].id)
      }
      await loadPortal()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar sua resposta.')
    } finally {
      setResponding(false)
    }
  }

  async function resumePayment() {
    setPaymentStarting(true)
    setError('')

    try {
      const result = await retryClientPayment(accessToken)
      setPaymentResult(result)

      if (result.kind === 'CHECKOUT') {
        window.location.assign(result.checkoutUrl)
      }

      if (result.kind === 'PAID') {
        await loadPortal()
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível iniciar o pagamento.',
      )
    } finally {
      setPaymentStarting(false)
    }
  }

  async function copyPixCode() {
    if (paymentResult?.kind !== 'PIX') return

    try {
      await navigator.clipboard.writeText(paymentResult.qrCode)
      setPixCopied(true)
      window.setTimeout(() => setPixCopied(false), 1800)
    } catch {
      setPixCopied(false)
    }
  }

  async function openSeatChange() {
    seatTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement : null
    setError('')
    try {
      const latest = await fetchClientPortal(accessToken)
      setData(latest)
      if (!latest.canChangeSeats) {
        setError(
          'A troca de poltrona não está mais disponível para esta viagem.',
        )
        return
      }
      setSeatSelectorOpen(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível atualizar a disponibilidade dos assentos.',
      )
    }
  }

  async function saveSeats(selectedSeats: number[]) {
    setSeatSaving(true)
    setError('')
    try {
      setData(await updateClientSeats(accessToken, selectedSeats))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível trocar a poltrona.',
      )
    } finally {
      setSeatSaving(false)
    }
  }

  async function submitCancellationRequest() {
    const reason = cancellationReason.trim()
    if (reason.length < 5) {
      setError('Informe brevemente o motivo do cancelamento.')
      return
    }

    setCancellationSubmitting(true)
    setError('')
    try {
      setData(await requestClientCancellation(accessToken, reason))
      setCancellationOpen(false)
      setCancellationReason('')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível enviar a solicitação de cancelamento.',
      )
    } finally {
      setCancellationSubmitting(false)
    }
  }

  async function openDocument(documentId: string) {
    try {
      await openClientDocumentPdf(accessToken, documentId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o documento.')
    }
  }

  if (error && !data) {
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

  const quote = data.quotes[0] ?? null
  const contractedValue = data.financePlan?.totalCents ?? (
    quote?.status === 'APPROVED' ? quote.totalCents : null
  )

  return (
    <div className="client-shell">
      <header className="client-topbar">
        <Brand compact />

        <nav className="client-nav" aria-label="Área do cliente">
          <button className="client-nav-item client-nav-item--active" type="button">Minha viagem</button>
        </nav>

        <div className="client-top-actions">
          <button className="text-button" type="button" onClick={onExitToSite}>Voltar ao site</button>
          <button className="text-button" type="button" onClick={onLogout}>Sair</button>
          <span className="client-avatar">{data.client.fullName.slice(0, 2).toUpperCase()}</span>
        </div>
      </header>

      <main className="client-main">
        {error ? <div className="admin-error" role="alert">{error}</div> : null}

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
            <Bus size={22} />
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
            <small>
              {data.seatAssignments.length
                ? `Assentos: ${data.seatAssignments.map((seat) => seat.seatNumber).join(', ')}`
                : 'Vinculados a esta solicitação'}
            </small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><WalletCards size={20} /></div>
            <span>{contractedValue == null ? 'Valor de referência' : 'Valor contratado'}</span>
            <strong>
              {contractedValue == null
                ? data.trip.priceCents == null
                  ? 'A confirmar'
                  : money.format(data.trip.priceCents / 100)
                : money.format(contractedValue / 100)}
            </strong>
            <small>{contractedValue == null ? 'A cotação final ainda será confirmada' : 'Conforme cotação aprovada'}</small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><ShieldCheck size={20} /></div>
            <span>Reserva</span>
            <strong>{statusLabel[data.status]}</strong>
            <small>ID {data.id.slice(-8).toUpperCase()}</small>
          </article>
        </section>

        <section className="client-bonus-panel">
          <div className="client-bonus-panel-main">
            <span className="client-bonus-panel-icon"><Gift size={21} /></span>
            <div>
              <span className="eyebrow">Bônus Próximo Destino</span>
              <h2>{money.format(data.bonus.balanceCents / 100)}</h2>
              <p>
                Saldo disponível para desconto em uma próxima viagem. A agência aplica o bônus antes de gerar o novo plano financeiro.
              </p>
            </div>
          </div>

          {data.bonus.transactions.length ? (
            <div className="client-bonus-transactions">
              {data.bonus.transactions.slice(0, 4).map((transaction) => (
                <div className="client-bonus-transaction" key={transaction.id}>
                  <span
                    className={
                      'client-bonus-transaction-icon ' +
                      (transaction.amountCents > 0 ? 'positive' : 'negative')
                    }
                  >
                    {transaction.amountCents > 0 ? (
                      <ArrowUpCircle size={15} />
                    ) : (
                      <ArrowDownCircle size={15} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {transaction.type === 'CANCELLATION_CREDIT'
                        ? 'Crédito por cancelamento'
                        : transaction.type === 'BONUS_USED'
                          ? 'Bônus usado em viagem'
                          : 'Ajuste do bônus'}
                    </strong>
                    <span>
                      {transaction.reservation?.trip.title ||
                        transaction.note ||
                        'Movimentação do saldo'}
                    </span>
                  </div>
                  <strong
                    className={
                      transaction.amountCents > 0 ? 'positive' : 'negative'
                    }
                  >
                    {transaction.amountCents > 0 ? '+' : '-'}
                    {money.format(Math.abs(transaction.amountCents) / 100)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <span className="client-bonus-empty">
              Você ainda não possui movimentações de bônus.
            </span>
          )}
        </section>

        <ClientPassengersPanel
          accessToken={accessToken}
          data={data}
          onUpdated={setData}
        />

        {data.seatMap.enabled && data.seatMap.capacity ? (
          <section className="client-seat-panel">
            <div className="client-seat-panel-main">
              <span className="client-seat-panel-icon">
                <Armchair size={22} />
              </span>
              <div>
                <span className="eyebrow">Poltronas da viagem</span>
                <h2>
                  {data.seatAssignments.length
                    ? `Assentos ${data.seatAssignments
                        .map((seat) => seat.seatNumber)
                        .join(', ')}`
                    : 'Escolha suas poltronas'}
                </h2>
                <p>
                  {data.canChangeSeats
                    ? 'Você pode trocar suas poltronas por lugares disponíveis até 24 horas antes do embarque.'
                    : `Alterações encerradas em ${dateTime.format(
                        new Date(data.seatChangeCutoffAt),
                      )}.`}
                </p>
              </div>
            </div>

            <div className="client-seat-panel-actions">
              <span>
                {data.seatMap.availableCount ?? 0} lugares disponíveis no mapa
              </span>
              <button
                type="button"
                onClick={() => void openSeatChange()}
                disabled={!data.canChangeSeats || seatSaving}
              >
                <Armchair size={16} />
                {seatSaving ? 'Atualizando...' : 'Trocar poltrona'}
              </button>
            </div>
          </section>
        ) : null}

        <section
          className={
            'client-cancellation-panel' +
            (data.cancellationRequestStatus
              ? ' client-cancellation-panel--' +
                data.cancellationRequestStatus.toLowerCase()
              : '')
          }
        >
          <div className="client-cancellation-main">
            <span className="client-cancellation-icon">
              <Ban size={21} />
            </span>
            <div>
              <span className="eyebrow">Cancelamento</span>
              <h2>
                {data.cancellationRequestStatus === 'PENDING'
                  ? 'Solicitação enviada para análise'
                  : data.cancellationRequestStatus === 'APPROVED'
                    ? 'Cancelamento aprovado'
                    : data.cancellationRequestStatus === 'REJECTED'
                      ? 'Solicitação não aprovada'
                      : 'Precisa cancelar esta viagem?'}
              </h2>
              <p>
                {data.cancellationRequestStatus === 'PENDING'
                  ? 'A agência vai analisar sua solicitação antes de cancelar a reserva, liberar as poltronas e definir bônus ou estorno.'
                  : data.cancellationRequestStatus === 'APPROVED'
                    ? 'A reserva foi cancelada pela agência conforme a análise da solicitação.'
                    : data.cancellationRequestStatus === 'REJECTED'
                      ? data.cancellationRequestResolutionNote ||
                        'A agência não aprovou esta solicitação. Fale com o atendimento se precisar revisar o caso.'
                      : 'Envie o pedido por aqui. A reserva não é cancelada automaticamente.'}
              </p>
              {data.cancellationRequestReason ? (
                <small>Motivo informado: {data.cancellationRequestReason}</small>
              ) : null}
              {data.cancellationFinancial.reviewableCents > 0 ? (
                <strong className="client-cancellation-value">
                  Valor pago identificado para análise:{' '}
                  {money.format(data.cancellationFinancial.reviewableCents / 100)}
                </strong>
              ) : null}
            </div>
          </div>

          {data.canRequestCancellation ? (
            cancellationOpen ? (
              <div className="client-cancellation-form">
                <label>
                  <span>Motivo do cancelamento</span>
                  <textarea
                    value={cancellationReason}
                    onChange={(event) =>
                      setCancellationReason(event.target.value)
                    }
                    maxLength={500}
                    placeholder="Explique brevemente por que deseja cancelar a viagem."
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={cancellationSubmitting}
                    onClick={() => setCancellationOpen(false)}
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    disabled={cancellationSubmitting}
                    onClick={() => void submitCancellationRequest()}
                  >
                    {cancellationSubmitting
                      ? 'Enviando...'
                      : 'Enviar solicitação'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="client-cancellation-request"
                onClick={() => {
                  setCancellationReason(
                    data.cancellationRequestStatus === 'REJECTED'
                      ? data.cancellationRequestReason ?? ''
                      : '',
                  )
                  setCancellationOpen(true)
                }}
              >
                <Ban size={16} />
                {data.cancellationRequestStatus === 'REJECTED'
                  ? 'Solicitar novamente'
                  : 'Solicitar cancelamento'}
              </button>
            )
          ) : null}
        </section>

        {data.purchaseOrder ? (
          <section className="client-payment-panel">
            <div className="client-payment-heading">
              <div>
                <span className="eyebrow">Pagamento da compra</span>
                <h2>
                  {data.purchaseOrder.status === 'PAID'
                    ? 'Pagamento confirmado'
                    : data.purchaseOrder.status === 'PARTIALLY_REFUNDED'
                      ? 'Pagamento com estorno parcial'
                      : data.purchaseOrder.status === 'REFUNDED'
                        ? 'Pagamento estornado'
                        : data.purchaseOrder.status === 'PENDING_PAYMENT'
                          ? 'Pagamento pendente'
                          : 'Pagamento encerrado'}
                </h2>
                <p>
                  {data.purchaseOrder.paymentMethod === 'PIX'
                    ? 'PIX'
                    : data.purchaseOrder.paymentMethod === 'CARD'
                      ? 'Cartão'
                      : data.purchaseOrder.paymentMethod}
                  {' · '}
                  {money.format(data.purchaseOrder.totalCents / 100)}
                </p>
              </div>
              <strong className={'client-payment-status client-payment-status--' + data.purchaseOrder.status.toLowerCase()}>
                {data.purchaseOrder.status === 'PAID'
                  ? 'Pago'
                  : data.purchaseOrder.status === 'PARTIALLY_REFUNDED'
                    ? 'Estorno parcial'
                    : data.purchaseOrder.status === 'REFUNDED'
                      ? 'Estornado'
                      : data.purchaseOrder.status === 'PENDING_PAYMENT'
                        ? 'Aguardando'
                        : data.purchaseOrder.status === 'EXPIRED'
                          ? 'Expirado'
                          : 'Cancelado'}
              </strong>
            </div>

            {data.purchaseOrder.status === 'PENDING_PAYMENT' ? (
              <div className="client-payment-actions">
                <button
                  type="button"
                  onClick={() => void resumePayment()}
                  disabled={paymentStarting}
                >
                  <CircleDollarSign size={16} />
                  {paymentStarting
                    ? 'Preparando pagamento...'
                    : data.purchaseOrder.paymentMethod === 'PIX'
                      ? 'Gerar PIX'
                      : 'Continuar pagamento'}
                </button>
              </div>
            ) : null}

            {paymentResult?.kind === 'PIX' ? (
              <div className="client-payment-pix">
                {paymentResult.qrCodeBase64 ? (
                  <img
                    src={`data:image/png;base64,${paymentResult.qrCodeBase64}`}
                    alt="QR Code PIX para pagamento"
                  />
                ) : null}
                <div>
                  <strong>PIX copia e cola</strong>
                  <code>{paymentResult.qrCode}</code>
                  <button type="button" onClick={() => void copyPixCode()}>
                    {pixCopied ? 'Copiado' : 'Copiar código PIX'}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {quote ? (
          <section className="client-quote-panel">
            <div className="client-quote-heading">
              <div>
                <span className="eyebrow">Sua proposta</span>
                <h2>{quote.title}</h2>
                <p>Revisão {quote.revision}{quote.validUntil ? ` · válida até ${date.format(new Date(quote.validUntil))}` : ''}</p>
              </div>
              <span className={quote.status === 'APPROVED' ? 'client-quote-status approved' : 'client-quote-status'}>
                {quote.status === 'APPROVED' ? 'Aprovada' : 'Aguardando sua resposta'}
              </span>
            </div>

            <div className="client-quote-items">
              {quote.items.map((item) => (
                <div className="client-quote-item" key={item.id}>
                  <div>
                    <strong>{categoryLabel[item.category]} · {item.description}</strong>
                    <span>{item.quantity}x{item.supplier ? ` · ${item.supplier}` : ''}</span>
                  </div>
                  <strong>{money.format(item.totalSaleCents / 100)}</strong>
                </div>
              ))}
            </div>

            <div className="client-quote-total">
              <div>
                <span>Subtotal</span>
                <strong>{money.format(quote.subtotalSaleCents / 100)}</strong>
              </div>
              <div>
                <span>Desconto</span>
                <strong>{money.format(quote.discountCents / 100)}</strong>
              </div>
              <div className="final">
                <span>Total da viagem</span>
                <strong>{money.format(quote.totalCents / 100)}</strong>
              </div>
            </div>

            {quote.notes ? <p className="client-quote-notes">{quote.notes}</p> : null}

            {quote.status === 'SENT' ? (
              <div className="client-quote-actions">
                <button type="button" onClick={() => void answerQuote('approve')} disabled={responding}>
                  <CheckCircle2 size={16} /> {responding ? 'Registrando...' : 'Aprovar cotação'}
                </button>
                <button className="secondary" type="button" onClick={() => void answerQuote('reject')} disabled={responding}>
                  Solicitar revisão
                </button>
              </div>
            ) : (
              <div className="approved-note"><CheckCircle2 size={15} /> Esta cotação foi aprovada e não pode mais ser alterada.</div>
            )}
          </section>
        ) : (
          <section className="client-quote-panel client-quote-panel--empty">
            <FileText size={22} />
            <div>
              <span className="eyebrow">Cotação</span>
              <h2>A agência ainda está preparando sua proposta.</h2>
              <p>Quando a cotação for enviada, os serviços e o valor final aparecerão aqui.</p>
            </div>
          </section>
        )}

        <section className="client-content-grid">
          <article className="light-panel itinerary-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Viagem</span>
                <h2>Resumo da operação</h2>
              </div>
              <Bus size={20} />
            </div>

            <div className="timeline">
              <div className="timeline-item">
                <span className="timeline-time">01</span><i />
                <div><strong>Solicitação registrada</strong><span>{date.format(new Date(data.createdAt))}</span></div>
              </div>
              <div className="timeline-item">
                <span className="timeline-time">02</span><i />
                <div><strong>Cotação e aprovação</strong><span>{quote ? (quote.status === 'APPROVED' ? 'Cotação aprovada' : 'Cotação enviada para sua análise') : 'Em preparação pela agência'}</span></div>
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
                <span className="eyebrow">Assistência</span>
                <h2>Fale com a Próximo Destino</h2>
              </div>
              <MapPin size={20} />
            </div>
            <p>Use o atendimento da agência para ajustes, dúvidas ou confirmação de serviços.</p>
          </article>

          <article className="light-panel support-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Segurança</span>
                <h2>Seu acesso é individual</h2>
              </div>
              <ShieldCheck size={20} />
            </div>
            <p>O portal mostra somente esta reserva e os dados vinculados ao seu código de acesso.</p>
          </article>
        </section>

        {data.documents.length ? (
          <section className="client-commercial-section">
            <div className="light-panel-heading">
              <div><span className="eyebrow">Documentos da viagem</span><h2>Passagens e comprovantes</h2></div>
              <FileText size={20} />
            </div>
            <div className="client-documents-list">
              {data.documents.map((document) => (
                <button
                  type="button"
                  className="client-document-row"
                  key={document.id}
                  onClick={() => void openDocument(document.id)}
                >
                  <div>
                    <strong>{document.type === 'TRAVEL_VOUCHER' ? 'Passagem / voucher de viagem' : 'Comprovante de compra'}</strong>
                    <span>{document.documentNumber} · versão {document.version} · emitido em {date.format(new Date(document.issuedAt))}</span>
                  </div>
                  <Download size={17} />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {data.services.length ? (
          <section className="client-commercial-section">
            <div className="light-panel-heading">
              <div><span className="eyebrow">Serviços contratados</span><h2>Operação da sua viagem</h2></div>
              <Bus size={20} />
            </div>
            <div className="client-service-list">
              {data.services.map((service) => (
                <div className="client-service-row" key={service.id}>
                  <div>
                    <strong>{categoryLabel[service.category]} · {service.description}</strong>
                    <span>{service.supplier || 'Fornecedor em confirmação'}</span>
                  </div>
                  <strong>{money.format(service.amountCents / 100)}</strong>
                  <em>{serviceStatusLabel[service.status]}</em>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {data.financePlan ? (
          <section className="client-commercial-section">
            <div className="light-panel-heading">
              <div><span className="eyebrow">Financeiro</span><h2>Plano de pagamento</h2></div>
              <CircleDollarSign size={20} />
            </div>

            <div className="client-finance-summary">
              <div><span>Total</span><strong>{money.format(data.financePlan.totalCents / 100)}</strong></div>
              <div><span>Entrada</span><strong>{money.format(data.financePlan.downPaymentCents / 100)}</strong></div>
              <div><span>Parcelas</span><strong>{data.financePlan.installmentCount}</strong></div>
            </div>

            <div className="installment-list">
              {data.financePlan.installments.map((installment) => (
                <div className="installment-row" key={installment.id}>
                  <div>
                    <strong>{installment.sequence === 0 ? 'Entrada' : `Parcela ${installment.sequence}`}</strong>
                    <span>Vencimento {date.format(new Date(installment.dueDate))}</span>
                  </div>
                  <strong>{money.format(installment.amountCents / 100)}</strong>
                  <em className={installment.status === 'PAID' ? 'paid' : ''}>
                    {installmentStatusLabel[installment.status]}
                  </em>
                </div>
              ))}
            </div>
          </section>
        ) : quote?.status === 'APPROVED' ? (
          <section className="client-quote-panel client-quote-panel--empty">
            <Clock3 size={22} />
            <div>
              <span className="eyebrow">Financeiro</span>
              <h2>Condições de pagamento em preparação.</h2>
              <p>A cotação já foi aprovada. A agência ainda não gerou o plano de parcelas.</p>
            </div>
          </section>
        ) : null}
      </main>

      {seatSelectorOpen && data.seatMap.enabled && data.seatMap.capacity ? (
        <SeatSelector
          origin={data.trip.origin}
          destination={data.trip.destination}
          capacity={data.seatMap.capacity}
          busLabel={data.seatMap.busLabel}
          seatLayout={data.seatMap.seatLayout}
          deckCount={data.seatMap.deckCount}
          lowerDeckCapacity={data.seatMap.lowerDeckCapacity}
          vehicleFeatures={data.seatMap.vehicleFeatures}
          blockedSeats={data.seatMap.blockedSeats}
          occupiedSeats={data.seatMap.occupiedSeats}
          passengerCount={data.passengerCount}
          selectedSeats={data.seatAssignments.map((seat) => seat.seatNumber)}
          returnFocusTo={seatTriggerRef.current}
          onConfirm={(seats) => {
            void saveSeats(seats)
          }}
          onClose={() => setSeatSelectorOpen(false)}
        />
      ) : null}

      <WhatsAppButton message={`Olá! Preciso de ajuda com minha reserva ${data.id.slice(-8).toUpperCase()}.`} />
    </div>
  )
}
