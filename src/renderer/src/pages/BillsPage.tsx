import { Ban, Printer, ReceiptText, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { displayDate, formatMoney, formatQty, plural } from '@shared/format'
import type { Bill, BillSummary, DateRange } from '@shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../AppContext'
import { useConfirm } from '../components/Confirm'
import { DateRangePicker } from '../components/DateRangePicker'
import { useToast } from '../components/Toast'
import { todayRange } from '../lib/dates'

const MODE_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card' }

export function BillsPage() {
  const { refreshToday } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [range, setRange] = useState<DateRange>(todayRange)
  const [q, setQ] = useState('')
  const [bills, setBills] = useState<BillSummary[]>([])
  const [selected, setSelected] = useState<Bill | null>(null)

  const load = useCallback(async () => {
    try {
      setBills(await api.bills.list(range, q))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [range, q, toast])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 150)
    return () => window.clearTimeout(t)
  }, [load])

  async function open(id: number): Promise<void> {
    try {
      setSelected(await api.bills.get(id))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  async function print(bill: Bill): Promise<void> {
    try {
      const result = await api.bills.print(bill.id)
      if (result.mode === 'printed') toast('Receipt sent to printer')
    } catch (err) {
      toast(`Printing failed: ${errorMessage(err)}`, 'error')
    }
  }

  async function cancel(bill: Bill): Promise<void> {
    const ok = await confirm({
      title: `Cancel bill ${bill.billNo}?`,
      message: (
        <>
          The bill stays in the records marked <b>Cancelled</b>, is removed from sales totals, and its items go back
          into stock. This cannot be undone.
        </>
      ),
      confirmText: 'Cancel bill',
      danger: true
    })
    if (!ok) return
    try {
      setSelected(await api.bills.cancel(bill.id))
      toast(`Bill ${bill.billNo} cancelled`, 'success')
      refreshToday()
      void load()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const paid = bills.filter((b) => b.status === 'paid')
  const paidTotal = paid.reduce((a, b) => a + b.total, 0)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Bills</h1>
      </header>
      <div className="toolbar">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="search-box">
          <Search size={18} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find bill number (any date)" />
        </div>
        <div className="toolbar-summary">
          <b>{plural(paid.length, 'bill')}</b> · <b>₹{formatMoney(paidTotal)}</b>
          {bills.length > paid.length && <span className="muted"> · {bills.length - paid.length} cancelled</span>}
        </div>
      </div>

      <div className="split">
        <section className="panel grow">
          {bills.length === 0 ? (
            <div className="empty">
              <ReceiptText size={44} strokeWidth={1.4} />
              <p>No bills {q ? 'match that number' : 'in this period'}.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table clickable">
                <thead>
                  <tr>
                    <th>Bill no.</th>
                    <th>Date</th>
                    <th className="num">Items</th>
                    <th>Paid by</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr
                      key={b.id}
                      className={`${selected?.id === b.id ? 'selected' : ''} ${b.status === 'cancelled' ? 'cancelled' : ''}`}
                      onClick={() => void open(b.id)}
                    >
                      <td className="mono strong nowrap">{b.billNo}</td>
                      <td className="nowrap">{displayDate(b.createdAt)}</td>
                      <td className="num">{b.itemCount}</td>
                      <td>
                        {b.status === 'cancelled' ? <span className="badge out">Cancelled</span> : MODE_LABELS[b.paymentMode]}
                      </td>
                      <td className="num strong">{formatMoney(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel bill-detail">
          {!selected ? (
            <div className="empty">
              <p className="muted">Select a bill to see its details.</p>
            </div>
          ) : (
            <BillDetail bill={selected} onPrint={() => void print(selected)} onCancel={() => void cancel(selected)} />
          )}
        </aside>
      </div>
    </div>
  )
}

function BillDetail({ bill, onPrint, onCancel }: { bill: Bill; onPrint: () => void; onCancel: () => void }) {
  const tax = bill.cgst + bill.sgst
  return (
    <div className="stack">
      <div className="bill-detail-head">
        <div>
          <h2 className="mono">{bill.billNo}</h2>
          <div className="muted">{displayDate(bill.createdAt)}</div>
        </div>
        {bill.status === 'cancelled' ? (
          <span className="badge out">Cancelled {bill.cancelledAt ? displayDate(bill.cancelledAt) : ''}</span>
        ) : (
          <span className="badge ok">Paid · {MODE_LABELS[bill.paymentMode]}</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Rate</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td className="num">{formatQty(l.qty)}</td>
                <td className="num">{formatMoney(l.price)}</td>
                <td className="num">{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="totals-list">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatMoney(bill.subtotal)}</dd>
        </div>
        {bill.discount > 0 && (
          <div>
            <dt>Discount</dt>
            <dd>-{formatMoney(bill.discount)}</dd>
          </div>
        )}
        {tax > 0 && (
          <div>
            <dt>{bill.pricesIncludeGst ? 'GST (included)' : 'GST'}</dt>
            <dd>{formatMoney(tax)}</dd>
          </div>
        )}
        {bill.roundOff !== 0 && (
          <div>
            <dt>Round off</dt>
            <dd>{formatMoney(bill.roundOff)}</dd>
          </div>
        )}
        <div className="strong">
          <dt>Total</dt>
          <dd>₹{formatMoney(bill.total)}</dd>
        </div>
        {bill.tendered != null && (
          <div>
            <dt>Cash received / change</dt>
            <dd>
              {formatMoney(bill.tendered)} / {formatMoney(bill.tendered - bill.total)}
            </dd>
          </div>
        )}
      </dl>
      <div className="row-actions">
        <button type="button" className="btn" onClick={onPrint}>
          <Printer size={16} /> Print
        </button>
        {bill.status === 'paid' && (
          <button type="button" className="btn danger-outline" onClick={onCancel}>
            <Ban size={16} /> Cancel bill
          </button>
        )}
      </div>
    </div>
  )
}
