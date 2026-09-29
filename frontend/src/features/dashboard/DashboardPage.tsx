import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Compass,
  FileCheck2,
  MapPin,
  PlaneTakeoff,
  Route,
  Sparkles,
  TimerReset,
  Users,
} from 'lucide-react'

const journey = [
  { stage: 'Descoberta', value: 18, detail: 'novos interesses', tone: 'violet' },
  { stage: 'Cotação', value: 11, detail: 'propostas abertas', tone: 'blue' },
  { stage: 'Reserva', value: 7, detail: 'aguardando emissão', tone: 'amber' },
  { stage: 'Em viagem', value: 4, detail: 'grupos ativos', tone: 'green' },
  { stage: 'Pós-viagem', value: 9, detail: 'retornos pendentes', tone: 'rose' },
] as const

const liveTrips = [
  {
    city: 'Buenos Aires',
    client: 'Marina Albuquerque',
    when: '03 out · 07:10',
    code: 'PD-26091',
    progress: 72,
    status: 'Check-in liberado',
  },
  {
    city: 'Maceió',
    client: 'Rafael e família',
    when: 'Em viagem',
    code: 'PD-26102',
    progress: 54,
    status: 'Hotel confirmado',
  },
  {
    city: 'Lisboa',
    client: 'Beatriz Monteiro',
    when: '08 out · 18:40',
    code: 'PD-26097',
    progress: 36,
    status: 'Documentação concluída',
  },
] as const

const destinationPulse = [
  { city: 'Recife', demand: 92, change: '+31%' },
  { city: 'Buenos Aires', demand: 78, change: '+18%' },
  { city: 'Gramado', demand: 66, change: '+12%' },
  { city: 'Maceió', demand: 58, change: '+9%' },
] as const

