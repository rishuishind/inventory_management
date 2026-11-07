import { X } from 'lucide-react'
import { type ReactNode, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Open modals, innermost last: Escape only closes the top one.
const stack: string[] = []

export function isModalOpen(): boolean {
  return stack.length > 0
}

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}

export function Modal({ title, onClose, children, footer, width = 520 }: ModalProps) {
  const id = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const boxRef = useRef<HTMLDivElement>(null)

  // Pull focus into the dialog as it opens, so keys typed right away never reach the page behind.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || box.contains(document.activeElement)) return
    box.querySelector<HTMLElement>('input, select, textarea, button:not([tabindex="-1"])')?.focus()
  }, [])

  // Registered during layout so page shortcuts see the dialog before the next key press.
  useLayoutEffect(() => {
    stack.push(id)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(id), 1)
    }
  }, [id])

  return createPortal(
    <div className="modal-backdrop">
      <div ref={boxRef} className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" tabIndex={-1}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
