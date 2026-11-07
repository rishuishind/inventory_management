import { round3 } from '@shared/format'
import type { MovementReason, StockMovement } from '@shared/types'
import type { DB } from '../db/database'

export interface StockChange {
  itemId: number
  change: number
  reason: MovementReason
  refId?: number | null
  note?: string
  at: string
}

/** Change an item's stock and log why. Call inside a transaction. Returns the new stock. */
export function applyStockChange(db: DB, m: StockChange): number {
  const row = db
    .prepare('UPDATE items SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ? RETURNING stock')
    .get(m.change, m.at, m.itemId) as { stock: number } | undefined
  if (!row) throw new Error(`Item ${m.itemId} not found`)
  db.prepare(
    `INSERT INTO stock_movements (item_id, created_at, change, balance, reason, ref_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(m.itemId, m.at, round3(m.change), row.stock, m.reason, m.refId ?? null, m.note ?? '')
  return row.stock
}

export function stockHistory(db: DB, itemId: number, limit = 500): StockMovement[] {
  return db
    .prepare(
      `SELECT m.id, m.created_at AS createdAt, m.change, m.balance, m.reason, m.ref_id AS refId, m.note,
              CASE WHEN m.reason IN ('sale', 'sale_cancel') THEN b.bill_no
                   WHEN m.reason = 'purchase' THEN p.supplier END AS refLabel
       FROM stock_movements m
       LEFT JOIN bills b ON m.reason IN ('sale', 'sale_cancel') AND b.id = m.ref_id
       LEFT JOIN purchases p ON m.reason = 'purchase' AND p.id = m.ref_id
       WHERE m.item_id = ?
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(itemId, limit)
    .map((r) => ({ ...r }) as unknown as StockMovement)
}
