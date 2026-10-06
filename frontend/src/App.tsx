import { useCallback, useEffect, useState } from 'react'
import { AdminDashboard } from './features/admin/AdminDashboard'
import { AdminLogin } from './features/admin/AdminLogin'
import { ClientLogin } from './features/client/ClientLogin'
import { ClientPortal } from './features/client/ClientPortal'
import { HomePage } from './features/home/HomePage'
import { InstitutionalPage } from './features/home/InstitutionalPage'
import type { InstitutionalPageKey } from './components/PublicFooter'
import { logoutAdmin, refreshAdminSession } from './lib/adminAuth'
import { AcceptCompanyInvite } from './features/creator/AcceptCompanyInvite'
import { CreatorWorkspace } from './features/creator/CreatorWorkspace'
import { CompanyCatalogPage } from './features/home/CompanyCatalogPage'
import { CompanyClientPortal } from './features/client/CompanyClientPortal'

type Screen =
  | 'home'
  | 'institutional'
  | 'client-login'
  | 'client'
  | 'admin-login'
  | 'admin'
  | 'creator'
  | 'company-invite'
  | 'company'
  | 'company-client'

const screens = new Set<Screen>([
  'home',
  'institutional',
  'client-login',
  'client',
  'admin-login',
  'admin',
  'creator',
  'company-invite',
  'company',
  'company-client',
])

const institutionalPages = new Set<InstitutionalPageKey>([
  'about',
  'culture',
  'purpose',
  'contact',
  'sales',
  'payments',
  'cancellation',
  'terms',
  'privacy',
  'cookies',
  'who-can-travel',
  'anti-harassment',
  'sustainability',
  'boarding-points',
  'ethics',
])

function screenFromLocation(): Screen {
  const value = new URLSearchParams(window.location.search).get('screen')
  return value && screens.has(value as Screen) ? (value as Screen) : 'home'
}

function institutionalFromLocation(): InstitutionalPageKey {
  const value = new URLSearchParams(window.location.search).get('page')
  return value && institutionalPages.has(value as InstitutionalPageKey)
    ? (value as InstitutionalPageKey)
    : 'about'
}

function updateLocation(
  screen: Screen,
  options: {
    replace?: boolean
    institutionalPage?: InstitutionalPageKey
  } = {},
) {
  const url = new URL(window.location.href)

  if (screen === 'home') {
    url.searchParams.delete('screen')
    url.searchParams.delete('page')
    url.searchParams.delete('tab')
    url.searchParams.delete('paymentConnection')
  } else {
    url.searchParams.set('screen', screen)
    if (screen !== 'admin') url.searchParams.delete('tab')
  }

  if (screen === 'institutional' && options.institutionalPage) {
    url.searchParams.set('page', options.institutionalPage)
  } else if (screen !== 'institutional') {
    url.searchParams.delete('page')
  }

  if (options.replace) {
    window.history.replaceState({ screen }, '', url)
  } else {
    window.history.pushState({ screen }, '', url)
  }
}

