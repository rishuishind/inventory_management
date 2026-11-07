import { PackageOpen, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addDays,
  displayDate,
  formatMoney,
  formatQty,
  paiseToInput,
  parseMoney,
  parseQty,
  plural,
  round3,
  toLocalDate
} from '@shared/format'
import type { Item, Purchase, PurchaseLineInput, PurchaseSummary } from '@shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../AppContext'
import { ItemFormDialog } from '../components/ItemFormDialog'
import { ItemSearch } from '../components/ItemSearch'
import { isModalOpen, Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { beep } from '../lib/beep'

interface StockLine {
  item: Item
  qty: string
  cost: string
  sale: string
}

type Dialog = { type: 'newItem'; barcode: string; qty: number } | { type: 'view'; purchase: Purchase } | null

const lineAmount = (l: StockLine): number => Math.round((parseMoney(l.cost) ?? 0) * (parseQty(l.qty) ?? 0))

export function StockInPage() {
  const { settings } = useApp()
  const toast = useToast()
  const [supplier, setSupplier] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<StockLine[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [recent, setRecent] = useState<PurchaseSummary[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [saving, setSaving] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const loadRecent = useCallback(() => {
    const today = toLocalDate(new Date())
    api.purchases.list({ from: addDays(today, -30), to: today }).then(setRecent, () => {})
    api.purchases.suppliers().then(setSuppliers, () => {})
  }, [])

  useEffect(loadRecent, [loadRecent])

  function focusSearch(): void {
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }

  function add(item: Item, qty: number): void {
    if (settings.beep) beep('ok')
    setLines((ls) => {
      const index = ls.findIndex((l) => l.item.id === item.id)
      if (index >= 0) {
        return ls.map((l, i) => (i === index ? { ...l, qty: formatQty(round3((parseQty(l.qty) ?? 0) + qty)) } : l))
      }
      return [
        ...ls,
        {
          item,
          qty: formatQty(qty),
          cost: item.costPrice ? paiseToInput(item.costPrice) : '',
          sale: paiseToInput(item.salePrice)
        }
      ]
    })
  }

  function update(index: number, patch: Partial<StockLine>): void {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  async function save(): Promise<void> {
    if (saving || lines.length === 0) return
    const input: PurchaseLineInput[] = []
    for (const l of lines) {
      const qty = parseQty(l.qty)
      const cost = l.cost.trim() ? parseMoney(l.cost) : 0
      const sale = l.sale.trim() ? parseMoney(l.sale) : null
      if (qty === null || qty <= 0) return toast(`Enter the quantity for ${l.item.name}`, 'error')
      if (cost === null || cost < 0) return toast(`Cost price of ${l.item.name} is not valid`, 'error')
      if (l.sale.trim() && (sale === null || sale < 0)) return toast(`Sale price of ${l.item.name} is not valid`, 'error')
      input.push({ itemId: l.item.id, qty, costPrice: cost, salePrice: sale ?? undefined })
    }
    setSaving(true)
    try {
      const purchase = await api.purchases.create({ supplier, invoiceNo, note, lines: input })
      toast(`Stock added for ${plural(purchase.itemCount, 'item')}`, 'success')
      setLines([])
      setInvoiceNo('')
      setNote('')
      loadRecent()
      focusSearch()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F12' && !isModalOpen()) {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const total = lines.reduce((a, l) => a + lineAmount(l), 0)

  return (
    <div className="page stockin">
      <header className="page-head">
        <div>
          <h1>Stock In</h1>
          <p className="muted">When goods arrive: scan each item, enter the quantity and buying price, then save.</p>
        </div>
      </header>

      <div className="stockin-grid">
        <div className="stockin-main">
          <div className="form-row">
            <label>
              Supplier
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} list="suppliers" placeholder="Optional" />
              <datalist id="suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <label>
              Supplier bill no.
              <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" />
            </label>
            <label>
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </label>
          </div>

          <ItemSearch
            inputRef={searchRef}
            onPick={add}
            onUnknown={(barcode, qty) => {
              if (settings.beep) beep('error')
              setDialog({ type: 'newItem', barcode, qty })
            }}
            onNotFound={(term) => {
              if (settings.beep) beep('error')
              toast(`No item matches "${term}"`, 'error')
            }}
            placeholder="Scan or search the item that arrived…"
            autoFocus
          />

          <section className="panel grow">
            {lines.length === 0 ? (
              <div className="empty">
                <PackageOpen size={44} strokeWidth={1.4} />
                <p>Scan items to add them. Scanning the same item again adds one more.</p>
                <p className="muted">New barcode? You can create the item right here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">In stock</th>
                      <th className="num">Qty arrived</th>
                      <th className="num">Buying price ₹</th>
                      <th className="num">Selling price ₹</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.item.id}>
                        <td>
                          <div className="line-name">{l.item.name}</div>
                          <div className="line-meta mono">{l.item.barcode ?? ''}</div>
                        </td>
                        <td className="num muted">
                          {formatQty(l.item.stock)} {l.item.unit}
                        </td>
                        <td className="num">
                          <input className="cell-input" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} inputMode="decimal" aria-label="Quantity" />
                        </td>
                        <td className="num">
                          <input className="cell-input" value={l.cost} onChange={(e) => update(i, { cost: e.target.value })} inputMode="decimal" placeholder="0" aria-label="Buying price" />
                        </td>
                        <td className="num">
                          <input className="cell-input" value={l.sale} onChange={(e) => update(i, { sale: e.target.value })} inputMode="decimal" aria-label="Selling price" />
                        </td>
                        <td className="num strong">{formatMoney(lineAmount(l))}</td>
                        <td className="actions">
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Remove"
                            onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                          >
                            <Trash2 size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="stockin-foot">
            <span>
              Items <b>{lines.length}</b>
            </span>
            <span>
              Total cost <b>₹{formatMoney(total)}</b>
            </span>
            <button type="button" className="btn success lg" disabled={saving || lines.length === 0} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save stock'} <kbd>F12</kbd>
            </button>
          </footer>
        </div>

        <aside className="panel recent">
          <h2>Last 30 days</h2>
          {recent.length === 0 ? (
            <p className="muted">No stock entries yet.</p>
          ) : (
            <ul className="recent-list">
              {recent.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() =>
                      api.purchases.get(p.id).then(
                        (purchase) => purchase && setDialog({ type: 'view', purchase }),
                        (err: unknown) => toast(errorMessage(err), 'error')
                      )
                    }
                  >
                    <span className="recent-title">{p.supplier || 'No supplier'}</span>
                    <span className="muted">
                      {displayDate(p.createdAt)} · {plural(p.itemCount, 'item')}
                    </span>
                    <span className="recent-amount">₹{formatMoney(p.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {dialog?.type === 'newItem' && (
        <ItemFormDialog
          initialBarcode={dialog.barcode}
          hideOpeningStock
          onSaved={(item) => add(item, dialog.qty)}
          onClose={() => {
            setDialog(null)
            focusSearch()
          }}
        />
      )}
      {dialog?.type === 'view' && <PurchaseDialog purchase={dialog.purchase} onClose={() => setDialog(null)} />}
    </div>
  )
}

function PurchaseDialog({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  return (
    <Modal title={`Stock entry · ${displayDate(purchase.createdAt)}`} onClose={onClose} width={640}>
      <div className="stack">
        <div className="muted">
          {purchase.supplier || 'No supplier'}
          {purchase.invoiceNo && <> · Bill no. {purchase.invoiceNo}</>}
          {purchase.note && <> · {purchase.note}</>}
        </div>
        <div className="table-wrap modal-table">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Buying price</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {purchase.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.name}</td>
                  <td className="num">{formatQty(l.qty)}</td>
                  <td className="num">{formatMoney(l.costPrice)}</td>
                  <td className="num">{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className="num strong">₹{formatMoney(purchase.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Modal>
  )
}
