import { useState } from 'react'
import { AdminDashboard } from './features/admin/AdminDashboard'
import { AdminLogin } from './features/admin/AdminLogin'
import { ClientLogin } from './features/client/ClientLogin'
import { ClientPortal } from './features/client/ClientPortal'
import { HomePage } from './features/home/HomePage'

type Screen = 'home' | 'client-login' | 'client' | 'admin-login' | 'admin'

function App() {
  const [screen, setScreen] = useState<Screen>('home')

  if (screen === 'home') {
    return (
      <HomePage
        onClientAccess={() => setScreen('client-login')}
        onAdminAccess={() => setScreen('admin-login')}
      />
    )
  }

  if (screen === 'admin-login') {
    return (
      <AdminLogin
        onSubmit={() => setScreen('admin')}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'admin') {
    return <AdminDashboard onLogout={() => setScreen('home')} />
  }

  if (screen === 'client') {
    return <ClientPortal onLogout={() => setScreen('home')} />
  }

  return (
    <ClientLogin
      onSubmit={() => setScreen('client')}
      onAdminAccess={() => setScreen('admin-login')}
    />
  )
}

export default App