export function DashboardPage() {
  return (
    <div className="command-center">
      <section className="command-hero">
        <div className="command-copy">
          <span className="stage-kicker">Travel Command Center · 29 setembro 2026</span>
          <h1>
            A agência inteira
            <span> em movimento.</span>
          </h1>
          <p>
            Uma leitura contínua da jornada dos clientes, da primeira intenção
            até o retorno da viagem.
          </p>

          <div className="command-actions">
            <button className="command-primary" type="button">
              Criar nova viagem
              <ArrowRight size={17} />
            </button>
            <button className="command-secondary" type="button">
              <Sparkles size={16} />
              Perguntar aos dados
            </button>
          </div>
        </div>

        <div className="flight-orbit" aria-label="Resumo operacional">
          <div className="orbit-ring orbit-ring--one" />
          <div className="orbit-ring orbit-ring--two" />
          <div className="orbit-ring orbit-ring--three" />

          <div className="orbit-core">
            <PlaneTakeoff size={26} />
            <strong>18</strong>
            <span>embarques em 7 dias</span>
          </div>

          <div className="orbit-node orbit-node--one">
            <Users size={16} />
            <div>
              <strong>118</strong>
              <span>viajantes ativos</span>
            </div>
          </div>

          <div className="orbit-node orbit-node--two">
            <CircleDollarSign size={16} />
            <div>
              <strong>R$ 184k</strong>
              <span>vendas no mês</span>
            </div>
          </div>

          <div className="orbit-node orbit-node--three">
            <FileCheck2 size={16} />
            <div>
              <strong>27</strong>
              <span>cotações abertas</span>
            </div>
          </div>
        </div>
      </section>

      <section className="journey-strip">
        <div className="journey-heading">
          <div>
            <span className="stage-kicker">Jornada do cliente</span>
            <h2>Onde cada oportunidade está agora</h2>
          </div>
          <button type="button">
            Ver funil completo
            <ArrowUpRight size={15} />
          </button>
        </div>

        <div className="journey-flow">
          {journey.map((item, index) => (
            <article className={`journey-stage journey-stage--${item.tone}`} key={item.stage}>
              <div className="journey-number">{String(index + 1).padStart(2, '0')}</div>
              <strong>{item.value}</strong>
              <span>{item.stage}</span>
              <small>{item.detail}</small>
              {index < journey.length - 1 && <i className="journey-link" />}
            </article>
          ))}
        </div>
      </section>

      <section className="command-grid">
        <article className="command-panel command-panel--live">
          <div className="panel-title">
            <div>
              <span className="stage-kicker">Agora</span>
              <h2>Viagens em movimento</h2>
            </div>
            <span className="live-chip"><i /> ao vivo</span>
          </div>

          <div className="live-trip-list">
            {liveTrips.map((trip) => (
              <button className="live-trip" type="button" key={trip.code}>
                <div className="trip-route">
                  <span className="route-dot" />
                  <span className="route-line" />
                  <span className="route-pin"><MapPin size={14} /></span>
                </div>
                <div className="trip-main">
                  <div className="trip-topline">
                    <strong>{trip.city}</strong>
                    <span>{trip.when}</span>
                  </div>
                  <p>{trip.client} · {trip.code}</p>
                  <div className="trip-progress">
                    <span style={{ width: `${trip.progress}%` }} />
                  </div>
                  <small>{trip.status}</small>
                </div>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </article>

        <article className="command-panel command-panel--pulse">
          <div className="panel-title">
            <div>
              <span className="stage-kicker">Radar de destinos</span>
              <h2>Demanda em aceleração</h2>
            </div>
            <Compass size={18} />
          </div>

          <div className="pulse-map">
            <div className="pulse-map-grid" />
            <span className="pulse-point pulse-point--a" />
            <span className="pulse-point pulse-point--b" />
            <span className="pulse-point pulse-point--c" />
            <span className="pulse-route pulse-route--a" />
            <span className="pulse-route pulse-route--b" />
            <div className="pulse-origin">FOR</div>
          </div>

          <div className="destination-list">
            {destinationPulse.map((item) => (
              <div className="destination-row" key={item.city}>
                <span>{item.city}</span>
                <div className="destination-meter">
                  <i style={{ width: `${item.demand}%` }} />
                </div>
                <strong>{item.change}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="command-panel command-panel--today">
          <div className="panel-title">
            <div>
              <span className="stage-kicker">Prioridades</span>
              <h2>O que precisa acontecer hoje</h2>
            </div>
            <TimerReset size={18} />
          </div>

          <div className="priority-list">
            <div className="priority-item priority-item--urgent">
              <div className="priority-icon"><CalendarClock size={16} /></div>
              <div>
                <strong>3 cotações vencem às 18h</strong>
                <span>Revalidar tarifa antes do envio</span>
              </div>
              <b>18:00</b>
            </div>
            <div className="priority-item">
              <div className="priority-icon"><FileCheck2 size={16} /></div>
              <div>
                <strong>5 documentos aguardam validação</strong>
                <span>Passaportes e comprovantes</span>
              </div>
              <b>5</b>
            </div>
            <div className="priority-item">
              <div className="priority-icon"><Route size={16} /></div>
              <div>
                <strong>4 embarques em menos de 24h</strong>
                <span>Conferir vouchers e contatos</span>
              </div>
              <b>4</b>
            </div>
          </div>
        </article>

        <article className="command-panel command-panel--insight">
          <span className="stage-kicker">Próximo Destino Intelligence</span>
          <h2>Recife ganhou força sem pressionar o ticket médio.</h2>
          <p>
            A procura cresceu 31% nesta semana e o ticket está 8% abaixo da
            média dos últimos 60 dias.
          </p>

          <div className="insight-bottom">
            <div>
              <strong>R$ 3.840</strong>
              <span>ticket médio atual</span>
            </div>
            <button type="button">
              Explorar oportunidade
              <ArrowUpRight size={15} />
            </button>
          </div>
        </article>
      </section>

      <button className="floating-command" type="button">
        <Sparkles size={17} />
        <span>Assistente Próximo Destino</span>
        <kbd>⌘ J</kbd>
      </button>
    </div>
  )
}
