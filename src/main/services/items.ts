import { round3, toLocalDateTime } from '@shared/format'
import type { Item, ItemInput, ItemList, ItemListQuery, StockAdjustInput } from '@shared/types'
import { type DB, likeEscape, transaction } from '../db/database'
import { applyStockChange } from './stock'

export const ITEM_COLUMNS = `id, name, barcode, category, unit, sale_price AS salePrice, cost_price AS costPrice,
  gst_rate AS gstRate, hsn, stock, low_stock AS lowStock, track_stock AS trackStock, quick, active`

type ItemRow = Omit<Item, 'trackStock' | 'quick' | 'active'> & { trackStock: number; quick: number; active: number }

export function toItem(row: unknown): Item {
  const r = row as ItemRow
  return { ...r, trackStock: r.trackStock === 1, quick: r.quick === 1, active: r.active === 1 }
}

export function getItem(db: DB, id: number): Item | null {
  const row = db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).get(id)
  return row ? toItem(row) : null
}

export function lookupBarcode(db: DB, code: string): Item | null {
  const barcode = code.trim()
  if (!barcode) return null
  const row = db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE barcode = ? AND active = 1`).get(barcode)
  return row ? toItem(row) : null
}

/** Every word must appear in the name (or start the barcode): "lays 50" finds "Lays Classic 50g". */
function wordMatch(q: string): { sql: string; params: string[] } {
  const words = q.trim().split(/\s+/).filter(Boolean)
  return {
    sql: words.map(() => `(name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')`).join(' AND '),
    params: words.flatMap((w) => [`%${likeEscape(w)}%`, `${likeEscape(w)}%`])
  }
}

export function searchItems(db: DB, q: string, limit = 10): Item[] {
  const term = q.trim()
  if (!term) return []
  const match = wordMatch(term)
  return db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM items
       WHERE active = 1 AND ${match.sql}
       ORDER BY CASE WHEN barcode = ? THEN 0
                     WHEN name = ? COLLATE NOCASE THEN 1
                     WHEN name LIKE ? ESCAPE '\\' THEN 2
                     ELSE 3 END,
                name COLLATE NOCASE
       LIMIT ?`
    )
    .all(...match.params, term, term, `${likeEscape(term)}%`, limit)
    .map(toItem)
}

export function listItems(db: DB, query: ItemListQuery): ItemList {
  const where: string[] = [query.filter === 'inactive' ? 'active = 0' : 'active = 1']
  const params: (string | number)[] = []
  if (query.filter === 'low') where.push('track_stock = 1 AND stock <= low_stock')
  if (query.filter === 'out') where.push('track_stock = 1 AND stock <= 0')
  if (query.filter === 'quick') where.push('quick = 1')
  if (query.q?.trim()) {
    const match = wordMatch(query.q)
    where.push(match.sql)
    params.push(...match.params)
  }
  if (query.category) {
    where.push('category = ?')
    params.push(query.category)
  }
  const whereSql = where.join(' AND ')
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM items WHERE ${whereSql}`).get(...params) as {
    total: number
  }
  const rows = db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE ${whereSql} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...params, query.limit ?? 200, query.offset ?? 0)
    .map(toItem)
  return { rows, total }
}

function isPaise(n: number): boolean {
  return Number.isInteger(n) && n >= 0
}

export function saveItem(db: DB, input: ItemInput, now = new Date()): Item {
  const name = input.name.trim()
  if (!name) throw new Error('Item name is required')
  if (!isPaise(input.salePrice)) throw new Error('Enter a valid sale price')
  if (!isPaise(input.costPrice)) throw new Error('Enter a valid cost price')
  if (!Number.isFinite(input.gstRate) || input.gstRate < 0 || input.gstRate > 100) {
    throw new Error('GST % must be between 0 and 100')
  }
  if (!Number.isFinite(input.lowStock) || input.lowStock < 0) throw new Error('Low stock level cannot be negative')
  const barcode = input.barcode?.trim() || null
  if (barcode) {
    const dup = db.prepare('SELECT name FROM items WHERE barcode = ? AND id != ?').get(barcode, input.id ?? 0) as
      | { name: string }
      | undefined
    if (dup) throw new Error(`Barcode ${barcode} is already used by "${dup.name}"`)
  }
  const at = toLocalDateTime(now)
  const values = [
    name,
    barcode,
    input.category.trim(),
    input.unit.trim() || 'pcs',
    input.salePrice,
    input.costPrice,
    input.gstRate,
    input.hsn.trim(),
    round3(input.lowStock),
    input.trackStock ? 1 : 0,
    input.quick ? 1 : 0,
    input.active ? 1 : 0,
    at
  ]

  return transaction(db, () => {
    if (input.id) {
      const res = db
        .prepare(
          `UPDATE items SET name = ?, barcode = ?, category = ?, unit = ?, sale_price = ?, cost_price = ?,
             gst_rate = ?, hsn = ?, low_stock = ?, track_stock = ?, quick = ?, active = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(...values, input.id)
      if (res.changes === 0) throw new Error('Item not found')
      return getItem(db, input.id)!
    }
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO items (name, barcode, category, unit, sale_price, cost_price, gst_rate, hsn, low_stock,
                            track_stock, quick, active, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...values, at)
    const id = Number(lastInsertRowid)
    const opening = round3(input.openingStock ?? 0)
    if (opening !== 0) applyStockChange(db, { itemId: id, change: opening, reason: 'opening', at })
    return getItem(db, id)!
  })
}

/** Items with sales or purchases are kept for the records and only hidden. */
export function removeItem(db: DB, id: number, now = new Date()): { deleted: boolean } {
  const { used } = db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM bill_items WHERE item_id = ?)
           OR EXISTS (SELECT 1 FROM purchase_items WHERE item_id = ?) AS used`
    )
    .get(id, id) as { used: number }
  if (used) {
    db.prepare('UPDATE items SET active = 0, quick = 0, updated_at = ? WHERE id = ?').run(toLocalDateTime(now), id)
    return { deleted: false }
  }
  transaction(db, () => {
    db.prepare('DELETE FROM stock_movements WHERE item_id = ?').run(id)
    db.prepare('DELETE FROM items WHERE id = ?').run(id)
  })
  return { deleted: true }
}

export function itemCategories(db: DB): string[] {
  return db
    .prepare(`SELECT DISTINCT category FROM items WHERE category != '' ORDER BY category COLLATE NOCASE`)
    .all()
    .map((r) => (r as { category: string }).category)
}

export function quickItems(db: DB): Item[] {
  return db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE quick = 1 AND active = 1 ORDER BY name COLLATE NOCASE LIMIT 48`)
    .all()
    .map(toItem)
}

export function adjustStock(db: DB, input: StockAdjustInput, now = new Date()): Item {
  const item = getItem(db, input.itemId)
  if (!item) throw new Error('Item not found')
  if (!Number.isFinite(input.qty)) throw new Error('Enter a valid quantity')
  const change = input.mode === 'set' ? round3(input.qty - item.stock) : round3(input.qty)
  if (change === 0) return item
  transaction(db, () =>
    applyStockChange(db, {
      itemId: item.id,
      change,
      reason: 'adjust',
      note: input.reason.trim(),
      at: toLocalDateTime(now)
    })
  )
  return getItem(db, item.id)!
}
