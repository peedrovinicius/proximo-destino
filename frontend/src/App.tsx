import {
  Bell,
  Command,
  FileText,
  MapPinned,
  Search,
  Settings,
  Sparkles,
  SuitcaseBusiness,
  Users,
  WalletCards,
} from 'lucide-react'
import { useState } from 'react'
import { Brand } from './components/Brand'
import { LoginPage } from './features/auth/LoginPage'
import { DashboardPage } from './features/dashboard/DashboardPage'

const modules = [
  { label: 'Operação', icon: Command },
  { label: 'Clientes', icon: Users },
  { label: 'Cotações', icon: FileText },
  { label: 'Viagens', icon: SuitcaseBusiness },
  { label: 'Destinos', icon: MapPinned },
  { label: 'Financeiro', icon: WalletCards },
] as const

function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [activeModule, setActiveModule] = useState('Operação')

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />
  }

  return (
    <div className="orbit-shell">
      <header className="orbit-topbar">
        <Brand />

        <nav className="orbit-nav" aria-label="Navegação principal">
          {modules.map(({ label, icon: Icon }) => (
            <button
              type="button"
              key={label}
              className={activeModule === label ? 'orbit-nav-item orbit-nav-item--active' : 'orbit-nav-item'}
              onClick={() => setActiveModule(label)}
            >
              <Icon size={15} strokeWidth={1.9} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="orbit-actions">
          <button className="orbit-search" type="button" aria-label="Buscar">
            <Search size={17} />
            <span>Buscar</span>
            <kbd>⌘K</kbd>
          </button>
          <button className="orbit-icon" type="button" aria-label="Assistente">
            <Sparkles size={18} />
          </button>
          <button className="orbit-icon orbit-icon--alert" type="button" aria-label="Notificações">
            <Bell size={18} />
            <i />
          </button>
          <button className="orbit-icon" type="button" aria-label="Configurações">
            <Settings size={18} />
          </button>
          <button className="orbit-profile" type="button" onClick={() => setAuthenticated(false)}>
            PV
          </button>
        </div>
      </header>

      <main className="orbit-main">
        {activeModule === 'Operação' ? (
          <DashboardPage />
        ) : (
          <section className="module-stage">
            <span className="stage-kicker">Próximo Destino</span>
            <h1>{activeModule}</h1>
            <p>Este módulo entra na próxima etapa do desenvolvimento.</p>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
