import { useState } from 'react'
import { AdminDashboard } from './features/admin/AdminDashboard'
import { AdminLogin } from './features/admin/AdminLogin'
import { ClientLogin } from './features/client/ClientLogin'
import { ClientPortal } from './features/client/ClientPortal'
import { HomePage } from './features/home/HomePage'
import { logoutAdmin } from './lib/adminAuth'

type Screen = 'home' | 'client-login' | 'client' | 'admin-login' | 'admin'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [adminAccessToken, setAdminAccessToken] = useState<string | null>(null)

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
        onSubmit={(accessToken) => {
          setAdminAccessToken(accessToken)
          setScreen('admin')
        }}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'admin') {
    if (!adminAccessToken) {
      return (
        <AdminLogin
          onSubmit={(accessToken) => {
            setAdminAccessToken(accessToken)
            setScreen('admin')
          }}
          onBack={() => setScreen('home')}
        />
      )
    }

    return (
      <AdminDashboard
        onLogout={() => {
          void logoutAdmin(adminAccessToken)
          setAdminAccessToken(null)
          setScreen('home')
        }}
      />
    )
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
