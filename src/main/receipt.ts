// Receipt layout for 58 mm / 80 mm thermal printers. Plain HTML so the Windows printer driver
// renders it; everything is pure black because thermal paper cannot print grey.

import { splitTax } from '@shared/billing'
import { displayDate, formatMoney, formatQty, toLocalDateTime } from '@shared/format'
import type { Bill, BillLine, Settings } from '@shared/types'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

function lines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('')
}

function qtyText(line: BillLine): string {
  return line.unit && line.unit !== 'pcs' ? `${formatQty(line.qty)} ${esc(line.unit)}` : formatQty(line.qty)
}

const TITLES = { regular: 'TAX INVOICE', composition: 'BILL OF SUPPLY', none: 'BILL' }
const PAYMENT_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card' }

export interface ReceiptOptions {
  /** Adds Print / Close buttons (hidden when printing) for the on-screen preview. */
  preview?: boolean
}

export function receiptHtml(bill: Bill, settings: Settings, options: ReceiptOptions = {}): string {
  const narrow = settings.paperWidth === 58
  const taxed = bill.gstMode === 'regular'
  const totalQty = bill.lines.reduce((a, l) => a + l.qty, 0)

  const itemRows = bill.lines
    .map((l) =>
      narrow
        ? `<tr><td colspan="2">${esc(l.name)}</td></tr>
           <tr><td class="sub">${qtyText(l)} x ${formatMoney(l.price)}</td><td class="r">${formatMoney(l.amount)}</td></tr>`
        : `<tr><td>${esc(l.name)}</td><td class="r">${qtyText(l)}</td><td class="r">${formatMoney(l.price)}</td>
           <td class="r">${formatMoney(l.amount)}</td></tr>`
    )
    .join('')
  const itemHead = narrow
    ? '<tr><th>Item</th><th class="r">Amount</th></tr>'
    : '<tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>'

  const totals: string[] = [`<tr><td>Subtotal</td><td class="r">${formatMoney(bill.subtotal)}</td></tr>`]
  if (bill.discount > 0) totals.push(`<tr><td>Discount</td><td class="r">-${formatMoney(bill.discount)}</td></tr>`)
  if (taxed && !bill.pricesIncludeGst) {
    totals.push(`<tr><td>GST</td><td class="r">${formatMoney(bill.cgst + bill.sgst)}</td></tr>`)
  }
  if (bill.roundOff !== 0) {
    totals.push(`<tr><td>Round off</td><td class="r">${bill.roundOff > 0 ? '' : '-'}${formatMoney(Math.abs(bill.roundOff))}</td></tr>`)
  }

  let gstBlock = ''
  if (taxed) {
    const groups = new Map<number, { taxable: number; tax: number }>()
    for (const l of bill.lines) {
      const g = groups.get(l.gstRate) ?? { taxable: 0, tax: 0 }
      g.taxable += l.taxable
      g.tax += l.tax
      groups.set(l.gstRate, g)
    }
    const rows = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, g]) => {
        const { cgst, sgst } = splitTax(g.tax)
        return `<tr><td>${rate}%</td><td class="r">${formatMoney(g.taxable)}</td><td class="r">${formatMoney(cgst)}</td>
                <td class="r">${formatMoney(sgst)}</td></tr>`
      })
      .join('')
    gstBlock = `<hr><table class="gst">
        <tr><th>GST</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr>${rows}
      </table>${bill.pricesIncludeGst ? '<div class="note">Prices include GST</div>' : ''}`
  }

  const payment = [`<tr><td>Paid by ${PAYMENT_LABELS[bill.paymentMode]}</td><td class="r">${formatMoney(bill.tendered ?? bill.total)}</td></tr>`]
  if (bill.tendered != null && bill.tendered > bill.total) {
    payment.push(`<tr><td>Change</td><td class="r">${formatMoney(bill.tendered - bill.total)}</td></tr>`)
  }

  const header = [
    `<div class="shop">${esc(settings.shopName)}</div>`,
    lines(settings.shopAddress),
    settings.shopPhone ? `<div>Ph: ${esc(settings.shopPhone)}</div>` : '',
    bill.gstMode !== 'none' && settings.gstin ? `<div>GSTIN: ${esc(settings.gstin)}</div>` : ''
  ].join('')

  const toolbar = options.preview
    ? `<div class="toolbar"><button id="print" autofocus>Print</button><button id="close">Close</button>
       <span>No printer is set up yet. Use Print to pick a printer or "Microsoft Print to PDF".</span></div>
       <script>
         document.getElementById('print').onclick = () => window.print();
         document.getElementById('close').onclick = () => window.close();
         document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
       </script>`
    : ''

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Bill ${esc(bill.billNo)}</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font: ${narrow ? 11 : 12}px/1.35 Arial, "Segoe UI", sans-serif; }
  .receipt { width: ${narrow ? 48 : 72}mm; margin: 0 auto; padding: 2mm 0 6mm; }
  .head { text-align: center; }
  .shop { font-size: ${narrow ? 14 : 16}px; font-weight: 700; }
  .title { text-align: center; font-weight: 700; letter-spacing: 1px; margin: 4px 0 2px; }
  .void { border: 2px solid #000; text-align: center; font-weight: 700; font-size: 15px; margin: 4px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 700; border-bottom: 1px dashed #000; padding: 1px 0 2px; }
  td { padding: 1px 0; vertical-align: top; }
  td + td, th + th { padding-left: 4px; }
  .r { text-align: right; white-space: nowrap; }
  .sub { padding-left: 8px; }
  .grand td { font-size: ${narrow ? 14 : 16}px; font-weight: 700; padding-top: 3px; }
  .gst { font-size: ${narrow ? 10 : 11}px; }
  .note, .foot { text-align: center; font-size: ${narrow ? 10 : 11}px; margin-top: 3px; }
  .foot { font-size: inherit; margin-top: 6px; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
             padding: 10px; background: #eef1f5; font: 13px "Segoe UI", sans-serif; }
  .toolbar button { font: inherit; padding: 6px 16px; cursor: pointer; }
  .toolbar span { color: #444; font-size: 12px; }
  @media print { .toolbar { display: none; } }
</style></head>
<body>${toolbar}
<div class="receipt">
  <div class="head">${header}</div>
  <div class="title">${TITLES[bill.gstMode]}</div>
  ${bill.status === 'cancelled' ? '<div class="void">CANCELLED</div>' : ''}
  <table><tr><td>Bill: <b>${esc(bill.billNo)}</b></td><td class="r">${displayDate(bill.createdAt)}</td></tr></table>
  <hr>
  <table class="items">${itemHead}${itemRows}</table>
  <hr>
  <table>
    <tr><td>Items: ${bill.lines.length} &nbsp; Qty: ${formatQty(totalQty)}</td><td></td></tr>
    ${totals.join('')}
    <tr class="grand"><td>TOTAL</td><td class="r">₹${formatMoney(bill.total)}</td></tr>
  </table>
  ${gstBlock}
  <hr>
  <table>${payment.join('')}</table>
  ${bill.gstMode === 'composition' ? '<div class="note">Composition taxable person, not eligible to collect tax on supplies</div>' : ''}
  ${settings.receiptFooter ? `<div class="foot">${esc(settings.receiptFooter)}</div>` : ''}
</div>
</body></html>`
}

/** A realistic bill for the "Test print" button in Settings. */
export function sampleBill(settings: Settings): Bill {
  const line = (id: number, name: string, qty: number, price: number, gstRate: number): BillLine => {
    const amount = Math.round(price * qty)
    const taxable = settings.gstMode === 'regular' ? Math.round((amount * 100) / (100 + gstRate)) : amount
    return { id, itemId: id, name, barcode: null, hsn: '', unit: 'pcs', qty, price, costPrice: 0, amount, discount: 0, gstRate, taxable, tax: amount - taxable }
  }
  const billLines = [line(1, 'Tea', 2, 1000, 5), line(2, 'Samosa', 2, 1500, 5), line(3, 'Cold drink 250ml', 1, 2000, 40)]
  const total = billLines.reduce((a, l) => a + l.amount, 0)
  const tax = billLines.reduce((a, l) => a + l.tax, 0)
  const { cgst, sgst } = splitTax(tax)
  return {
    id: 0,
    billNo: 'TEST/1',
    createdAt: toLocalDateTime(new Date()),
    itemCount: billLines.length,
    total,
    paymentMode: 'cash',
    status: 'paid',
    subtotal: total,
    discount: 0,
    taxable: total - tax,
    cgst,
    sgst,
    roundOff: 0,
    tendered: 10000,
    cancelledAt: null,
    gstMode: settings.gstMode,
    pricesIncludeGst: true,
    lines: billLines
  }
}
