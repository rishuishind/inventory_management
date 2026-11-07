import { useEffect, useState } from 'react'
import { displayDate, formatQty } from '@shared/format'
import type { Item, MovementReason, StockMovement } from '@shared/types'
import { api, errorMessage } from '../../api'
import { Modal } from '../../components/Modal'

const REASON_LABELS: Record<MovementReason, string> = {
  opening: 'Opening stock',
  sale: 'Sold',
  sale_cancel: 'Bill cancelled',
  purchase: 'Stock in',
  adjust: 'Adjusted'
}

export function HistoryDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [rows, setRows] = useState<StockMovement[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.stock.history(item.id).then(setRows, (err: unknown) => setError(errorMessage(err)))
  }, [item.id])

  return (
    <Modal title={`Stock history · ${item.name}`} onClose={onClose} width={760}>
      {error && <div className="form-error">{error}</div>}
      {rows && rows.length === 0 && <p className="muted">No stock changes yet.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap modal-table">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>What happened</th>
                <th>Reference</th>
                <th className="num">Change</th>
                <th className="num">Stock after</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{displayDate(m.createdAt)}</td>
                  <td>
                    {REASON_LABELS[m.reason] ?? m.reason}
                    {m.note && <span className="muted"> · {m.note}</span>}
                  </td>
                  <td className="mono">{m.refLabel ?? ''}</td>
                  <td className={`num strong ${m.change < 0 ? 'text-danger' : 'text-success'}`}>
                    {m.change > 0 ? '+' : ''}
                    {formatQty(m.change)}
                  </td>
                  <td className="num">{formatQty(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
