import { Bell, Plus, Search } from 'lucide-react'

type TopbarProps = {
  onCreateQuote: () => void
}

export function Topbar({ onCreateQuote }: TopbarProps) {
  return (
    <header className="topbar">
      <label className="global-search">
        <Search size={18} />
        <input placeholder="Buscar cliente, viagem, reserva..." />
        <kbd>⌘ K</kbd>
      </label>

      <div className="topbar-actions">
        <button className="notification-button" type="button" aria-label="Notificações">
          <Bell size={18} />
          <span />
        </button>

        <button className="primary-action" type="button" onClick={onCreateQuote}>
          <Plus size={17} />
          Nova cotação
        </button>
      </div>
    </header>
  )
}
