import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'
type PushToast = (text: string, kind?: ToastKind) => void

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const ToastContext = createContext<PushToast>(() => {})
let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const push = useCallback<PushToast>(
    (text, kind = 'info') => {
      const id = ++nextId
      setToasts((all) => [...all.slice(-3), { id, kind, text }])
      setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500)
    },
    [dismiss]
  )
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): PushToast {
  return useContext(ToastContext)
}