function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromLocation())
  const [companySlug, setCompanySlug] = useState(() => new URLSearchParams(window.location.search).get('company') || '')
  const [adminAccessToken, setAdminAccessToken] = useState<string | null>(null)
  const [clientAccessToken, setClientAccessToken] = useState<string | null>(null)
  const [institutionalPage, setInstitutionalPage] =
    useState<InstitutionalPageKey>(() => institutionalFromLocation())
  const [restoringAdmin, setRestoringAdmin] = useState(
    () => screenFromLocation() === 'admin',
  )

  const navigate = useCallback(
    (
      next: Screen,
      options: {
        replace?: boolean
        institutionalPage?: InstitutionalPageKey
      } = {},
    ) => {
      if (options.institutionalPage) {
        setInstitutionalPage(options.institutionalPage)
      }
      setScreen(next)
      updateLocation(next, options)
    },
    [],
  )

  const enterAdmin = useCallback(async () => {
    setRestoringAdmin(true)
    try {
      const result = await refreshAdminSession()
      if (result.user.role === 'CREATOR') { setAdminAccessToken(null); navigate('creator'); return }
      setAdminAccessToken(result.accessToken)
      navigate('admin')
    } catch {
      navigate('admin-login')
    } finally {
      setRestoringAdmin(false)
    }
  }, [navigate])

  useEffect(() => {
    function onPopState() {
      setScreen(screenFromLocation())
      setCompanySlug(new URLSearchParams(window.location.search).get('company') || '')
      setInstitutionalPage(institutionalFromLocation())
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const requestedScreen = screenFromLocation()
    const status = new URLSearchParams(window.location.search).get(
      'paymentConnection',
    )

    if (status && !window.opener) {
      setRestoringAdmin(true)
      void refreshAdminSession()
        .then((result) => {
          if (result.user.role === 'CREATOR') {
            setScreen('creator'); updateLocation('creator', { replace: true }); return
          }
          setAdminAccessToken(result.accessToken)
          setScreen('admin')
          const url = new URL(window.location.href)
          url.searchParams.set('screen', 'admin')
          url.searchParams.set('tab', 'settings')
          window.history.replaceState({ screen: 'admin' }, '', url)
        })
        .catch(() => {
          setScreen('admin-login')
          const url = new URL(window.location.href)
          url.searchParams.set('screen', 'admin-login')
          window.history.replaceState({ screen: 'admin-login' }, '', url)
        })
        .finally(() => setRestoringAdmin(false))
      return
    }

    if (requestedScreen === 'admin') {
      setRestoringAdmin(true)
      void refreshAdminSession()
        .then((result) => {
          if (result.user.role === 'CREATOR') {
            setScreen('creator'); updateLocation('creator', { replace: true }); return
          }
          setAdminAccessToken(result.accessToken)
          setScreen('admin')
        })
        .catch(() => {
          setScreen('admin-login')
          updateLocation('admin-login', { replace: true })
        })
        .finally(() => setRestoringAdmin(false))
    }
  }, [])

  useEffect(() => {
    if (!adminAccessToken) return

    let active = true
    let refreshing = false

    async function refreshSilently() {
      if (refreshing) return
      refreshing = true
      try {
        const result = await refreshAdminSession()
        if (active) {
          if (result.user.role === 'CREATOR') { setAdminAccessToken(null); navigate('creator', { replace: true }) }
          else setAdminAccessToken(result.accessToken)
        }
      } catch {
        // Falha transitória não encerra a sessão na interface.
        // O próximo ciclo ou retorno à aba tentará novamente.
      } finally {
        refreshing = false
      }
    }

    const interval = window.setInterval(() => {
      void refreshSilently()
    }, 7 * 60 * 1000)

    function onVisible() {
      if (document.visibilityState === 'visible') {
        void refreshSilently()
      }
    }

    function onFocus() {
      void refreshSilently()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [adminAccessToken, navigate])

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get(
      'paymentConnection',
    )
    if (!status) return

    const payload = {
      type: 'MERCADO_PAGO_OAUTH',
      status: status === 'success' ? 'success' : 'error',
      at: Date.now(),
    }

    try {
      localStorage.setItem(
        'mercado-pago-oauth-result',
        JSON.stringify(payload),
      )
    } catch {
      // armazenamento indisponível
    }

    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin)
      window.setTimeout(() => window.close(), 250)
    }
  }, [])

  if (screen === 'company-client') return <CompanyClientPortal key={companySlug} slug={companySlug} onBack={() => navigate('company')} />
  if (screen === 'company') return <CompanyCatalogPage key={companySlug} slug={companySlug} onClientAccess={() => navigate('company-client')} />

  if (screen === 'home') {
    return (
      <HomePage
        onClientAccess={() =>
          navigate(clientAccessToken ? 'client' : 'client-login')
        }
        onAdminAccess={() => void enterAdmin()}
        onInstitutionalNavigate={(page) =>
          navigate('institutional', { institutionalPage: page })
        }
      />
    )
  }

  if (screen === 'company-invite') return <AcceptCompanyInvite onBack={() => navigate('home')} />

  if (screen === 'creator') {
    return <CreatorWorkspace onBack={() => navigate('home')} />
  }

  if (screen === 'institutional') {
    return (
      <InstitutionalPage
        page={institutionalPage}
        onBack={() => window.history.back()}
        onNavigate={(page) => {
          setInstitutionalPage(page)
          const url = new URL(window.location.href)
          url.searchParams.set('screen', 'institutional')
          url.searchParams.set('page', page)
          window.history.pushState(
            { screen: 'institutional', page },
            '',
            url,
          )
        }}
        onAdminAccess={() => void enterAdmin()}
      />
    )
  }

  if (screen === 'admin-login') {
    return (
      <AdminLogin
        onSubmit={(accessToken) => {
          setAdminAccessToken(accessToken)
          navigate('admin', { replace: true })
        }}
        onBack={() => {
          if (window.history.length > 1) window.history.back()
          else navigate('home', { replace: true })
        }}
      />
    )
  }

  if (screen === 'admin') {
    if (restoringAdmin) {
      return (
        <main className="admin-session-restore" aria-live="polite">
          <div>
            <strong>Restaurando sua sessão</strong>
            <span>Você não precisa entrar novamente.</span>
          </div>
        </main>
      )
    }

    if (!adminAccessToken) {
      return (
        <AdminLogin
          onSubmit={(accessToken) => {
            setAdminAccessToken(accessToken)
            navigate('admin', { replace: true })
          }}
          onBack={() => {
            if (window.history.length > 1) window.history.back()
            else navigate('home', { replace: true })
          }}
        />
      )
    }

    return (
      <AdminDashboard
        accessToken={adminAccessToken}
        onExitToSite={() => navigate('home')}
        onLogout={() => {
          void logoutAdmin(adminAccessToken)
          setAdminAccessToken(null)
          navigate('home', { replace: true })
        }}
      />
    )
  }

  if (screen === 'client') {
    if (!clientAccessToken) {
      return (
        <ClientLogin
          onSubmit={(accessToken) => {
            setClientAccessToken(accessToken)
            navigate('client', { replace: true })
          }}
          onBack={() => window.history.back()}
          onAdminAccess={() => void enterAdmin()}
        />
      )
    }

    return (
      <ClientPortal
        accessToken={clientAccessToken}
        onExitToSite={() => navigate('home')}
        onLogout={() => {
          setClientAccessToken(null)
          navigate('home', { replace: true })
        }}
      />
    )
  }

  return (
    <ClientLogin
      onSubmit={(accessToken) => {
        setClientAccessToken(accessToken)
        navigate('client', { replace: true })
      }}
      onBack={() => {
        if (window.history.length > 1) window.history.back()
        else navigate('home', { replace: true })
      }}
      onAdminAccess={() => void enterAdmin()}
    />
  )
}

export default App
