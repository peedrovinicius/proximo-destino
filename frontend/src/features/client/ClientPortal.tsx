import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Download,
  MapPin,
  Plane,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Brand } from '../../components/Brand'
import { WhatsAppButton } from '../../components/WhatsAppButton'
import {
  approveClientQuote,
  fetchClientPortal,
  openClientDocumentPdf,
  rejectClientQuote,
  type ClientPortalData,
} from '../../lib/clientPortal'

type ClientPortalProps = {
  accessToken: string
  onLogout: () => void
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
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

export function ClientPortal({ accessToken, onLogout }: ClientPortalProps) {
  const [data, setData] = useState<ClientPortalData | null>(null)
  const [error, setError] = useState('')
  const [responding, setResponding] = useState(false)

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
            <Plane size={22} />
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
              <Plane size={20} />
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
              <Plane size={20} />
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

      <WhatsAppButton message={`Olá! Preciso de ajuda com minha reserva ${data.id.slice(-8).toUpperCase()}.`} />
    </div>
  )
}
