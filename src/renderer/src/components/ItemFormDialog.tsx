import { type ChangeEvent, type SubmitEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatQty, paiseToInput, parseMoney, parseQty } from '@shared/format'
import type { Item, ItemInput } from '@shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../AppContext'
import { Modal } from './Modal'
import { useToast } from './Toast'

const UNITS = ['pcs', 'plate', 'cup', 'glass', 'pkt', 'bottle', 'kg', 'g', 'l', 'ml', 'box', 'dozen']
const GST_RATES = [0, 5, 18, 40]

interface FormState {
  name: string
  barcode: string
  category: string
  unit: string
  salePrice: string
  costPrice: string
  gstRate: string
  hsn: string
  openingStock: string
  lowStock: string
  trackStock: boolean
  quick: boolean
  active: boolean
}

function formFromItem(item: Item): FormState {
  return {
    name: item.name,
    barcode: item.barcode ?? '',
    category: item.category,
    unit: item.unit,
    salePrice: paiseToInput(item.salePrice),
    costPrice: item.costPrice ? paiseToInput(item.costPrice) : '',
    gstRate: String(item.gstRate),
    hsn: item.hsn,
    openingStock: '',
    lowStock: item.lowStock ? formatQty(item.lowStock) : '',
    trackStock: item.trackStock,
    quick: item.quick,
    active: item.active
  }
}

function blankForm(barcode: string, gstRate: number): FormState {
  return {
    name: '',
    barcode,
    category: '',
    unit: 'pcs',
    salePrice: '',
    costPrice: '',
    gstRate: String(gstRate),
    hsn: '',
    openingStock: '',
    lowStock: '',
    trackStock: true,
    quick: false,
    active: true
  }
}

function toInput(form: FormState, id: number | undefined): ItemInput {
  const salePrice = parseMoney(form.salePrice)
  if (!form.name.trim()) throw new Error('Enter the item name')
  if (salePrice === null || salePrice < 0) throw new Error('Enter the sale price')
  const costPrice = form.costPrice.trim() ? parseMoney(form.costPrice) : 0
  if (costPrice === null || costPrice < 0) throw new Error('Cost price is not a valid amount')
  const gstRate = Number(form.gstRate || 0)
  if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error('GST % must be between 0 and 100')
  const openingStock = form.openingStock.trim() ? parseQty(form.openingStock) : 0
  if (openingStock === null) throw new Error('Opening stock is not a valid number')
  const lowStock = form.lowStock.trim() ? parseQty(form.lowStock) : 0
  if (lowStock === null || lowStock < 0) throw new Error('Low stock level is not a valid number')
  return {
    id,
    name: form.name.trim(),
    barcode: form.barcode.trim() || null,
    category: form.category.trim(),
    unit: form.unit.trim() || 'pcs',
    salePrice,
    costPrice,
    gstRate,
    hsn: form.hsn.trim(),
    openingStock,
    lowStock,
    trackStock: form.trackStock,
    quick: form.quick,
    active: form.active
  }
}

interface ItemFormDialogProps {
  /** Item to edit; leave out to create a new one. */
  item?: Item | null
  /** Pre-filled barcode, e.g. an unknown barcode that was just scanned. */
  initialBarcode?: string
  /** Stock In adds the quantity itself, so it hides the opening stock field. */
  hideOpeningStock?: boolean
  onSaved: (item: Item) => void
  onClose: () => void
}

