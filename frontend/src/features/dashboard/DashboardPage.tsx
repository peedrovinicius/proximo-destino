import { ArrowUpRight, CalendarDays, CheckCircle2, Clock3 } from 'lucide-react'
import { metrics, pipeline, trips } from './dashboard.data'

export function DashboardPage() {
  return (
    <div className="dashboard-page">
      <section className="page-intro">
        <div>
          <span className="eyebrow">Terça-feira, 29 de setembro</span>
          <h1>Visão geral</h1>
          <p>Acompanhe vendas, cotações e viagens em uma única operação.</p>
        </div>

        <button className="period-button" type="button">
          <CalendarDays size={16} />
          Setembro 2026
        </button>
      </section>

      <section className="metrics-grid">
        {metrics.map((metric, index) => (
          <article className="metric-card" key={metric.label}>
            <div className="metric-header">
              <span>{metric.label}</span>
              <em className={index === 1 ? 'metric-badge metric-badge--warning' : 'metric-badge'}>
                {metric.badge}
              </em>
            </div>
            <strong>{metric.value}</strong>
            <p>{metric.helper}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="surface surface--wide">
          <div className="surface-header">
            <div>
              <span className="eyebrow">Operação</span>
              <h2>Próximas viagens</h2>
            </div>
            <button className="link-button" type="button">Ver todas</button>
          </div>

          <div className="travel-table">
            <div className="travel-row travel-row--head">
              <span>Cliente</span>
              <span>Destino</span>
              <span>Embarque</span>
              <span>Status</span>
              <span>Valor</span>
            </div>

            {trips.map((trip) => (
              <div className="travel-row" key={trip.code}>
                <div>
                  <strong>{trip.customer}</strong>
                  <small>{trip.code} · {trip.passengers} viajantes</small>
                </div>
                <span>{trip.destination}</span>
                <span>{trip.date}</span>
                <span>
                  <em className={`trip-status trip-status--${trip.status.toLowerCase().replace(' ', '-')}`}>
                    {trip.status}
                  </em>
                </span>
                <strong className="table-amount">{trip.amount}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="surface">
          <div className="surface-header">
            <div>
              <span className="eyebrow">Comercial</span>
              <h2>Funil de atendimento</h2>
            </div>
            <ArrowUpRight size={17} />
          </div>

          <div className="pipeline">
            {pipeline.map((step, index) => (
              <div className="pipeline-row" key={step.label}>
                <span className="pipeline-index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.value} oportunidades</small>
                </div>
                <b>{step.value}</b>
              </div>
            ))}
          </div>
        </article>

        <article className="surface">
          <div className="surface-header">
            <div>
              <span className="eyebrow">Hoje</span>
              <h2>Pendências operacionais</h2>
            </div>
            <Clock3 size={17} />
          </div>

          <div className="task-list">
            <div className="task-row">
              <span className="task-icon task-icon--warning"><Clock3 size={16} /></span>
              <div>
                <strong>3 cotações vencem hoje</strong>
                <small>Revisar disponibilidade e tarifa</small>
              </div>
            </div>
            <div className="task-row">
              <span className="task-icon"><CheckCircle2 size={16} /></span>
              <div>
                <strong>5 documentos para validar</strong>
                <small>Passaportes e comprovantes</small>
              </div>
            </div>
            <div className="task-row">
              <span className="task-icon"><CalendarDays size={16} /></span>
              <div>
                <strong>4 embarques nas próximas 24h</strong>
                <small>Conferir vouchers e contatos</small>
              </div>
            </div>
          </div>
        </article>

        <article className="surface insight-surface">
          <span className="eyebrow">Inteligência operacional</span>
          <h2>Decisões com base nos dados da própria agência.</h2>
          <p>
            O Próximo Destino será preparado para cruzar vendas, destinos,
            fornecedores, margens, sazonalidade e comportamento de clientes.
          </p>
          <button type="button">
            Abrir análises
            <ArrowUpRight size={16} />
          </button>
        </article>
      </section>
    </div>
  )
}
