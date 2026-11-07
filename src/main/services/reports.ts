import { splitTax } from '@shared/billing'
import { round3, toLocalDate } from '@shared/format'
import type { DateRange, DaySales, GstRow, ItemSalesRow, SalesSummary, StockRow, TodayStats } from '@shared/types'
import type { DB } from '../db/database'
import { ITEM_COLUMNS, toItem } from './items'
import { rangeBounds } from './range'

const PAID_IN_RANGE = `b.status = 'paid' AND b.created_at >= ? AND b.created_at < ?`

const MODE_SUMS = `SUM(CASE WHEN b.payment_mode = 'cash' THEN b.total ELSE 0 END) AS cash,
  SUM(CASE WHEN b.payment_mode = 'upi' THEN b.total ELSE 0 END) AS upi,
  SUM(CASE WHEN b.payment_mode = 'card' THEN b.total ELSE 0 END) AS card`

type Numbers<T> = { [K in keyof T]: number | null }

export function salesSummary(db: DB, range: DateRange): SalesSummary {
  const bounds = rangeBounds(range)
  const t = db
    .prepare(
      `SELECT COUNT(*) AS bills, SUM(b.subtotal) AS subtotal, SUM(b.discount) AS discount, SUM(b.taxable) AS taxable,
              SUM(b.cgst) AS cgst, SUM(b.sgst) AS sgst, SUM(b.round_off) AS roundOff, SUM(b.total) AS total,
              ${MODE_SUMS}
       FROM bills b WHERE ${PAID_IN_RANGE}`
    )
    .get(...bounds) as Numbers<Omit<SalesSummary, 'days' | 'cancelled' | 'cost'>>
  const { cancelled } = db
    .prepare(`SELECT COUNT(*) AS cancelled FROM bills WHERE status = 'cancelled' AND created_at >= ? AND created_at < ?`)
    .get(...bounds) as { cancelled: number }
  const { cost } = db
    .prepare(
      `SELECT SUM(ROUND(bi.cost_price * bi.qty)) AS cost
       FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE ${PAID_IN_RANGE}`
    )
    .get(...bounds) as { cost: number | null }
  const days = db
    .prepare(
      `SELECT substr(b.created_at, 1, 10) AS date, COUNT(*) AS bills, SUM(b.total) AS total, ${MODE_SUMS}
       FROM bills b WHERE ${PAID_IN_RANGE}
       GROUP BY date ORDER BY date`
    )
    .all(...bounds)
    .map((r) => ({ ...r }) as unknown as DaySales)
  return {
    bills: t.bills ?? 0,
    cancelled,
    subtotal: t.subtotal ?? 0,
    discount: t.discount ?? 0,
    taxable: t.taxable ?? 0,
    cgst: t.cgst ?? 0,
    sgst: t.sgst ?? 0,
    roundOff: t.roundOff ?? 0,
    total: t.total ?? 0,
    cash: t.cash ?? 0,
    upi: t.upi ?? 0,
    card: t.card ?? 0,
    cost: Math.round(cost ?? 0),
    days
  }
}

export function itemSales(db: DB, range: DateRange): ItemSalesRow[] {
  return db
    .prepare(
      `SELECT bi.item_id AS itemId, COALESCE(i.name, MAX(bi.name)) AS name, MAX(bi.unit) AS unit,
              SUM(bi.qty) AS qty, SUM(bi.taxable + bi.tax) AS sales, SUM(bi.taxable) AS taxable,
              SUM(ROUND(bi.cost_price * bi.qty)) AS cost
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
       LEFT JOIN items i ON i.id = bi.item_id
       WHERE ${PAID_IN_RANGE}
       GROUP BY bi.item_id
       ORDER BY sales DESC, qty DESC, name COLLATE NOCASE`
    )
    .all(...rangeBounds(range))
    .map((r) => {
      const row = r as unknown as ItemSalesRow
      return { ...row, qty: round3(row.qty), cost: Math.round(row.cost) }
    })
}

/** Rate-wise GST for bills made under the regular scheme - what the CA needs for GSTR-1 / 3B. */
export function gstReport(db: DB, range: DateRange): GstRow[] {
  return db
    .prepare(
      `SELECT bi.gst_rate AS rate, SUM(bi.taxable) AS taxable, SUM(bi.tax) AS tax
       FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE ${PAID_IN_RANGE} AND b.gst_mode = 'regular'
       GROUP BY bi.gst_rate ORDER BY bi.gst_rate`
    )
    .all(...rangeBounds(range))
    .map((r) => {
      const row = r as { rate: number; taxable: number; tax: number }
      return { rate: row.rate, taxable: row.taxable, ...splitTax(row.tax) }
    })
}

export function stockReport(db: DB): StockRow[] {
  return db
    .prepare(
      `SELECT ${ITEM_COLUMNS}, ROUND(MAX(stock, 0) * cost_price) AS stockValue
       FROM items WHERE active = 1 AND track_stock = 1 ORDER BY name COLLATE NOCASE`
    )
    .all()
    .map((r) => {
      const row = r as unknown as { stockValue: number }
      return { ...toItem(r), stockValue: Math.round(row.stockValue) }
    })
}

export function todayStats(db: DB, now = new Date()): TodayStats {
  const today = toLocalDate(now)
  const row = db
    .prepare(`SELECT COUNT(*) AS bills, SUM(b.total) AS total FROM bills b WHERE ${PAID_IN_RANGE}`)
    .get(...rangeBounds({ from: today, to: today })) as { bills: number; total: number | null }
  return { bills: row.bills, total: row.total ?? 0 }
}
