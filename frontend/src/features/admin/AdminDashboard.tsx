import {
  Bell,
  CalendarHeart,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Gift,
  Plane,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Brand } from '../../components/Brand'
import { WhatsAppButton } from '../../components/WhatsAppButton'
import { openWhatsApp } from '../../lib/whatsapp'

type AdminDashboardProps = {
  onLogout: () => void
}

const birthdays = [
  { name: 'Marina Albuquerque', date: 'Hoje', phone: '85 99999-0001' },
  { name: 'Carlos Henrique', date: 'Amanhã', phone: '85 99999-0002' },
  { name: 'Beatriz Monteiro', date: '03 out', phone: '85 99999-0003' },
]

const adminMetrics = [
  { label: 'Clientes ativos', value: '248', icon: Users },
  { label: 'Cotações abertas', value: '37', icon: FileText },
  { label: 'Viagens em andamento', value: '18', icon: Plane },
  { label: 'Recebimentos previstos', value: 'R$ 76.420', icon: CircleDollarSign },
]

export function AdminDashboard({ onLogout }: AdminDashboardProps) {
  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Brand compact />

        <nav className="admin-nav" aria-label="Administração">
          <button className="admin-nav-item admin-nav-item--active" type="button">Visão geral</button>
          <button className="admin-nav-item" type="button">Clientes</button>
          <button className="admin-nav-item" type="button">Cotações</button>
          <button className="admin-nav-item" type="button">Viagens</button>
          <button className="admin-nav-item" type="button">Financeiro</button>
          <button className="admin-nav-item" type="button">Relatórios</button>
        </nav>

        <div className="admin-actions">
          <label className="admin-search">
            <Search size={16} />
            <input placeholder="Buscar cliente, viagem ou pagamento..." />
          </label>
          <button className="round-action" type="button"><Bell size={17} /></button>
          <button className="admin-avatar" type="button" onClick={onLogout}>PV</button>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-heading">
          <div>
            <span className="eyebrow">Operação da agência</span>
            <h1>Bom dia, Pedro.</h1>
            <p>O que precisa da sua atenção hoje.</p>
          </div>
          <div className="security-pill"><ShieldCheck size={16} /> Ambiente administrativo protegido</div>
        </section>

        <section className="admin-metrics">
          {adminMetrics.map(({ label, value, icon: Icon }) => (
            <article className="admin-metric" key={label}>
              <span className="admin-metric-icon"><Icon size={20} /></span>
              <div><small>{label}</small><strong>{value}</strong></div>
            </article>
          ))}
        </section>

        <section className="admin-grid">
          <article className="admin-panel birthday-panel">
            <div className="admin-panel-heading">
              <div>
                <span className="eyebrow">Relacionamento</span>
                <h2>Aniversários de clientes</h2>
              </div>
              <CalendarHeart size={21} />
            </div>

            <p className="panel-description">Lembretes automáticos para a equipe não perder datas importantes.</p>

            <div className="birthday-list">
              {birthdays.map((birthday, index) => (
                <div className="birthday-row" key={birthday.name}>
                  <span className="birthday-avatar"><Gift size={16} /></span>
                  <div>
                    <strong>{birthday.name}</strong>
                    <span>{birthday.date} · {birthday.phone}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openWhatsApp(`Olá, ${birthday.name}! A equipe da Próximo Destino deseja um feliz aniversário e muitas novas viagens!`)}
                  >
                    Enviar mensagem
                  </button>
                  {index === 0 && <em>Hoje</em>}
                </div>
              ))}
            </div>
          </article>

          <article className="admin-panel finance-panel">
            <div className="admin-panel-heading">
              <div>
                <span className="eyebrow">Financeiro</span>
                <h2>Pagamentos e recebimentos</h2>
              </div>
              <CircleDollarSign size={21} />
            </div>

            <div className="finance-highlight">
              <span>Previsto para os próximos 7 dias</span>
              <strong>R$ 18.960,00</strong>
              <small>12 cobranças · 2 em atraso</small>
            </div>

            <button className="finance-row" type="button">
              <span>PIX recebido · Marina Albuquerque</span>
              <strong>R$ 1.280,00</strong>
              <ChevronRight size={15} />
            </button>
            <button className="finance-row" type="button">
              <span>Cartão aprovado · Carlos Henrique</span>
              <strong>R$ 2.450,00</strong>
              <ChevronRight size={15} />
            </button>
            <button className="finance-row finance-row--attention" type="button">
              <span>Parcela vencida · Rafael Souza</span>
              <strong>R$ 980,00</strong>
              <ChevronRight size={15} />
            </button>
          </article>

          <article className="admin-panel operations-panel">
            <div className="admin-panel-heading">
              <div>
                <span className="eyebrow">Hoje</span>
                <h2>Pendências operacionais</h2>
              </div>
            </div>
            <div className="operation-list">
              <div><i className="urgent" /><span>Confirmar documentos de 3 viajantes</span><strong>10:30</strong></div>
              <div><i /><span>Emitir voucher de hospedagem</span><strong>14:00</strong></div>
              <div><i /><span>Revalidar 4 cotações</span><strong>18:00</strong></div>
            </div>
          </article>

          <article className="admin-panel security-panel">
            <div className="admin-panel-heading">
              <div>
                <span className="eyebrow">Segurança</span>
                <h2>Proteção e auditoria</h2>
              </div>
              <ShieldCheck size={21} />
            </div>

            <div className="security-checklist">
              <span><ShieldCheck size={15} /> MFA administrativo obrigatório</span>
              <span><ShieldCheck size={15} /> Sessões e dispositivos auditados</span>
              <span><ShieldCheck size={15} /> Dados sensíveis fora do navegador</span>
              <span><ShieldCheck size={15} /> Pagamentos tokenizados no provedor</span>
              <span><ShieldCheck size={15} /> Webhooks assinados e idempotentes</span>
            </div>
          </article>
        </section>
      </main>

      <WhatsAppButton
        label="WhatsApp da agência"
        message="Olá! Estou acessando o painel administrativo da Próximo Destino."
      />
    </div>
  )
}
