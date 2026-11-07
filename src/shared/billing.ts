// Bill arithmetic: line amounts, bill discount, GST split and round-off.
// Used live on the billing screen and again by the main process when the bill is saved,
// so the screen and the stored bill always agree. All amounts are integer paise.

import type { GstMode } from './types'

export interface CalcLine {
  price: number
  qty: number
  gstRate: number
}

export interface CalcOptions {
  gstMode: GstMode
  pricesIncludeGst: boolean
  roundOff: boolean
  /** Bill-level discount in paise. */
  discount: number
}

export interface CalcLineResult {
  /** price x qty */
  amount: number
  /** This line's share of the bill discount. */
  discount: number
  taxable: number
  /** CGST + SGST for this line. */
  tax: number
  /** What the customer pays for this line (before round-off). */
  total: number
}

export interface GstSummaryRow {
  rate: number
  taxable: number
  cgst: number
  sgst: number
}

export interface BillCalc {
  lines: CalcLineResult[]
  subtotal: number
  discount: number
  taxable: number
  tax: number
  cgst: number
  sgst: number
  roundOff: number
  total: number
  gstSummary: GstSummaryRow[]
}

export function lineAmount(price: number, qty: number): number {
  return Math.round(price * qty)
}

/** Split `total` paise across `weights` proportionally, without losing a paisa (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (total <= 0 || sum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (total * w) / sum)
  const shares = exact.map(Math.floor)
  let rest = total - shares.reduce((a, b) => a + b, 0)
  const order = exact
    .map((e, i) => ({ frac: e - Math.floor(e), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) shares[order[k].i]++
  return shares
}

/** Intra-state sale: tax is split equally into CGST and SGST (odd paisa goes to CGST). */
export function splitTax(tax: number): { cgst: number; sgst: number } {
  const cgst = Math.round(tax / 2)
  return { cgst, sgst: tax - cgst }
}

export function computeBill(lines: CalcLine[], opts: CalcOptions): BillCalc {
  const amounts = lines.map((l) => lineAmount(l.price, l.qty))
  const subtotal = amounts.reduce((a, b) => a + b, 0)
  const discount = Math.min(Math.max(Math.round(opts.discount), 0), Math.max(subtotal, 0))
  const discounts = allocate(discount, amounts)
  const taxed = opts.gstMode === 'regular'

  const results: CalcLineResult[] = lines.map((l, i) => {
    const net = amounts[i] - discounts[i]
    let taxable = net
    let tax = 0
    if (taxed && l.gstRate > 0) {
      if (opts.pricesIncludeGst) {
        taxable = Math.round((net * 100) / (100 + l.gstRate))
        tax = net - taxable
      } else {
        tax = Math.round((net * l.gstRate) / 100)
      }
    }
    return { amount: amounts[i], discount: discounts[i], taxable, tax, total: taxable + tax }
  })

  const groups = new Map<number, { taxable: number; tax: number }>()
  if (taxed) {
    lines.forEach((l, i) => {
      const g = groups.get(l.gstRate) ?? { taxable: 0, tax: 0 }
      g.taxable += results[i].taxable
      g.tax += results[i].tax
      groups.set(l.gstRate, g)
    })
  }
  const gstSummary = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, g]) => ({ rate, taxable: g.taxable, ...splitTax(g.tax) }))

  const taxable = results.reduce((a, r) => a + r.taxable, 0)
  const tax = results.reduce((a, r) => a + r.tax, 0)
  const gross = results.reduce((a, r) => a + r.total, 0)
  const total = opts.roundOff ? Math.round(gross / 100) * 100 : gross

  return {
    lines: results,
    subtotal,
    discount,
    taxable,
    tax,
    cgst: gstSummary.reduce((a, g) => a + g.cgst, 0),
    sgst: gstSummary.reduce((a, g) => a + g.sgst, 0),
    roundOff: total - gross,
    total,
    gstSummary
  }
}

/** "2*8901234567890" or "2 * tea" -> quantity 2 of that item. */
export function parseScanInput(text: string): { qty: number; term: string } {
  const m = /^\s*(\d+(?:\.\d+)?)\s*\*\s*(.+)$/.exec(text)
  if (m && Number(m[1]) > 0) return { qty: Number(m[1]), term: m[2].trim() }
  return { qty: 1, term: text.trim() }
}

/** Scanners send digits only; 6+ digits that matched nothing is an unknown barcode, not a name search. */
export function looksLikeBarcode(term: string): boolean {
  return /^\d{6,}$/.test(term)
}