export function ItemFormDialog({ item, initialBarcode, hideOpeningStock, onSaved, onClose }: ItemFormDialogProps) {
  const { settings } = useApp()
  const toast = useToast()
  const editing = Boolean(item)
  const canAddAnother = !editing && !initialBarcode
  const [form, setForm] = useState<FormState>(() =>
    item ? formFromItem(item) : blankForm(initialBarcode ?? '', settings.defaultGstRate)
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const barcodeRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Focus before the next key press arrives, so fast typing never lands behind the dialog.
  useLayoutEffect(() => {
    ;(editing || initialBarcode ? nameRef : barcodeRef).current?.focus()
  }, [editing, initialBarcode])

  useEffect(() => {
    api.items.categories().then(setCategories, () => {})
  }, [])

  const field =
    (key: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement>): void =>
      setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save(addAnother: boolean): Promise<void> {
    setError(null)
    let input: ItemInput
    try {
      input = toInput(form, item?.id)
    } catch (err) {
      setError(errorMessage(err))
      return
    }
    setSaving(true)
    try {
      const saved = await api.items.save(input)
      onSaved(saved)
      if (!addAnother) {
        onClose()
        return
      }
      toast(`Saved ${saved.name}`, 'success')
      setForm((f) => ({
        ...blankForm('', settings.defaultGstRate),
        category: f.category,
        unit: f.unit,
        gstRate: f.gstRate,
        trackStock: f.trackStock
      }))
      barcodeRef.current?.focus()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault()
    void save(false)
  }

  return (
    <Modal
      title={editing ? `Edit item` : 'New item'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {canAddAnother && (
            <button type="button" className="btn" disabled={saving} onClick={() => void save(true)}>
              Save &amp; add another
            </button>
          )}
          <button type="submit" form="item-form" className="btn primary" disabled={saving}>
            Save (Enter)
          </button>
        </>
      }
    >
      <form id="item-form" className="form-grid" onSubmit={onSubmit}>
        <label>
          Barcode
          <input
            ref={barcodeRef}
            value={form.barcode}
            onChange={field('barcode')}
            onKeyDown={(e) => {
              // The scanner presses Enter after the code: move on instead of saving.
              if (e.key === 'Enter') {
                e.preventDefault()
                nameRef.current?.focus()
              }
            }}
            placeholder="Scan here (leave empty for loose items)"
            className="mono"
            autoComplete="off"
          />
        </label>
        <label>
          Item name *
          <input ref={nameRef} value={form.name} onChange={field('name')} placeholder="e.g. Lays Classic 50g" />
        </label>
        <label>
          Sale price (₹) *
          <input value={form.salePrice} onChange={field('salePrice')} inputMode="decimal" placeholder="0.00" />
        </label>
        <label>
          GST %
          <div className="input-with-chips">
            <input value={form.gstRate} onChange={field('gstRate')} inputMode="decimal" />
            {GST_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                tabIndex={-1}
                className={`chip ${Number(form.gstRate) === rate ? 'on' : ''}`}
                onClick={() => setForm((f) => ({ ...f, gstRate: String(rate) }))}
              >
                {rate}%
              </button>
            ))}
          </div>
        </label>
        <label>
          Category
          <input value={form.category} onChange={field('category')} list="item-categories" placeholder="e.g. Snacks" />
          <datalist id="item-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Unit
          <input value={form.unit} onChange={field('unit')} list="item-units" />
          <datalist id="item-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        <label>
          Cost price (₹)
          <input value={form.costPrice} onChange={field('costPrice')} inputMode="decimal" placeholder="Buying price" />
        </label>
        <label>
          HSN code
          <input value={form.hsn} onChange={field('hsn')} placeholder="Optional" />
        </label>
        <label className="check span-2">
          <input type="checkbox" checked={form.trackStock} onChange={field('trackStock')} />
          Track stock for this item (untick for tea, samosa and other things made in the canteen)
        </label>
        {form.trackStock && (
          <>
            {editing ? (
              <div className="form-note">
                Current stock: <b>{formatQty(item?.stock ?? 0)} {item?.unit}</b>
                <span className="muted">Change it with Stock In or Adjust stock.</span>
              </div>
            ) : hideOpeningStock ? (
              <div />
            ) : (
              <label>
                Opening stock
                <input value={form.openingStock} onChange={field('openingStock')} inputMode="decimal" placeholder="0" />
              </label>
            )}
            <label>
              Low stock alert at
              <input value={form.lowStock} onChange={field('lowStock')} inputMode="decimal" placeholder="0" />
            </label>
          </>
        )}
        <label className="check span-2">
          <input type="checkbox" checked={form.quick} onChange={field('quick')} />
          Show as a quick button on the billing screen (good for tea, samosa, loose items)
        </label>
        {editing && (
          <label className="check span-2">
            <input type="checkbox" checked={form.active} onChange={field('active')} />
            Active (untick to hide this item from billing)
          </label>
        )}
        {error && <div className="form-error span-2">{error}</div>}
      </form>
    </Modal>
  )
}
