import { useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  Hotel,
  MapPin,
  Plane,
  ShieldCheck,
  Smartphone,
  WalletCards,
} from 'lucide-react'
import { Brand } from '../../components/Brand'
import { WhatsAppButton } from '../../components/WhatsAppButton'
import { createPaymentCheckout } from '../../lib/payments'

type ClientPortalProps = {
  onLogout: () => void
}

const installments = [
  { id: '01', due: '10 out', value: 'R$ 1.280,00', status: 'Pago' },
  { id: '02', due: '10 nov', value: 'R$ 1.280,00', status: 'Em aberto' },
  { id: '03', due: '10 dez', value: 'R$ 1.280,00', status: 'Em aberto' },
]

export function ClientPortal({ onLogout }: ClientPortalProps) {
  const [paymentStatus, setPaymentStatus] = useState('')

  async function handlePayment() {
    setPaymentStatus('Preparando ambiente seguro...')

    try {
      const checkout = await createPaymentCheckout({
        tripId: 'trip-demo-buenos-aires',
        installmentId: '02',
        method: 'pix',
      })

      if (checkout.checkoutUrl) {
        window.location.assign(checkout.checkoutUrl)
        return
      }

      if (checkout.pixCopyPaste) {
        await navigator.clipboard.writeText(checkout.pixCopyPaste)
        setPaymentStatus('Código PIX copiado.')
        return
      }

      setPaymentStatus('Cobrança criada com sucesso.')
    } catch (error) {
      setPaymentStatus(error instanceof Error ? error.message : 'Pagamento indisponível.')
    }
  }

  return (
    <div className="client-shell">
      <header className="client-topbar">
        <Brand compact />

        <nav className="client-nav" aria-label="Área do cliente">
          <button className="client-nav-item client-nav-item--active" type="button">Minha viagem</button>
          <button className="client-nav-item" type="button">Documentos</button>
          <button className="client-nav-item" type="button">Pagamentos</button>
          <button className="client-nav-item" type="button">Ajuda</button>
        </nav>

        <div className="client-top-actions">
          <button className="client-avatar" type="button" onClick={onLogout}>MO</button>
        </div>
      </header>

      <main className="client-main">
        <section className="client-hero">
          <div className="client-hero-content">
            <span className="eyebrow">Sua próxima viagem</span>
            <h1>Buenos Aires está chegando.</h1>
            <p>Todos os detalhes importantes da sua viagem, em um só lugar.</p>

            <div className="trip-countdown">
              <div><strong>03</strong><span>dias</span></div>
              <i />
              <div><strong>07</strong><span>horas</span></div>
              <i />
              <div><strong>18</strong><span>min</span></div>
            </div>
          </div>

          <div className="client-hero-badge">
            <Plane size={22} />
            <div>
              <strong>Fortaleza → Buenos Aires</strong>
              <span>03 out · 07:10</span>
            </div>
          </div>
        </section>

        <section className="client-summary-grid">
          <article className="client-summary-card">
            <div className="summary-icon"><Plane size={20} /></div>
            <span>Voo</span>
            <strong>G3 7684</strong>
            <small>Check-in disponível</small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><Hotel size={20} /></div>
            <span>Hospedagem</span>
            <strong>CasaSur Palermo</strong>
            <small>4 noites · café incluso</small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><WalletCards size={20} /></div>
            <span>Saldo restante</span>
            <strong>R$ 2.560,00</strong>
            <small>2 parcelas em aberto</small>
          </article>
          <article className="client-summary-card">
            <div className="summary-icon"><ShieldCheck size={20} /></div>
            <span>Documentação</span>
            <strong>Completa</strong>
            <small>Nenhuma pendência</small>
          </article>
        </section>

        <section className="client-content-grid">
          <article className="light-panel itinerary-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Roteiro</span>
                <h2>Seu primeiro dia</h2>
              </div>
              <CalendarDays size={20} />
            </div>

            <div className="timeline">
              <div className="timeline-item">
                <span className="timeline-time">07:10</span>
                <i />
                <div>
                  <strong>Embarque em Fortaleza</strong>
                  <span>Aeroporto Pinto Martins · Terminal 1</span>
                </div>
              </div>
              <div className="timeline-item">
                <span className="timeline-time">12:40</span>
                <i />
                <div>
                  <strong>Chegada em Buenos Aires</strong>
                  <span>Aeroporto Ezeiza · transfer confirmado</span>
                </div>
              </div>
              <div className="timeline-item">
                <span className="timeline-time">15:00</span>
                <i />
                <div>
                  <strong>Check-in no hotel</strong>
                  <span>CasaSur Palermo</span>
                </div>
              </div>
            </div>
          </article>

          <article className="light-panel documents-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Documentos</span>
                <h2>Prontos para viajar</h2>
              </div>
              <FileText size={20} />
            </div>

            <button className="document-row" type="button">
              <span><CheckCircle2 size={17} /> Voucher do hotel</span>
              <ChevronRight size={16} />
            </button>
            <button className="document-row" type="button">
              <span><CheckCircle2 size={17} /> Bilhete aéreo</span>
              <ChevronRight size={16} />
            </button>
            <button className="document-row" type="button">
              <span><CheckCircle2 size={17} /> Seguro viagem</span>
              <ChevronRight size={16} />
            </button>
          </article>

          <article className="light-panel payment-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Pagamentos</span>
                <h2>Parcelas da viagem</h2>
              </div>
              <CreditCard size={20} />
            </div>

            <div className="installment-list">
              {installments.map((item) => (
                <div className="installment-row" key={item.id}>
                  <div>
                    <strong>Parcela {item.id}</strong>
                    <span>Vencimento {item.due}</span>
                  </div>
                  <strong>{item.value}</strong>
                  <em className={item.status === 'Pago' ? 'paid' : ''}>{item.status}</em>
                </div>
              ))}
            </div>

            <button className="pay-button" type="button" onClick={handlePayment}>
              <Smartphone size={17} />
              Pagar próxima parcela
            </button>
            <small className="payment-note">PIX, cartão e boleto serão processados pelo provedor de pagamento no ambiente seguro.</small>
            {paymentStatus && <div className="payment-feedback" role="status">{paymentStatus}</div>}
          </article>

          <article className="light-panel support-panel">
            <div className="light-panel-heading">
              <div>
                <span className="eyebrow">Assistência</span>
                <h2>Você não viaja sozinho</h2>
              </div>
              <Clock3 size={20} />
            </div>
            <p>Precisa alterar um serviço, confirmar um horário ou falar com a agência?</p>
            <div className="support-info">
              <span><MapPin size={16} /> Atendimento Próximo Destino</span>
              <span><Clock3 size={16} /> Seg a sáb · 08h às 20h</span>
            </div>
          </article>
        </section>
      </main>

      <WhatsAppButton />
    </div>
  )
}
