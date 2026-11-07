import { computeBill } from '@shared/billing'
import { financialYear, formatBillNo, round3, toLocalDateTime } from '@shared/format'
import type { Bill, BillDraft, BillLine, BillSummary, DateRange, Settings } from '@shared/types'
import { type DB, transaction } from '../db/database'
import { getItem } from './items'
import { rangeBounds } from './range'
import { applyStockChange } from './stock'

const PAYMENT_MODES = ['cash', 'upi', 'card']

const SUMMARY_COLUMNS = `id, bill_no AS billNo, created_at AS createdAt, total, payment_mode AS paymentMode, status,
  (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = bills.id) AS itemCount`

export function createBill(db: DB, draft: BillDraft, settings: Settings, now = new Date()): Bill {
  if (draft.lines.length === 0) throw new Error('The bill is empty')
  if (!PAYMENT_MODES.includes(draft.paymentMode)) throw new Error('Choose a payment mode')

  const items = draft.lines.map((line) => {
    const item = getItem(db, line.itemId)
    if (!item) throw new Error('An item on this bill no longer exists')
    if (!(line.qty > 0)) throw new Error(`Quantity of ${item.name} must be more than 0`)
    if (!Number.isInteger(line.price) || line.price < 0) throw new Error(`Invalid price for ${item.name}`)
    return item
  })
  const qtys = draft.lines.map((l) => round3(l.qty))
  const calc = computeBill(
    draft.lines.map((l, i) => ({ price: l.price, qty: qtys[i], gstRate: items[i].gstRate })),
    {
      gstMode: settings.gstMode,
      pricesIncludeGst: settings.pricesIncludeGst,
      roundOff: settings.roundOff,
      discount: draft.discount
    }
  )
  const tendered = draft.paymentMode === 'cash' && draft.tendered != null ? draft.tendered : null
  if (tendered != null && tendered < calc.total) throw new Error('Cash received is less than the bill total')

  const at = toLocalDateTime(now)
  const fy = financialYear(now)
  const billId = transaction(db, () => {
    const { seq } = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM bills WHERE fy = ?').get(fy) as {
      seq: number
    }
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO bills (bill_no, fy, seq, created_at, subtotal, discount, taxable, cgst, sgst, round_off, total,
                            payment_mode, tendered, gst_mode, prices_include_gst)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        formatBillNo(fy, seq),
        fy,
        seq,
        at,
        calc.subtotal,
        calc.discount,
        calc.taxable,
        calc.cgst,
        calc.sgst,
        calc.roundOff,
        calc.total,
        draft.paymentMode,
        tendered,
        settings.gstMode,
        settings.pricesIncludeGst ? 1 : 0
      )
    const id = Number(lastInsertRowid)
    const insertLine = db.prepare(
      `INSERT INTO bill_items (bill_id, item_id, name, barcode, hsn, unit, qty, price, cost_price, amount, discount,
                               gst_rate, taxable, tax)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    draft.lines.forEach((line, i) => {
      const item = items[i]
      const r = calc.lines[i]
      insertLine.run(
        id,
        item.id,
        item.name,
        item.barcode,
        item.hsn,
        item.unit,
        qtys[i],
        line.price,
        item.costPrice,
        r.amount,
        r.discount,
        item.gstRate,
        r.taxable,
        r.tax
      )
      applyStockChange(db, { itemId: item.id, change: -qtys[i], reason: 'sale', refId: id, at })
    })
    return id
  })
  return getBill(db, billId)!
}

export function getBill(db: DB, id: number): Bill | null {
  const row = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, subtotal, discount, taxable, cgst, sgst, round_off AS roundOff, tendered,
              cancelled_at AS cancelledAt, gst_mode AS gstMode, prices_include_gst AS pricesIncludeGst
       FROM bills WHERE id = ?`
    )
    .get(id) as (Omit<Bill, 'pricesIncludeGst' | 'lines'> & { pricesIncludeGst: number }) | undefined
  if (!row) return null
  const lines = db
    .prepare(
      `SELECT id, item_id AS itemId, name, barcode, hsn, unit, qty, price, cost_price AS costPrice, amount, discount,
              gst_rate AS gstRate, taxable, tax
       FROM bill_items WHERE bill_id = ? ORDER BY id`
    )
    .all(id)
    .map((r) => ({ ...r }) as unknown as BillLine)
  return { ...row, pricesIncludeGst: row.pricesIncludeGst === 1, lines }
}

export function lastBill(db: DB): Bill | null {
  const row = db.prepare('SELECT id FROM bills ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined
  return row ? getBill(db, row.id) : null
}

/** Bills in a date range, or - when q is given - bills whose number contains q, any date. */
export function listBills(db: DB, range: DateRange, q?: string): BillSummary[] {
  const rows = q?.trim()
    ? db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM bills WHERE bill_no LIKE ? ORDER BY id DESC LIMIT 200`)
        .all(`%${q.trim()}%`)
    : db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM bills WHERE created_at >= ? AND created_at < ? ORDER BY id DESC`)
        .all(...rangeBounds(range))
  return rows.map((r) => ({ ...r }) as unknown as BillSummary)
}

/** Cancelled bills keep their number (GST rules) but leave the sales figures and return stock. */
export function cancelBill(db: DB, id: number, now = new Date()): Bill {
  const bill = getBill(db, id)
  if (!bill) throw new Error('Bill not found')
  if (bill.status === 'cancelled') throw new Error('This bill is already cancelled')
  const at = toLocalDateTime(now)
  transaction(db, () => {
    db.prepare(`UPDATE bills SET status = 'cancelled', cancelled_at = ? WHERE id = ?`).run(at, id)
    for (const line of bill.lines) {
      if (line.itemId != null) {
        applyStockChange(db, { itemId: line.itemId, change: line.qty, reason: 'sale_cancel', refId: id, at })
      }
    }
  })
  return getBill(db, id)!
}
