import { type SubmitEvent, useState } from 'react'
import { formatMoney, paiseToInput, parseMoney } from '@shared/format'
import { Modal } from '../../components/Modal'

/** "50" -> ₹50 off, "10%" -> 10% of the subtotal. */
function parseDiscount(text: string, subtotal: number): number | null {
  const t = text.trim()
  if (!t) return 0
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1))
    return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round((subtotal * pct) / 100) : null
  }
  const paise = parseMoney(t)
  return paise !== null && paise >= 0 ? paise : null
}

interface DiscountDialogProps {
  subtotal: number
  current: number
  onApply: (amount: number) => void
  onClose: () => void
}

export function DiscountDialog({ subtotal, current, onApply, onClose }: DiscountDialogProps) {
  const [text, setText] = useState(current ? paiseToInput(current) : '')
  const amount = parseDiscount(text, subtotal)
  const tooMuch = amount !== null && amount > subtotal

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault()
    if (amount === null || tooMuch) return
    onApply(amount)
  }

  return (
    <Modal
      title="Discount on this bill"
      onClose={onClose}
      width={420}
      footer={
        <>
          {current > 0 && (
            <button type="button" className="btn" onClick={() => onApply(0)}>
              Remove discount
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="discount-form" className="btn primary" disabled={amount === null || tooMuch}>
            Apply
          </button>
        </>
      }
    >
      <form id="discount-form" onSubmit={onSubmit} className="stack">
        <label>
          Discount amount in ₹, or a percentage like 10%
          <input value={text} onChange={(e) => setText(e.target.value)} autoFocus inputMode="decimal" placeholder="0" />
        </label>
        <div className="muted">
          Subtotal ₹{formatMoney(subtotal)}
          {amount !== null && amount > 0 && !tooMuch && <> · after discount ₹{formatMoney(subtotal - amount)}</>}
        </div>
        {amount === null && <div className="form-error">Not a valid discount</div>}
        {tooMuch && <div className="form-error">Discount cannot be more than the subtotal</div>}
      </form>
    </Modal>
  )
}
