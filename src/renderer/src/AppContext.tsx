import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type { Settings, TodayStats } from '@shared/types'
import { api } from './api'

interface AppState {
  settings: Settings
  setSettings: (settings: Settings) => void
  today: TodayStats
  refreshToday: () => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [today, setToday] = useState<TodayStats>({ bills: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)

  const refreshToday = useCallback(() => {
    api.reports.today().then(setToday, () => {})
  }, [])

  useEffect(() => {
    api.settings.get().then(setSettings, (err: unknown) => setError(String(err)))
    refreshToday()
  }, [refreshToday])

  if (error) return <div className="splash error">Could not load settings: {error}</div>
  if (!settings) return <div className="splash">Loading…</div>
  return (
    <AppContext.Provider value={{ settings, setSettings, today, refreshToday }}>{children}</AppContext.Provider>
  )
}

export function useApp(): AppState {
  const state = useContext(AppContext)
  if (!state) throw new Error('useApp must be used inside AppProvider')
  return state
}
