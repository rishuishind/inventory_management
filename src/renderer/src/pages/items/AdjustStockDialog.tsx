import { type SubmitEvent, useState } from 'react'
import { formatQty, parseQty } from '@shared/format'
import type { Item } from '@shared/types'
import { api, errorMessage } from '../../api'
import { Modal } from '../../components/Modal'

type Mode = 'set' | 'add' | 'remove'

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'set', label: 'Set counted stock' },
  { mode: 'add', label: 'Add' },
  { mode: 'remove', label: 'Remove' }
]

const REASONS = ['Stock count', 'Damaged / expired', 'Own use / staff', 'Returned to supplier', 'Other']

interface AdjustStockDialogProps {
  item: Item
  onDone: (item: Item) => void
  onClose: () => void
}

export function AdjustStockDialog({ item, onDone, onClose }: AdjustStockDialogProps) {
  const [mode, setMode] = useState<Mode>('set')
  const [qtyText, setQtyText] = useState('')
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const qty = parseQty(qtyText)
  const valid = qty !== null && qty >= 0
  const newStock = !valid ? null : mode === 'set' ? qty : mode === 'add' ? item.stock + qty : item.stock - qty

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault()
    if (!valid) {
      setError('Enter a quantity')
      return
    }
    setSaving(true)
    try {
      const updated = await api.stock.adjust({
        itemId: item.id,
        mode: mode === 'set' ? 'set' : 'add',
        qty: mode === 'remove' ? -qty : qty,
        reason: note.trim() ? `${reason}: ${note.trim()}` : reason
      })
      onDone(updated)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Adjust stock · ${item.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="adjust-form" className="btn primary" disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <form id="adjust-form" className="stack" onSubmit={(e) => void onSubmit(e)}>
        <div className="segmented">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className={mode === m.mode ? 'on' : ''}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label>
          {mode === 'set' ? 'Stock you counted' : mode === 'add' ? 'Quantity to add' : 'Quantity to remove'} ({item.unit})
          <input value={qtyText} onChange={(e) => setQtyText(e.target.value)} inputMode="decimal" autoFocus />
        </label>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </label>
        <div className="muted">
          Current stock <b>{formatQty(item.stock)}</b>
          {newStock !== null && (
            <>
              {' '}
              → new stock <b>{formatQty(newStock)}</b>
            </>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  )
}
