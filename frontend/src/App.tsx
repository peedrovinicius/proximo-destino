import { useState } from 'react'
import { AdminDashboard } from './features/admin/AdminDashboard'
import { AdminLogin } from './features/admin/AdminLogin'
import { ClientLogin } from './features/client/ClientLogin'
import { ClientPortal } from './features/client/ClientPortal'

type Screen = 'client-login' | 'client' | 'admin-login' | 'admin'

function App() {
  const [screen, setScreen] = useState<Screen>('client-login')

  if (screen === 'admin-login') {
    return (
      <AdminLogin
        onSubmit={() => setScreen('admin')}
        onBack={() => setScreen('client-login')}
      />
    )
  }

  if (screen === 'admin') {
    return <AdminDashboard onLogout={() => setScreen('admin-login')} />
  }

  if (screen === 'client') {
    return (
      <ClientPortal onLogout={() => setScreen('client-login')} />
    )
  }

  return (
    <ClientLogin
      onSubmit={() => setScreen('client')}
      onAdminAccess={() => setScreen('admin-login')}
    />
  )
}

export default App
