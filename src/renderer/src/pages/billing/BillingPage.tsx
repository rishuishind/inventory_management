import { Minus, Percent, Plus, Printer, ShoppingCart, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeBill } from '@shared/billing'
import { formatMoney, formatQty, formatRupees, parseQty, plural } from '@shared/format'
import type { Bill, Item } from '@shared/types'
import { api, errorMessage } from '../../api'
import { useApp } from '../../AppContext'
import { useConfirm } from '../../components/Confirm'
import { ItemFormDialog } from '../../components/ItemFormDialog'
import { ItemSearch } from '../../components/ItemSearch'
import { isModalOpen } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { beep } from '../../lib/beep'
import { DiscountDialog } from './DiscountDialog'
import { PaymentDialog } from './PaymentDialog'
import { useCart } from './useCart'

type Dialog = { type: 'pay' } | { type: 'discount' } | { type: 'newItem'; barcode: string; qty: number } | null

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export function BillingPage() {
  const { settings, today, refreshToday } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const cart = useCart()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [quick, setQuick] = useState<Item[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const flashRowRef = useRef<HTMLTableRowElement>(null)

  const calc = useMemo(
    () =>
      computeBill(
        cart.lines.map((l) => ({ price: l.price, qty: l.qty, gstRate: l.gstRate })),
        {
          gstMode: settings.gstMode,
          pricesIncludeGst: settings.pricesIncludeGst,
          roundOff: settings.roundOff,
          discount: cart.discount
        }
      ),
    [cart.lines, cart.discount, settings.gstMode, settings.pricesIncludeGst, settings.roundOff]
  )
  const totalQty = cart.lines.reduce((a, l) => a + l.qty, 0)

  const focusSearch = useCallback(() => {
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  const loadQuick = useCallback(() => {
    api.items.quick().then(setQuick, () => {})
  }, [])

  useEffect(loadQuick, [loadQuick])

  useEffect(() => {
    flashRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [cart.flash])

  // Coming back from a receipt preview or another app: straight back to the scan box.
  useEffect(() => {
    const onFocus = (): void => {
      if (!isModalOpen()) focusSearch()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [focusSearch])

  function closeDialog(): void {
    setDialog(null)
    focusSearch()
  }

  function addItem(item: Item, qty: number): void {
    cart.add(item, qty)
    if (settings.beep) beep('ok')
  }

  function onUnknown(barcode: string, qty: number): void {
    if (settings.beep) beep('error')
    setDialog({ type: 'newItem', barcode, qty })
  }

  function onNotFound(term: string): void {
    if (settings.beep) beep('error')
    toast(`No item matches "${term}"`, 'error')
  }

  function openPay(): void {
    if (cart.lines.length === 0) {
      toast('Scan an item first')
      return
    }
    setDialog({ type: 'pay' })
  }

  function openDiscount(): void {
    if (cart.lines.length > 0) setDialog({ type: 'discount' })
  }

  async function printBill(id: number): Promise<void> {
    try {
      const result = await api.bills.print(id)
      if (result.mode === 'printed') toast('Receipt sent to printer')
    } catch (err) {
      toast(`Printing failed: ${errorMessage(err)}. You can reprint it from Bills.`, 'error')
    }
  }

  async function reprintLast(): Promise<void> {
    const last = await api.bills.last()
    if (!last) toast('No bills yet')
    else await printBill(last.id)
    focusSearch()
  }

  function onPaid(bill: Bill, print: boolean): void {
    setDialog(null)
    cart.clear()
    refreshToday()
    toast(`Bill ${bill.billNo} saved · ${formatRupees(bill.total)}`, 'success')
    if (print) void printBill(bill.id)
    focusSearch()
  }

  async function clearBill(): Promise<void> {
    if (cart.lines.length === 0) return
    const ok = await confirm({
      title: 'Clear this bill?',
      message: 'All items on the current bill will be removed.',
      confirmText: 'Clear bill',
      danger: true
    })
    if (ok) cart.clear()
    focusSearch()
  }

  /** Shortcuts while the scan box is empty. */
  function onEmptyKey(e: KeyboardEvent<HTMLInputElement>): boolean {
    const i = cart.selected
    switch (e.key) {
      case '+':
      case '=':
        if (i >= 0) cart.inc(i, 1)
        return true
      case '-':
        if (i >= 0) cart.inc(i, -1)
        return true
      case 'Delete':
        if (i >= 0) cart.remove(i)
        return true
      case 'ArrowUp':
        cart.select(i - 1)
        return true
      case 'ArrowDown':
        cart.select(i + 1)
        return true
      default:
        return false
    }
  }

  // Page shortcuts, and typing anywhere on the page goes into the scan box.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (isModalOpen()) return
      if (e.key === 'F12') {
        e.preventDefault()
        openPay()
      } else if (e.key === 'F8') {
        e.preventDefault()
        openDiscount()
      } else if (e.key === 'F9') {
        e.preventDefault()
        void reprintLast()
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="billing">
      <div className="billing-main">
        <ItemSearch
          inputRef={searchRef}
          onPick={addItem}
          onUnknown={onUnknown}
          onNotFound={onNotFound}
          onEmptyKey={onEmptyKey}
          autoFocus
        />

        <section className="panel cart">
          {cart.lines.length === 0 ? (
            <div className="empty">
              <ShoppingCart size={48} strokeWidth={1.4} />
              <p>Scan a barcode or type an item name to start a bill.</p>
              <p className="muted">
                Tip: type <kbd>3*</kbd> before scanning to add 3 at once.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table cart-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Item</th>
                    <th className="num">Rate</th>
                    <th className="qty-col">Qty</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.lines.map((line, i) => {
                    const flashing = cart.flash?.itemId === line.itemId
                    return (
                      <tr
                        key={flashing ? `${line.itemId}-${cart.flash?.n}` : line.itemId}
                        ref={flashing ? flashRowRef : undefined}
                        className={`${i === cart.selected ? 'selected' : ''} ${flashing ? 'flash' : ''}`}
                        onClick={() => cart.select(i)}
                      >
                        <td className="num muted">{i + 1}</td>
                        <td>
                          <div className="line-name">{line.name}</div>
                          <div className="line-meta">
                            {line.barcode && <span className="mono">{line.barcode}</span>}
                            {line.trackStock !== false && line.qty > line.stock && (
                              <span className="badge low">
                                {line.stock > 0 ? `Only ${formatQty(line.stock)} in stock` : 'Out of stock'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="num">{formatMoney(line.price)}</td>
                        <td className="qty-col">
                          <QtyStepper
                            qty={line.qty}
                            unit={line.unit}
                            onChange={(qty) => cart.setQty(i, qty)}
                            onDone={focusSearch}
                          />
                        </td>
                        <td className="num strong">{formatMoney(calc.lines[i]?.amount ?? 0)}</td>
                        <td className="actions">
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Remove (Delete)"
                            onClick={(e) => {
                              e.stopPropagation()
                              cart.remove(i)
                              focusSearch()
                            }}
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {quick.length > 0 && (
          <section className="quick-bar" aria-label="Quick items">
            {quick.map((item) => (
              <button
                key={item.id}
                type="button"
                className="quick-btn"
                onClick={() => {
                  addItem(item, 1)
                  focusSearch()
                }}
              >
                <span>{item.name}</span>
                <small>{formatRupees(item.salePrice)}</small>
              </button>
            ))}
          </section>
        )}
      </div>

      <aside className="panel totals">
        <div className="totals-counts">
          <span>
            Items <b>{cart.lines.length}</b>
          </span>
          <span>
            Qty <b>{formatQty(totalQty)}</b>
          </span>
        </div>
        <dl className="totals-list">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(calc.subtotal)}</dd>
          </div>
          {calc.discount > 0 && (
            <div>
              <dt>Discount</dt>
              <dd>-{formatMoney(calc.discount)}</dd>
            </div>
          )}
          {settings.gstMode === 'regular' && calc.tax > 0 && (
            <div>
              <dt>{settings.pricesIncludeGst ? 'GST (included)' : 'GST'}</dt>
              <dd>{formatMoney(calc.tax)}</dd>
            </div>
          )}
          {calc.roundOff !== 0 && (
            <div>
              <dt>Round off</dt>
              <dd>
                {calc.roundOff < 0 ? '-' : '+'}
                {formatMoney(Math.abs(calc.roundOff))}
              </dd>
            </div>
          )}
        </dl>
        <div className="grand-total">
          <span>Total</span>
          <strong data-testid="bill-total">₹{formatMoney(calc.total)}</strong>
        </div>
        <button type="button" className="btn success xl" onClick={openPay} disabled={cart.lines.length === 0}>
          Pay <kbd>F12</kbd>
        </button>
        <div className="totals-actions">
          <button type="button" className="btn" onClick={openDiscount} disabled={cart.lines.length === 0}>
            <Percent size={16} /> Discount <kbd>F8</kbd>
          </button>
          <button type="button" className="btn" onClick={() => void reprintLast()}>
            <Printer size={16} /> Reprint <kbd>F9</kbd>
          </button>
          <button
            type="button"
            className="btn danger-outline"
            onClick={() => void clearBill()}
            disabled={cart.lines.length === 0}
          >
            <Trash2 size={16} /> Clear bill
          </button>
        </div>
        <ul className="hints">
          <li>
            <kbd>+</kbd> <kbd>−</kbd> change quantity of the selected line
          </li>
          <li>
            <kbd>↑</kbd> <kbd>↓</kbd> select line · <kbd>Del</kbd> remove it
          </li>
        </ul>
        <div className="today-stats">
          Today: <b>{plural(today.bills, 'bill')}</b> · <b>{formatRupees(today.total)}</b>
        </div>
      </aside>

      {dialog?.type === 'pay' && (
        <PaymentDialog
          lines={cart.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price }))}
          discount={cart.discount}
          total={calc.total}
          onPaid={onPaid}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'discount' && (
        <DiscountDialog
          subtotal={calc.subtotal}
          current={cart.discount}
          onApply={(amount) => {
            cart.setDiscount(amount)
            closeDialog()
          }}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'newItem' && (
        <ItemFormDialog
          initialBarcode={dialog.barcode}
          onSaved={(item) => {
            addItem(item, dialog.qty)
            if (item.quick) loadQuick()
          }}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}

interface QtyStepperProps {
  qty: number
  unit: string
  onChange: (qty: number) => void
  onDone: () => void
}

function QtyStepper({ qty, unit, onChange, onDone }: QtyStepperProps) {
  // null = not editing, show the cart quantity.
  const [text, setText] = useState<string | null>(null)
  const cancelled = useRef(false)

  function commit(): void {
    if (text === null) return
    const value = parseQty(text)
    if (value !== null && !cancelled.current) onChange(value)
    cancelled.current = false
    setText(null)
  }

  return (
    <div className="stepper" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="step" aria-label="Less" onClick={() => onChange(qty - 1)} tabIndex={-1}>
        <Minus size={16} />
      </button>
      <input
        value={text ?? formatQty(qty)}
        onFocus={(e) => {
          setText(formatQty(qty))
          e.currentTarget.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            cancelled.current = e.key === 'Escape'
            e.currentTarget.blur()
            onDone()
          }
        }}
        inputMode="decimal"
        aria-label="Quantity"
      />
      <button type="button" className="step" aria-label="More" onClick={() => onChange(qty + 1)} tabIndex={-1}>
        <Plus size={16} />
      </button>
      {unit !== 'pcs' && <span className="unit">{unit}</span>}
    </div>
  )
}
