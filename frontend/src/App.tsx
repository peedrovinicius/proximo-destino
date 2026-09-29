import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { LoginPage } from './features/auth/LoginPage'
import { DashboardPage } from './features/dashboard/DashboardPage'

function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [activePage, setActivePage] = useState('Visão geral')

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={activePage}
        onNavigate={setActivePage}
        onLogout={() => setAuthenticated(false)}
      />

      <main className="app-main">
        <Topbar onCreateQuote={() => setActivePage('Cotações')} />

        {activePage === 'Visão geral' ? (
          <DashboardPage />
        ) : (
          <section className="placeholder-page">
            <span className="eyebrow">Próximo Destino</span>
            <h1>{activePage}</h1>
            <p>
              Módulo preparado para a próxima etapa do desenvolvimento.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
