import { Banknote, CreditCard, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatMoney, paiseToInput, parseMoney } from '@shared/format'
import type { Bill, BillLineInput, PaymentMode } from '@shared/types'
import { api, errorMessage } from '../../api'
import { useApp } from '../../AppContext'
import { Modal } from '../../components/Modal'

const MODES: { mode: PaymentMode; label: string; key: string; Icon: typeof Banknote }[] = [
  { mode: 'cash', label: 'Cash', key: 'F1', Icon: Banknote },
  { mode: 'upi', label: 'UPI', key: 'F2', Icon: Smartphone },
  { mode: 'card', label: 'Card', key: 'F3', Icon: CreditCard }
]

const ceilTo = (paise: number, step: number): number => Math.ceil(paise / step) * step

interface PaymentDialogProps {
  lines: BillLineInput[]
  discount: number
  total: number
  onPaid: (bill: Bill, print: boolean) => void
  onClose: () => void
}

export function PaymentDialog({ lines, discount, total, onPaid, onClose }: PaymentDialogProps) {
  const { settings } = useApp()
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [received, setReceived] = useState('')
  const [print, setPrint] = useState(settings.autoPrint)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const cashRef = useRef<HTMLInputElement>(null)

  const receivedPaise = mode === 'cash' && received.trim() ? parseMoney(received) : null
  const invalid = mode === 'cash' && received.trim() !== '' && receivedPaise === null
  const short = receivedPaise !== null && receivedPaise < total
  const change = receivedPaise !== null && receivedPaise >= total ? receivedPaise - total : null

  // Exact amount and the notes a customer is likely to hand over.
  const suggestions = useMemo(
    () =>
      [...new Set([total, ceilTo(total, 5000), ceilTo(total, 10000), ceilTo(total, 50000), ceilTo(total, 200000)])]
        .filter((v) => v >= total && v > 0)
        .slice(0, 5),
    [total]
  )

  async function save(): Promise<void> {
    if (savingRef.current || invalid || short) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const bill = await api.bills.create({ lines, discount, paymentMode: mode, tendered: receivedPaise })
      onPaid(bill, print)
    } catch (err) {
      setError(errorMessage(err))
      savingRef.current = false
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const picked = MODES.find((m) => m.key === e.key)
      if (picked) {
        e.preventDefault()
        setMode(picked.mode)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal
      title="Payment"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Back <kbd>Esc</kbd>
          </button>
          <button
            type="button"
            className="btn success lg"
            onClick={() => void save()}
            disabled={saving || invalid || short}
          >
            {saving ? 'Saving…' : 'Save bill'} <kbd>Enter</kbd>
          </button>
        </>
      }
    >
      <div className="pay">
        <div className="pay-total">
          <span>Amount to collect</span>
          <strong>₹{formatMoney(total)}</strong>
        </div>
        <div className="pay-modes" role="radiogroup" aria-label="Payment mode">
          {MODES.map(({ mode: m, label, key, Icon }) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`pay-mode ${mode === m ? 'on' : ''}`}
              onClick={() => setMode(m)}
            >
              <Icon size={22} />
              {label}
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>

        {mode === 'cash' ? (
          <>
            <label className="pay-cash">
              Cash received (leave empty if exact)
              <input
                ref={cashRef}
                autoFocus
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                inputMode="decimal"
                placeholder={formatMoney(total)}
                aria-invalid={invalid || short}
              />
            </label>
            <div className="quick-cash">
              {suggestions.map((v) => (
                <button key={v} type="button" className="chip" onClick={() => setReceived(paiseToInput(v))}>
                  ₹{formatMoney(v)}
                </button>
              ))}
            </div>
            <div className="pay-change" aria-live="polite">
              {change !== null && (
                <>
                  Return to customer <strong>₹{formatMoney(change)}</strong>
                </>
              )}
              {short && receivedPaise !== null && (
                <span className="text-danger">₹{formatMoney(total - receivedPaise)} short</span>
              )}
              {invalid && <span className="text-danger">Not a valid amount</span>}
            </div>
          </>
        ) : (
          <p className="pay-note">
            {mode === 'upi'
              ? 'Check that the UPI payment has arrived before saving.'
              : 'Check that the card payment went through on the machine before saving.'}
          </p>
        )}

        <label className="check">
          <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} />
          Print receipt{!settings.printerName && ' (shows a preview: no printer set up yet)'}
        </label>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}
