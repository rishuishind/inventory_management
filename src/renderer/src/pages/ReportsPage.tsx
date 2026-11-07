import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { displayDate, formatMoney, formatQty, plural } from '@shared/format'
import type { DateRange, GstRow, ItemSalesRow, SalesSummary, StockRow } from '@shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../AppContext'
import { DateRangePicker } from '../components/DateRangePicker'
import { useToast } from '../components/Toast'
import { todayRange } from '../lib/dates'
import { exportSheets, rupees } from '../lib/excel'

type Tab = 'summary' | 'items' | 'gst' | 'stock'

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Sales summary' },
  { id: 'items', label: 'Item-wise sales' },
  { id: 'gst', label: 'GST' },
  { id: 'stock', label: 'Stock' }
]

type Data =
  | { tab: 'summary'; summary: SalesSummary }
  | { tab: 'items'; rows: ItemSalesRow[] }
  | { tab: 'gst'; rows: GstRow[] }
  | { tab: 'stock'; rows: StockRow[] }

const period = (r: DateRange): string =>
  r.from === r.to ? displayDate(r.from) : `${displayDate(r.from)} to ${displayDate(r.to)}`

export function ReportsPage() {
  const { settings } = useApp()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('summary')
  const [range, setRange] = useState<DateRange>(todayRange)
  const [data, setData] = useState<Data | null>(null)
  const [lowOnly, setLowOnly] = useState(false)

  useEffect(() => {
    let live = true
    const load = async (): Promise<Data> => {
      switch (tab) {
        case 'summary':
          return { tab, summary: await api.reports.summary(range) }
        case 'items':
          return { tab, rows: await api.reports.itemSales(range) }
        case 'gst':
          return { tab, rows: await api.reports.gst(range) }
        case 'stock':
          return { tab, rows: await api.reports.stock() }
      }
    }
    load().then(
      (d) => live && setData(d),
      (err: unknown) => toast(errorMessage(err), 'error')
    )
    return () => {
      live = false
    }
  }, [tab, range, toast])

  function exportCurrent(): void {
    if (!data) return
    const when = `${range.from}_to_${range.to}`
    switch (data.tab) {
      case 'summary': {
        const s = data.summary
        void exportSheets(`Sales ${when}`, [
          {
            name: 'Summary',
            rows: [
              ['Period', period(range)],
              ['Bills', s.bills],
              ['Net sales', rupees(s.total)],
              ['Cash', rupees(s.cash)],
              ['UPI', rupees(s.upi)],
              ['Card', rupees(s.card)],
              ['Discount given', rupees(s.discount)],
              ['Sales before GST', rupees(s.taxable)],
              ['CGST', rupees(s.cgst)],
              ['SGST', rupees(s.sgst)],
              ['Cost of goods sold', rupees(s.cost)],
              ['Cancelled bills', s.cancelled]
            ]
          },
          {
            name: 'Day-wise',
            rows: [
              ['Date', 'Bills', 'Cash', 'UPI', 'Card', 'Total'],
              ...s.days.map((d) => [displayDate(d.date), d.bills, rupees(d.cash), rupees(d.upi), rupees(d.card), rupees(d.total)])
            ]
          }
        ], toast)
        break
      }
      case 'items':
        void exportSheets(`Item sales ${when}`, [
          {
            name: 'Item sales',
            rows: [
              ['Item', 'Qty sold', 'Unit', 'Sales', 'Sales before GST', 'Cost', 'Profit (approx.)'],
              ...data.rows.map((r) => [r.name, r.qty, r.unit, rupees(r.sales), rupees(r.taxable), rupees(r.cost), rupees(r.taxable - r.cost)])
            ]
          }
        ], toast)
        break
      case 'gst':
        void exportSheets(`GST ${when}`, [
          {
            name: 'GST',
            rows: [
              ['GST rate %', 'Taxable value', 'CGST', 'SGST', 'Total tax'],
              ...data.rows.map((r) => [r.rate, rupees(r.taxable), rupees(r.cgst), rupees(r.sgst), rupees(r.cgst + r.sgst)])
            ]
          }
        ], toast)
        break
      case 'stock':
        void exportSheets('Stock', [
          {
            name: 'Stock',
            rows: [
              ['Item', 'Barcode', 'Category', 'Stock', 'Unit', 'Low stock alert', 'Cost price', 'Stock value'],
              ...data.rows.map((r) => [r.name, r.barcode ?? '', r.category, r.stock, r.unit, r.lowStock, rupees(r.costPrice), rupees(r.stockValue)])
            ]
          }
        ], toast)
        break
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Reports</h1>
        <div className="page-actions">
          <button type="button" className="btn" onClick={exportCurrent} disabled={!data}>
            <Download size={16} /> Export to Excel
          </button>
        </div>
      </header>
      <div className="toolbar">
        <div className="segmented">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab !== 'stock' ? (
          <DateRangePicker value={range} onChange={setRange} />
        ) : (
          <label className="check">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Only low / out of stock
          </label>
        )}
      </div>

      <section className="panel grow report">
        {data?.tab === 'summary' && tab === 'summary' && <SummaryView s={data.summary} />}
        {data?.tab === 'items' && tab === 'items' && <ItemsView rows={data.rows} />}
        {data?.tab === 'gst' && tab === 'gst' && <GstView rows={data.rows} regular={settings.gstMode === 'regular'} />}
        {data?.tab === 'stock' && tab === 'stock' && (
          <StockView rows={lowOnly ? data.rows.filter((r) => r.stock <= r.lowStock) : data.rows} />
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

function SummaryView({ s }: { s: SalesSummary }) {
  const profit = s.taxable - s.cost
  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Net sales" value={`₹${formatMoney(s.total)}`} sub={plural(s.bills, 'bill')} />
        <Stat label="Average bill" value={`₹${formatMoney(s.bills ? Math.round(s.total / s.bills) : 0)}`} />
        <Stat label="Cash" value={`₹${formatMoney(s.cash)}`} />
        <Stat label="UPI" value={`₹${formatMoney(s.upi)}`} />
        <Stat label="Card" value={`₹${formatMoney(s.card)}`} />
        <Stat label="GST collected" value={`₹${formatMoney(s.cgst + s.sgst)}`} sub={`CGST ${formatMoney(s.cgst)} · SGST ${formatMoney(s.sgst)}`} />
        <Stat label="Discount given" value={`₹${formatMoney(s.discount)}`} />
        <Stat label="Profit (approx.)" value={`₹${formatMoney(profit)}`} sub="Sales before GST minus cost price" />
        {s.cancelled > 0 && <Stat label="Cancelled bills" value={String(s.cancelled)} />}
      </div>
      {s.days.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Bills</th>
                <th className="num">Cash</th>
                <th className="num">UPI</th>
                <th className="num">Card</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {s.days.map((d) => (
                <tr key={d.date}>
                  <td>{displayDate(d.date)}</td>
                  <td className="num">{d.bills}</td>
                  <td className="num">{formatMoney(d.cash)}</td>
                  <td className="num">{formatMoney(d.upi)}</td>
                  <td className="num">{formatMoney(d.card)}</td>
                  <td className="num strong">{formatMoney(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ItemsView({ rows }: { rows: ItemSalesRow[] }) {
  if (rows.length === 0) return <p className="empty muted">No sales in this period.</p>
  const sum = (f: (r: ItemSalesRow) => number): number => rows.reduce((a, r) => a + f(r), 0)
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty sold</th>
            <th className="num">Sales</th>
            <th className="num">Cost</th>
            <th className="num">Profit (approx.)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.itemId}-${r.name}`}>
              <td>{r.name}</td>
              <td className="num">
                {formatQty(r.qty)} {r.unit}
              </td>
              <td className="num strong">{formatMoney(r.sales)}</td>
              <td className="num">{formatMoney(r.cost)}</td>
              <td className="num">{formatMoney(r.taxable - r.cost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td />
            <td className="num strong">{formatMoney(sum((r) => r.sales))}</td>
            <td className="num">{formatMoney(sum((r) => r.cost))}</td>
            <td className="num">{formatMoney(sum((r) => r.taxable - r.cost))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function GstView({ rows, regular }: { rows: GstRow[]; regular: boolean }) {
  const sum = (f: (r: GstRow) => number): number => rows.reduce((a, r) => a + f(r), 0)
  return (
    <div className="stack">
      {!regular && (
        <p className="muted">
          Your GST type in Settings is not “Regular”, so new bills do not charge GST. Only bills made under the
          regular scheme appear here.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="empty muted">No GST bills in this period.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>GST rate</th>
                <th className="num">Taxable value</th>
                <th className="num">CGST</th>
                <th className="num">SGST</th>
                <th className="num">Total tax</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rate}>
                  <td>{r.rate}%</td>
                  <td className="num">{formatMoney(r.taxable)}</td>
                  <td className="num">{formatMoney(r.cgst)}</td>
                  <td className="num">{formatMoney(r.sgst)}</td>
                  <td className="num strong">{formatMoney(r.cgst + r.sgst)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{formatMoney(sum((r) => r.taxable))}</td>
                <td className="num">{formatMoney(sum((r) => r.cgst))}</td>
                <td className="num">{formatMoney(sum((r) => r.sgst))}</td>
                <td className="num strong">{formatMoney(sum((r) => r.cgst + r.sgst))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function StockView({ rows }: { rows: StockRow[] }) {
  if (rows.length === 0) return <p className="empty muted">Nothing to show.</p>
  const value = rows.reduce((a, r) => a + r.stockValue, 0)
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th className="num">Stock</th>
            <th className="num">Cost price</th>
            <th className="num">Stock value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.category}</td>
              <td className="num">
                <span className={r.stock <= 0 ? 'badge out' : r.stock <= r.lowStock ? 'badge low' : ''}>
                  {formatQty(r.stock)} {r.unit}
                </span>
              </td>
              <td className="num">{formatMoney(r.costPrice)}</td>
              <td className="num">{formatMoney(r.stockValue)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>Total stock value (at cost)</td>
            <td className="num strong">₹{formatMoney(value)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
