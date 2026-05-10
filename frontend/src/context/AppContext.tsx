import { createContext, useContext, useState, ReactNode } from 'react'
import { AppConfig } from '../types'

interface AppState {
  config: AppConfig
  theme: 'light' | 'dark'
  toggleTheme: () => void
  subId: string
  setSubId: (v: string) => void
  rg: string
  setRg: (v: string) => void
  foundryName: string
  setFoundryName: (v: string) => void
  project: string
  setProject: (v: string) => void
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null
    const initial = saved ?? 'dark'
    document.documentElement.classList.toggle('dark', initial === 'dark')
    return initial
  })
  const [subId, setSubId] = useState('')
  const [rg, setRg] = useState('')
  const [foundryName, setFoundryName] = useState('')
  const [project, setProject] = useState('')

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark')
  }

  return (
    <Ctx.Provider
      value={{
        config, theme, toggleTheme,
        subId, setSubId,
        rg, setRg,
        foundryName, setFoundryName,
        project, setProject,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useApp() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}
