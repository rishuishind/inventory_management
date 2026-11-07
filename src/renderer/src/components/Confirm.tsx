import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'
import { Modal } from './Modal'

interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmText?: string
  danger?: boolean
}

type AskConfirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<AskConfirm>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)

  const ask = useCallback<AskConfirm>(
    (options) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    []
  )
  const answer = (ok: boolean): void => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <Modal
          title={pending.options.title}
          onClose={() => answer(false)}
          width={440}
          footer={
            <>
              <button type="button" className="btn" onClick={() => answer(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${pending.options.danger ? 'danger' : 'primary'}`}
                onClick={() => answer(true)}
                autoFocus
              >
                {pending.options.confirmText ?? 'OK'}
              </button>
            </>
          }
        >
          <div className="confirm-text">{pending.options.message}</div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): AskConfirm {
  return useContext(ConfirmContext)
}
