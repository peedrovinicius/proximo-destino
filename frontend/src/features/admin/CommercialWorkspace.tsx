import {
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Plane,
  RefreshCw,
  Send,
  Trash2,
  Ticket,
  ReceiptText,
  ExternalLink,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  adminApi,
  type AdminDocument,
  type AdminQuote,
  type AdminReservation,
  type FinancePlan,
  type QuoteItemCategory,
  type ReservationService,
} from '../../lib/adminApi'

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })

const categoryLabel: Record<QuoteItemCategory, string> = {
  FLIGHT: 'Passagem',
  HOTEL: 'Hospedagem',
  TRANSFER: 'Transfer',
  TOUR: 'Passeio',
  INSURANCE: 'Seguro',
  OTHER: 'Outro',
}

const quoteStatusLabel: Record<AdminQuote['status'], string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviada',
  APPROVED: 'Aprovada',
  REJECTED: 'Recusada',
  EXPIRED: 'Expirada',
}

function parseMoney(value: string) {
  if (!value.trim()) return 0
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

export function QuotesWorkspace({
  accessToken,
  reservations,
}: {
  accessToken: string
  reservations: AdminReservation[]
}) {
  const [quotes, setQuotes] = useState<AdminQuote[]>([])
  const [services, setServices] = useState<ReservationService[]>([])
  const [documents, setDocuments] = useState<AdminDocument[]>([])
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [reservationId, setReservationId] = useState('')
  const [title, setTitle] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [discount, setDiscount] = useState('')
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState<QuoteItemCategory>('FLIGHT')
  const [description, setDescription] = useState('')
  const [supplier, setSupplier] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [cost, setCost] = useState('')
  const [sale, setSale] = useState('')
  const [airline, setAirline] = useState('')
  const [flightNumber, setFlightNumber] = useState('')
  const [bookingCode, setBookingCode] = useState('')
  const [seat, setSeat] = useState('')
  const [baggage, setBaggage] = useState('')
  const [departureAt, setDepartureAt] = useState('')
  const [arrivalAt, setArrivalAt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    try {
      const [quoteData, serviceData] = await Promise.all([
        adminApi.quotes(accessToken),
        adminApi.services(accessToken),
      ])
      setQuotes(quoteData)
      setServices(serviceData)
      setSelectedQuoteId((current) => {
        if (current && quoteData.some((quote) => quote.id === current)) return current
        return quoteData[0]?.id ?? ''
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar cotações.')
    }
  }

  useEffect(() => {
    void load()
  }, [accessToken])

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.id === selectedQuoteId) ?? null,
    [quotes, selectedQuoteId],
  )

  useEffect(() => {
    if (!selectedQuote) {
      setDocuments([])
      return
    }

    void adminApi
      .documents(accessToken, selectedQuote.reservationId)
      .then(setDocuments)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'Falha ao carregar documentos.')
      })
  }, [accessToken, selectedQuote?.reservationId])

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const created = await adminApi.createQuote(accessToken, {
        reservationId,
        title,
        validUntil: validUntil ? `${validUntil}T23:59:59.000Z` : undefined,
        discountCents: parseMoney(discount),
        notes: notes || undefined,
      })
      setReservationId('')
      setTitle('')
      setValidUntil('')
      setDiscount('')
      setNotes('')
      await load()
      setSelectedQuoteId(created.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a cotação.')
    } finally {
      setBusy(false)
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedQuote) return

    setBusy(true)
    setError('')
    try {
      await adminApi.addQuoteItem(accessToken, selectedQuote.id, {
        category,
        description,
        supplier: supplier || undefined,
        quantity: Number(quantity),
        unitCostCents: parseMoney(cost),
        unitSaleCents: parseMoney(sale),
      })
      setDescription('')
      setSupplier('')
      setQuantity('1')
      setCost('')
      setSale('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível adicionar o serviço.')
    } finally {
      setBusy(false)
    }
  }

  async function sendQuote() {
    if (!selectedQuote) return
    setBusy(true)
    setError('')
    try {
      await adminApi.sendQuote(accessToken, selectedQuote.id)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a cotação.')
    } finally {
      setBusy(false)
    }
  }

  async function reviseQuote() {
    if (!selectedQuote) return
    setBusy(true)
    setError('')
    try {
      const revised = await adminApi.reviseQuote(accessToken, selectedQuote.id)
      await load()
      setSelectedQuoteId(revised.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a revisão.')
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(itemId: string) {
    if (!selectedQuote) return
    setBusy(true)
    try {
      await adminApi.removeQuoteItem(accessToken, selectedQuote.id, itemId)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível remover o item.')
    } finally {
      setBusy(false)
    }
  }

  async function updateServiceStatus(
    id: string,
    status: ReservationService['status'],
  ) {
    try {
      await adminApi.updateServiceStatus(accessToken, id, status)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o serviço.')
    }
  }

  async function refreshDocuments(reservationId: string) {
    setDocuments(await adminApi.documents(accessToken, reservationId))
  }

  async function issueVoucher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedQuote) return

    setBusy(true)
    setError('')
    try {
      await adminApi.issueTravelVoucher(
        accessToken,
        selectedQuote.reservationId,
        {
          airline: airline || undefined,
          flightNumber: flightNumber || undefined,
          bookingCode: bookingCode || undefined,
          seat: seat || undefined,
          baggage: baggage || undefined,
          departureAt: departureAt ? new Date(departureAt).toISOString() : undefined,
          arrivalAt: arrivalAt ? new Date(arrivalAt).toISOString() : undefined,
        },
      )
      await refreshDocuments(selectedQuote.reservationId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível emitir a passagem.')
    } finally {
      setBusy(false)
    }
  }

  async function issueReceipt() {
    if (!selectedQuote) return

    setBusy(true)
    setError('')
    try {
      await adminApi.issuePurchaseReceipt(
        accessToken,
        selectedQuote.reservationId,
      )
      await refreshDocuments(selectedQuote.reservationId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível emitir o comprovante.')
    } finally {
      setBusy(false)
    }
  }

  async function openDocument(documentId: string) {
    try {
      await adminApi.openDocumentPdf(accessToken, documentId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o documento.')
    }
  }

  const marginPercent = selectedQuote && selectedQuote.totalCents > 0
    ? (selectedQuote.marginCents / selectedQuote.totalCents) * 100
    : 0

  return (
    <section className="commercial-shell">
      {error ? <div className="admin-error" role="alert">{error}</div> : null}

      <div className="commercial-create-grid">
        <form className="admin-form-panel" onSubmit={createQuote}>
          <div>
            <span className="eyebrow">Cotação profissional</span>
            <h2>Nova cotação</h2>
          </div>

          <select value={reservationId} onChange={(e) => setReservationId(e.target.value)} required>
            <option value="">Selecione a reserva</option>
            {reservations.map((reservation) => (
              <option key={reservation.id} value={reservation.id}>
                {reservation.client.fullName} · {reservation.trip.destination}
              </option>
            ))}
          </select>

          <input
            placeholder="Título da proposta"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <label className="commercial-field">
            <span>Validade</span>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
          <input
            inputMode="decimal"
            placeholder="Desconto em R$"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
          <textarea
            placeholder="Observações para o cliente"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button type="submit" disabled={busy || !reservations.length}>
            {busy ? 'Salvando...' : 'Criar cotação'}
          </button>
        </form>

        <article className="commercial-list-panel">
          <div className="admin-panel-heading">
            <div><span className="eyebrow">Histórico</span><h2>Cotações e revisões</h2></div>
            <strong>{quotes.length}</strong>
          </div>

          <div className="quote-selector-list">
            {quotes.length ? quotes.map((quote) => (
              <button
                type="button"
                key={quote.id}
                className={selectedQuoteId === quote.id ? 'quote-selector quote-selector--active' : 'quote-selector'}
                onClick={() => setSelectedQuoteId(quote.id)}
              >
                <div>
                  <strong>{quote.reservation.client.fullName}</strong>
                  <span>{quote.title} · revisão {quote.revision}</span>
                </div>
                <em>{quoteStatusLabel[quote.status]}</em>
              </button>
            )) : <p className="admin-empty">Nenhuma cotação criada ainda.</p>}
          </div>
        </article>
      </div>

      {selectedQuote ? (
        <section className="travel-builder">
          <div className="travel-builder-heading">
            <div>
              <span className="eyebrow">Construtor de Viagem</span>
              <h2>{selectedQuote.title}</h2>
              <p>
                {selectedQuote.reservation.client.fullName} · {selectedQuote.reservation.trip.origin} → {selectedQuote.reservation.trip.destination}
              </p>
            </div>
            <div className="quote-status-badge">{quoteStatusLabel[selectedQuote.status]}</div>
          </div>

          <div className="quote-totals-grid">
            <article><span>Custo</span><strong>{money.format(selectedQuote.subtotalCostCents / 100)}</strong></article>
            <article><span>Venda</span><strong>{money.format(selectedQuote.subtotalSaleCents / 100)}</strong></article>
            <article><span>Desconto</span><strong>{money.format(selectedQuote.discountCents / 100)}</strong></article>
            <article><span>Preço final</span><strong>{money.format(selectedQuote.totalCents / 100)}</strong></article>
            <article><span>Margem</span><strong>{money.format(selectedQuote.marginCents / 100)}</strong><small>{marginPercent.toFixed(1)}%</small></article>
          </div>

          {selectedQuote.status === 'DRAFT' ? (
            <form className="builder-item-form" onSubmit={addItem}>
              <select value={category} onChange={(e) => setCategory(e.target.value as QuoteItemCategory)}>
                {Object.entries(categoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input placeholder="Descrição do serviço" value={description} onChange={(e) => setDescription(e.target.value)} required />
              <input placeholder="Fornecedor" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              <input type="number" min="1" max="100" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              <input inputMode="decimal" placeholder="Custo unit. R$" value={cost} onChange={(e) => setCost(e.target.value)} required />
              <input inputMode="decimal" placeholder="Venda unit. R$" value={sale} onChange={(e) => setSale(e.target.value)} required />
              <button type="submit" disabled={busy}>Adicionar serviço</button>
            </form>
          ) : null}

          <div className="builder-items">
            {selectedQuote.items.length ? selectedQuote.items.map((item) => (
              <div className="builder-item-row" key={item.id}>
                <span className="builder-item-icon"><Plane size={16} /></span>
                <div>
                  <strong>{categoryLabel[item.category]} · {item.description}</strong>
                  <span>{item.quantity}x · {item.supplier || 'Fornecedor não informado'}</span>
                </div>
                <div>
                  <small>Custo</small>
                  <strong>{money.format(item.totalCostCents / 100)}</strong>
                </div>
                <div>
                  <small>Venda</small>
                  <strong>{money.format(item.totalSaleCents / 100)}</strong>
                </div>
                {selectedQuote.status === 'DRAFT' ? (
                  <button type="button" aria-label="Remover item" onClick={() => void removeItem(item.id)}>
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            )) : <p className="admin-empty">Adicione passagem, hospedagem, transfer, passeio, seguro ou outro serviço.</p>}
          </div>

          <div className="builder-actions">
            {selectedQuote.status === 'DRAFT' ? (
              <button type="button" onClick={() => void sendQuote()} disabled={busy || !selectedQuote.items.length}>
                <Send size={15} /> Enviar ao cliente
              </button>
            ) : null}

            {['SENT', 'REJECTED', 'EXPIRED'].includes(selectedQuote.status) ? (
              <button type="button" className="secondary" onClick={() => void reviseQuote()} disabled={busy}>
                <RefreshCw size={15} /> Criar nova revisão
              </button>
            ) : null}

            {selectedQuote.status === 'APPROVED' ? (
              <span className="approved-note"><CheckCircle2 size={15} /> Cotação aprovada e bloqueada para edição</span>
            ) : null}
          </div>

          {selectedQuote.status === 'APPROVED' ? (
            <section className="document-issuer">
              <div className="document-issuer-heading">
                <div>
                  <span className="eyebrow">Documentos da viagem</span>
                  <h3>Passagem e comprovante</h3>
                  <p>Os documentos ficam versionados e podem ser reabertos em PDF.</p>
                </div>
              </div>

              <form className="voucher-form" onSubmit={issueVoucher}>
                <div className="voucher-form-title">
                  <Ticket size={18} />
                  <div>
                    <strong>Emitir passagem / voucher</strong>
                    <span>Informe os dados disponíveis do voo. Campos não preenchidos sairão como “A confirmar”.</span>
                  </div>
                </div>
                <input placeholder="Companhia / fornecedor" value={airline} onChange={(e) => setAirline(e.target.value)} />
                <input placeholder="Número do voo" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} />
                <input placeholder="Localizador" value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} />
                <input placeholder="Assento" value={seat} onChange={(e) => setSeat(e.target.value)} />
                <input placeholder="Bagagem" value={baggage} onChange={(e) => setBaggage(e.target.value)} />
                <label><span>Saída</span><input type="datetime-local" value={departureAt} onChange={(e) => setDepartureAt(e.target.value)} /></label>
                <label><span>Chegada</span><input type="datetime-local" value={arrivalAt} onChange={(e) => setArrivalAt(e.target.value)} /></label>
                <button type="submit" disabled={busy}><Ticket size={15} /> Emitir PDF</button>
              </form>

              <div className="receipt-issuer">
                <div>
                  <ReceiptText size={18} />
                  <div>
                    <strong>Comprovante de compra</strong>
                    <span>Registra a cotação aprovada e os pagamentos já lançados no financeiro.</span>
                  </div>
                </div>
                <button type="button" onClick={() => void issueReceipt()} disabled={busy}>
                  <ReceiptText size={15} /> Emitir comprovante
                </button>
              </div>

              <div className="issued-documents">
                {documents.length ? documents.map((document) => (
                  <button
                    type="button"
                    className="issued-document-row"
                    key={document.id}
                    onClick={() => void openDocument(document.id)}
                  >
                    <div>
                      <strong>{document.type === 'TRAVEL_VOUCHER' ? 'Passagem / voucher' : 'Comprovante de compra'}</strong>
                      <span>{document.documentNumber} · versão {document.version}</span>
                    </div>
                    <ExternalLink size={15} />
                  </button>
                )) : <p className="admin-empty">Nenhum documento emitido para esta reserva.</p>}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      <article className="commercial-list-panel services-panel">
        <div className="admin-panel-heading">
          <div><span className="eyebrow">Operação</span><h2>Serviços das reservas aprovadas</h2></div>
          <strong>{services.length}</strong>
        </div>

        <div className="admin-table">
          {services.length ? services.map((service) => (
            <div className="service-row" key={service.id}>
              <div>
                <strong>{categoryLabel[service.category]} · {service.description}</strong>
                <span>{service.reservation.client.fullName} · {service.reservation.trip.destination}</span>
              </div>
              <strong>{money.format(service.amountCents / 100)}</strong>
              <select
                value={service.status}
                onChange={(e) => void updateServiceStatus(service.id, e.target.value as ReservationService['status'])}
              >
                <option value="PENDING">Pendente</option>
                <option value="CONFIRMED">Confirmado</option>
                <option value="COMPLETED">Concluído</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
            </div>
          )) : <p className="admin-empty">Os serviços aparecerão aqui quando uma cotação for aprovada.</p>}
        </div>
      </article>
    </section>
  )
}

export function FinanceWorkspace({
  accessToken,
}: {
  accessToken: string
}) {
  const [quotes, setQuotes] = useState<AdminQuote[]>([])
  const [plans, setPlans] = useState<FinancePlan[]>([])
  const [quoteId, setQuoteId] = useState('')
  const [downPayment, setDownPayment] = useState('')
  const [installmentCount, setInstallmentCount] = useState('3')
  const [firstDueDate, setFirstDueDate] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    try {
      const [quoteData, planData] = await Promise.all([
        adminApi.quotes(accessToken),
        adminApi.financePlans(accessToken),
      ])
      setQuotes(quoteData)
      setPlans(planData)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o financeiro.')
    }
  }

  useEffect(() => {
    void load()
  }, [accessToken])

  const eligibleQuotes = quotes.filter(
    (quote) =>
      quote.status === 'APPROVED' &&
      !plans.some((plan) => plan.reservationId === quote.reservationId),
  )

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const quote = eligibleQuotes.find((item) => item.id === quoteId)
    if (!quote) return

    setBusy(true)
    setError('')
    try {
      await adminApi.createFinancePlan(accessToken, {
        reservationId: quote.reservationId,
        installmentCount: Number(installmentCount),
        firstDueDate: `${firstDueDate}T12:00:00.000Z`,
        downPaymentCents: parseMoney(downPayment),
      })
      setQuoteId('')
      setDownPayment('')
      setInstallmentCount('3')
      setFirstDueDate('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o plano financeiro.')
    } finally {
      setBusy(false)
    }
  }

  async function updateInstallment(
    id: string,
    status: FinancePlan['installments'][number]['status'],
  ) {
    try {
      await adminApi.updateInstallment(
        accessToken,
        id,
        status,
      )
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a parcela.')
    }
  }

  return (
    <section className="commercial-shell">
      {error ? <div className="admin-error" role="alert">{error}</div> : null}

      <div className="commercial-create-grid">
        <form className="admin-form-panel" onSubmit={createPlan}>
          <div>
            <span className="eyebrow">Financeiro</span>
            <h2>Novo plano</h2>
          </div>

          <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} required>
            <option value="">Cotação aprovada</option>
            {eligibleQuotes.map((quote) => (
              <option value={quote.id} key={quote.id}>
                {quote.reservation.client.fullName} · {quote.reservation.trip.destination} · {money.format(quote.totalCents / 100)}
              </option>
            ))}
          </select>

          <input
            inputMode="decimal"
            placeholder="Entrada em R$"
            value={downPayment}
            onChange={(e) => setDownPayment(e.target.value)}
          />
          <input
            type="number"
            min="1"
            max="36"
            value={installmentCount}
            onChange={(e) => setInstallmentCount(e.target.value)}
            required
          />
          <label className="commercial-field">
            <span>Primeiro vencimento</span>
            <input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} required />
          </label>

          <button type="submit" disabled={busy || !eligibleQuotes.length}>
            {busy ? 'Gerando...' : 'Gerar entrada e parcelas'}
          </button>
        </form>

        <article className="commercial-list-panel">
          <div className="admin-panel-heading">
            <div><span className="eyebrow">Carteira</span><h2>Planos financeiros</h2></div>
            <strong>{plans.length}</strong>
          </div>
          <p className="panel-description">
            Somente cotações aprovadas pelo cliente podem gerar parcelas. A baixa como paga é feita em Reservas → Financeiro, com valor, método, data e comprovante.
          </p>
        </article>
      </div>

      <div className="finance-plans-list">
        {plans.length ? plans.map((plan) => (
          <article className="finance-plan-card" key={plan.id}>
            <div className="finance-plan-heading">
              <div>
                <span className="eyebrow">Reserva confirmada</span>
                <h3>{plan.reservation.client.fullName} · {plan.reservation.trip.destination}</h3>
                <p>{plan.quote.title} · revisão {plan.quote.revision}</p>
              </div>
              <div>
                <small>Total</small>
                <strong>{money.format(plan.totalCents / 100)}</strong>
              </div>
            </div>

            <div className="finance-plan-summary">
              <span><CircleDollarSign size={15} /> Entrada: {money.format(plan.downPaymentCents / 100)}</span>
              <span><FileText size={15} /> {plan.installmentCount} parcelas após a entrada</span>
            </div>

            <div className="finance-installments">
              {plan.installments.map((installment) => (
                <div className="finance-installment-row" key={installment.id}>
                  <div>
                    <strong>{installment.sequence === 0 ? 'Entrada' : `Parcela ${installment.sequence}`}</strong>
                    <span>Vence em {date.format(new Date(installment.dueDate))}</span>
                  </div>
                  <strong>{money.format(installment.amountCents / 100)}</strong>
                  <select
                    value={installment.status}
                    disabled={installment.status === 'PAID'}
                    onChange={(e) => void updateInstallment(
                      installment.id,
                      e.target.value as FinancePlan['installments'][number]['status'],
                    )}
                    title={
                      installment.status === 'PAID'
                        ? 'Pagamentos devem ser estornados pelo centro financeiro da reserva.'
                        : 'Para dar baixa como pago, use Reservas > Financeiro.'
                    }
                  >
                    <option value="OPEN">Em aberto</option>
                    {installment.status === 'PAID' ? (
                      <option value="PAID">Pago · lançamento financeiro</option>
                    ) : null}
                    <option value="OVERDUE">Vencido</option>
                    <option value="CANCELLED">Cancelado</option>
                  </select>
                </div>
              ))}
            </div>
          </article>
        )) : <div className="admin-data-panel"><p className="admin-empty">Nenhum plano financeiro criado ainda.</p></div>}
      </div>
    </section>
  )
}
