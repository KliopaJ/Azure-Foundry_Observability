import { useEffect, useState } from 'react'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { msalConfig, ARM_SCOPES } from './auth/msalConfig'
import { AppConfig } from './types'
import { AppProvider } from './context/AppContext'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'
import UsageForecast from './components/UsageForecast'
import Quotas from './components/Quotas'
import About from './components/About'
import LoginPage from './components/LoginPage'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 2 * 60 * 1000, retry: 1 } },
})

function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuth = useIsAuthenticated()
  const { instance } = useMsal()
  if (!isAuth)
    return <LoginPage onLogin={() => instance.loginPopup({ scopes: ARM_SCOPES })} />
  return <>{children}</>
}

export default function App() {
  const [msal, setMsal] = useState<PublicClientApplication | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(async (cfg: AppConfig) => {
        setConfig(cfg)
        const inst = new PublicClientApplication(msalConfig(cfg.clientId, cfg.tenantId))
        await inst.initialize()
        setMsal(inst)
      })
  }, [])

  if (!msal || !config)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <span className="text-sm text-gray-400">Loading…</span>
      </div>
    )

  return (
    <MsalProvider instance={msal}>
      <QueryClientProvider client={qc}>
        <AppProvider config={config}>
          <BrowserRouter>
            <AuthGuard>
              <Routes>
                <Route path="/" element={<Layout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="forecast" element={<UsageForecast />} />
                  <Route path="quotas" element={<Quotas />} />
                  <Route path="about" element={<About />} />
                </Route>
              </Routes>
            </AuthGuard>
          </BrowserRouter>
        </AppProvider>
      </QueryClientProvider>
    </MsalProvider>
  )
}
