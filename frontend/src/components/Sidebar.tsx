import { LogOut, PanelLeftClose } from 'lucide-react'
import { navigation } from '../app/navigation'
import { Brand } from './Brand'

type SidebarProps = {
  active: string
  onNavigate: (item: string) => void
  onLogout: () => void
}

export function Sidebar({ active, onNavigate, onLogout }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Brand />
        <button className="icon-ghost" type="button" aria-label="Recolher menu">
          <PanelLeftClose size={18} />
        </button>
      </div>

      <div className="sidebar-caption">Operação</div>

      <nav className="sidebar-nav" aria-label="Navegação principal">
        {navigation.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            className={`sidebar-link ${active === label ? 'sidebar-link--active' : ''}`}
            onClick={() => onNavigate(label)}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="user-avatar">PV</div>
        <div className="user-copy">
          <strong>Pedro Vinícius</strong>
          <small>Administrador</small>
        </div>
        <button className="icon-ghost" type="button" aria-label="Sair" onClick={onLogout}>
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  )
}
