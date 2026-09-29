import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Filter,
  MapPin,
  Plane,
  Search,
  Sun,
  Users,
} from 'lucide-react'
import { Brand } from './components/Brand'

const metrics = [
  { icon: Users, label: 'Clientes ativos', value: '248', change: '↑ 12%' },
  { icon: FileText, label: 'Cotações no mês', value: '37', change: '↑ 28%' },
  { icon: Plane, label: 'Viagens confirmadas', value: '18', change: '↑ 20%' },
  { icon: CircleDollarSign, label: 'Receita do mês', value: 'R$ 124.860', change: '↑ 32%' },
]

const trips = [
  { day: '12', month: 'JAN', city: 'Paris, França', client: 'Família Oliveira', status: 'Embarque em 3 dias', image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=260&q=80' },
  { day: '18', month: 'JAN', city: 'Maldivas', client: 'Grupo Empresarial', status: 'Documentação pendente', image: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=260&q=80' },
  { day: '25', month: 'JAN', city: 'Nova York, EUA', client: 'Casal Mendes', status: 'Pré embarque', image: 'https://images.unsplash.com/photo-1485871981521-5b1fd3805eee?auto=format&fit=crop&w=260&q=80' },
]

const destinations = [
  { name: 'Cancún', meta: '14 viagens', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=420&q=82' },
  { name: 'Roma', meta: '11 viagens', image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=420&q=82' },
  { name: 'Bariloche', meta: '9 viagens', image: 'https://images.unsplash.com/photo-1464278533981-50106e6176b1?auto=format&fit=crop&w=420&q=82' },
]

const tasks = [
  { text: 'Enviar documentos · Família Oliveira', when: 'Hoje', urgent: true },
  { text: 'Confirmar reservas · Grupo Empresarial', when: 'Hoje', urgent: true },
  { text: 'Emitir vouchers · Casal Mendes', when: 'Amanhã', urgent: false },
  { text: 'Solicitar vistos · Viagem Japão', when: 'Amanhã', urgent: false },
]

function App() {
  return (
    <div className="prototype-shell">
      <aside className="auth-rail">
        <div className="auth-overlay" />
        <div className="auth-content">
          <div className="auth-brand">
            <Brand compact />
          </div>

          <div className="auth-copy">
            <h1>
              Transformando
              <br />
              viagens em
              <br />
              <span>histórias reais.</span>
            </h1>
            <p>Gestão completa para uma agência que vai mais longe.</p>
          </div>

          <form className="auth-card" onSubmit={(event) => event.preventDefault()}>
            <h2>Acesse sua conta</h2>
            <p>Entre para continuar no Próximo Destino.</p>

            <label className="auth-field">
              <span>E-mail</span>
              <input type="email" placeholder="Seu e-mail" />
            </label>

            <label className="auth-field">
              <span>Senha</span>
              <input type="password" placeholder="Sua senha" />
            </label>

            <div className="auth-options">
              <label>
                <input type="checkbox" defaultChecked />
                <span>Lembrar de mim</span>
              </label>
              <button type="button">Esqueceu a senha?</button>
            </div>

            <button className="auth-submit" type="submit">
              Entrar no painel
              <ChevronRight size={18} />
            </button>
          </form>

          <blockquote>“O mundo é mais do que um destino. É uma coleção de momentos.”</blockquote>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-topbar">
          <Brand compact />

          <nav className="workspace-nav" aria-label="Principal">
            <button className="workspace-nav-item workspace-nav-item--active" type="button">Visão Geral</button>
            <button className="workspace-nav-item" type="button">Clientes</button>
            <button className="workspace-nav-item" type="button">Cotações</button>
            <button className="workspace-nav-item" type="button">Viagens</button>
            <button className="workspace-nav-item" type="button">Financeiro</button>
            <button className="workspace-nav-item" type="button">Relatórios</button>
          </nav>

          <div className="workspace-actions">
            <label className="workspace-search">
              <Search size={16} />
              <input placeholder="Buscar cliente, viagem ou reserva..." />
            </label>
            <button className="square-button" type="button"><Sun size={17} /></button>
            <button className="square-button notify" type="button"><Bell size={17} /><i /></button>
            <button className="avatar-button" type="button">PV</button>
          </div>
        </header>

        <main className="dashboard">
          <section className="hero-banner">
            <div className="hero-shade" />
            <div className="hero-copy">
              <span className="hero-greeting">Bom dia, Pedro.</span>
              <h2>
                Hoje é um ótimo dia
                <br />
                para criar <span>novas histórias.</span>
              </h2>
            </div>

            <div className="hero-weather">
              <MapPin size={16} />
              <div>
                <strong>Bangkok, Tailândia</strong>
                <span>32°C ☀</span>
              </div>
            </div>
          </section>

          <section className="metric-grid">
            {metrics.map(({ icon: Icon, label, value, change }) => (
              <article className="metric-card" key={label}>
                <div className="metric-icon"><Icon size={21} /></div>
                <div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{change}</small>
                </div>
              </article>
            ))}
          </section>

          <section className="primary-grid">
            <article className="panel trips-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-icon"><Plane size={16} /></span>
                  <h3>Próximas viagens</h3>
                </div>
                <button type="button">Ver todas <ChevronRight size={14} /></button>
              </div>

              <div className="trip-list">
                {trips.map((trip) => (
                  <div className="trip-row" key={trip.client}>
                    <div className="trip-date">
                      <strong>{trip.day}</strong>
                      <span>{trip.month}</span>
                    </div>
                    <img src={trip.image} alt="" />
                    <div className="trip-copy">
                      <strong>{trip.client}</strong>
                      <span><MapPin size={12} /> {trip.city}</span>
                      <small>{trip.status}</small>
                    </div>
                    <div className="trip-people">
                      <span>PV</span><span>+2</span>
                    </div>
                    <ChevronRight size={17} />
                  </div>
                ))}
              </div>
            </article>

            <article className="panel destinations-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-icon"><MapPin size={16} /></span>
                  <h3>Destinos em destaque</h3>
                </div>
              </div>

              <div className="destination-tabs">
                <button className="active" type="button">Mais vendidos</button>
                <button type="button">Em alta</button>
                <button type="button">Sazonais</button>
              </div>

              <div className="destination-grid">
                {destinations.map((destination) => (
                  <article
                    className="destination-card"
                    key={destination.name}
                    style={{ backgroundImage: `url(${destination.image})` }}
                  >
                    <div className="destination-shade" />
                    <div>
                      <strong>{destination.name}</strong>
                      <span>{destination.meta}</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="destination-dots"><i className="active" /><i /><i /><i /></div>
            </article>

            <article className="panel funnel-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-icon"><Filter size={16} /></span>
                  <h3>Funil comercial</h3>
                </div>
                <button type="button">Ver funil <ChevronRight size={14} /></button>
              </div>

              <div className="funnel-grid">
                <div><span>Leads</span><strong>120</strong></div>
                <div><span>Contato</span><strong>86</strong></div>
                <div><span>Cotações</span><strong>54</strong></div>
                <div><span>Negociação</span><strong>28</strong></div>
                <div><span>Fechadas</span><strong>18</strong></div>
              </div>
              <div className="funnel-line">
                <i /><i /><i /><i /><i />
              </div>
            </article>

            <article className="panel tasks-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-icon"><BriefcaseBusiness size={16} /></span>
                  <h3>Pendências operacionais</h3>
                </div>
                <button type="button">Ver todas <ChevronRight size={14} /></button>
              </div>

              <div className="task-list">
                {tasks.map((task) => (
                  <div className="task-row" key={task.text}>
                    <span className={task.urgent ? 'task-dot task-dot--urgent' : 'task-dot'}>
                      <Check size={12} />
                    </span>
                    <strong>{task.text}</strong>
                    <em className={task.urgent ? 'urgent' : ''}>{task.when}</em>
                    <ChevronRight size={14} />
                  </div>
                ))}
              </div>
            </article>
          </section>
        </main>
      </section>
    </div>
  )
}

export default App
