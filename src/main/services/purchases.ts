import { round3, toLocalDateTime } from '@shared/format'
import type { DateRange, Purchase, PurchaseInput, PurchaseLine, PurchaseSummary } from '@shared/types'
import { type DB, transaction } from '../db/database'
import { getItem } from './items'
import { rangeBounds } from './range'
import { applyStockChange } from './stock'

const SUMMARY_COLUMNS = `id, created_at AS createdAt, supplier, invoice_no AS invoiceNo, total,
  (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = purchases.id) AS itemCount`

/** Stock in: adds stock, remembers the latest cost price and optionally updates the selling price. */
export function createPurchase(db: DB, input: PurchaseInput, now = new Date()): Purchase {
  if (input.lines.length === 0) throw new Error('Add at least one item')
  const items = input.lines.map((line) => {
    const item = getItem(db, line.itemId)
    if (!item) throw new Error('An item in this stock entry no longer exists')
    if (!(line.qty > 0)) throw new Error(`Quantity of ${item.name} must be more than 0`)
    if (!Number.isInteger(line.costPrice) || line.costPrice < 0) throw new Error(`Invalid cost price for ${item.name}`)
    if (line.salePrice != null && (!Number.isInteger(line.salePrice) || line.salePrice < 0)) {
      throw new Error(`Invalid sale price for ${item.name}`)
    }
    return item
  })
  const qtys = input.lines.map((l) => round3(l.qty))
  const amounts = input.lines.map((l, i) => Math.round(l.costPrice * qtys[i]))
  const total = amounts.reduce((a, b) => a + b, 0)
  const at = toLocalDateTime(now)

  const id = transaction(db, () => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO purchases (created_at, supplier, invoice_no, note, total) VALUES (?, ?, ?, ?, ?)')
      .run(at, input.supplier.trim(), input.invoiceNo.trim(), input.note.trim(), total)
    const purchaseId = Number(lastInsertRowid)
    const insertLine = db.prepare(
      'INSERT INTO purchase_items (purchase_id, item_id, qty, cost_price, amount) VALUES (?, ?, ?, ?, ?)'
    )
    input.lines.forEach((line, i) => {
      const item = items[i]
      insertLine.run(purchaseId, item.id, qtys[i], line.costPrice, amounts[i])
      applyStockChange(db, { itemId: item.id, change: qtys[i], reason: 'purchase', refId: purchaseId, at })
      if (line.costPrice > 0 && line.costPrice !== item.costPrice) {
        db.prepare('UPDATE items SET cost_price = ? WHERE id = ?').run(line.costPrice, item.id)
      }
      if (line.salePrice != null && line.salePrice !== item.salePrice) {
        db.prepare('UPDATE items SET sale_price = ? WHERE id = ?').run(line.salePrice, item.id)
      }
    })
    return purchaseId
  })
  return getPurchase(db, id)!
}

export function getPurchase(db: DB, id: number): Purchase | null {
  const row = db.prepare(`SELECT ${SUMMARY_COLUMNS}, note FROM purchases WHERE id = ?`).get(id) as
    | Omit<Purchase, 'lines'>
    | undefined
  if (!row) return null
  const lines = db
    .prepare(
      `SELECT pi.item_id AS itemId, i.name, pi.qty, pi.cost_price AS costPrice, pi.amount
       FROM purchase_items pi JOIN items i ON i.id = pi.item_id
       WHERE pi.purchase_id = ? ORDER BY pi.id`
    )
    .all(id)
    .map((r) => ({ ...r }) as unknown as PurchaseLine)
  return { ...row, lines }
}

export function listPurchases(db: DB, range: DateRange): PurchaseSummary[] {
  return db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM purchases WHERE created_at >= ? AND created_at < ? ORDER BY id DESC`)
    .all(...rangeBounds(range))
    .map((r) => ({ ...r }) as unknown as PurchaseSummary)
}

export function recentSuppliers(db: DB): string[] {
  return db
    .prepare(
      `SELECT supplier FROM purchases WHERE supplier != ''
       GROUP BY supplier COLLATE NOCASE ORDER BY MAX(id) DESC LIMIT 50`
    )
    .all()
    .map((r) => (r as { supplier: string }).supplier)
}
