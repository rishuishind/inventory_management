import { Download, History, PackagePlus, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatMoney, formatQty, plural } from '@shared/format'
import type { Item, ItemFilter, ItemList } from '@shared/types'
import { api, errorMessage } from '../../api'
import { useConfirm } from '../../components/Confirm'
import { ItemFormDialog } from '../../components/ItemFormDialog'
import { isModalOpen } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { exportSheets, rupees } from '../../lib/excel'
import { AdjustStockDialog } from './AdjustStockDialog'
import { HistoryDialog } from './HistoryDialog'
import { ImportDialog } from './ImportDialog'

const FILTERS: { id: ItemFilter; label: string }[] = [
  { id: 'all', label: 'All items' },
  { id: 'low', label: 'Low stock' },
  { id: 'out', label: 'Out of stock' },
  { id: 'quick', label: 'Quick buttons' },
  { id: 'inactive', label: 'Hidden' }
]

const PAGE = 200

type Dialog =
  | { type: 'form'; item: Item | null }
  | { type: 'adjust'; item: Item }
  | { type: 'history'; item: Item }
  | { type: 'import' }
  | null

function stockClass(item: Item): string {
  if (item.stock <= 0) return 'badge out'
  if (item.stock <= item.lowStock) return 'badge low'
  return 'badge ok'
}

export function ItemsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<ItemFilter>('all')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [data, setData] = useState<ItemList>({ rows: [], total: 0 })
  const [dialog, setDialog] = useState<Dialog>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.items.list({ q, filter, category, limit }))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [q, filter, category, limit, toast])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 150)
    return () => window.clearTimeout(t)
  }, [load])

  useEffect(() => {
    api.items.categories().then(setCategories, () => {})
  }, [data])

  // Ctrl+N: new item, from anywhere on this page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isModalOpen() && e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setDialog({ type: 'form', item: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function closeDialog(): void {
    setDialog(null)
    searchRef.current?.focus()
  }

  async function remove(item: Item): Promise<void> {
    const ok = await confirm({
      title: 'Delete item?',
      message: (
        <>
          Delete <b>{item.name}</b>? If it has been sold or purchased before, it will be hidden instead so old bills
          stay correct.
        </>
      ),
      confirmText: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      const { deleted } = await api.items.remove(item.id)
      toast(deleted ? `Deleted ${item.name}` : `${item.name} has history, so it was hidden. See the Hidden filter.`, 'success')
      void load()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  async function exportItems(): Promise<void> {
    const all = await api.items.list({ q, filter, category, limit: 100000 })
    const rows = [
      ['Item name', 'Barcode', 'Category', 'Unit', 'Sale price', 'Cost price', 'GST %', 'HSN', 'Stock', 'Low stock alert'],
      ...all.rows.map((i) => [
        i.name,
        i.barcode ?? '',
        i.category,
        i.unit,
        rupees(i.salePrice),
        rupees(i.costPrice),
        i.gstRate,
        i.hsn,
        i.stock,
        i.lowStock
      ])
    ]
    await exportSheets('Items', [{ name: 'Items', rows }], toast)
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Items</h1>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setDialog({ type: 'import' })}>
            <Upload size={16} /> Import from Excel
          </button>
          <button type="button" className="btn" onClick={() => void exportItems()}>
            <Download size={16} /> Export
          </button>
          <button type="button" className="btn primary" onClick={() => setDialog({ type: 'form', item: null })}>
            <Plus size={16} /> New item <kbd>Ctrl+N</kbd>
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} aria-hidden />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setLimit(PAGE)
            }}
            onKeyDown={(e) => {
              // Scanning a barcode here opens that item straight away.
              if (e.key === 'Enter' && data.rows.length === 1) setDialog({ type: 'form', item: data.rows[0] })
            }}
            placeholder="Search by name or scan barcode"
            autoFocus
          />
        </div>
        <div className="segmented">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? 'on' : ''}
              onClick={() => {
                setFilter(f.id)
                setLimit(PAGE)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <section className="panel grow">
        {data.rows.length === 0 ? (
          <div className="empty">
            <PackagePlus size={44} strokeWidth={1.4} />
            <p>{q || filter !== 'all' || category ? 'No items match.' : 'No items yet.'}</p>
            {!q && filter === 'all' && !category && (
              <p className="muted">Add items one by one with “New item”, or import your list from Excel.</p>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="num">Sale price</th>
                  <th className="num">GST</th>
                  <th className="num">Stock</th>
                  <th className="actions-col" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((item) => (
                  <tr key={item.id} onDoubleClick={() => setDialog({ type: 'form', item })}>
                    <td>
                      <div className="line-name">
                        {item.name}
                        {item.quick && <span className="badge info">Quick</span>}
                      </div>
                      <div className="line-meta mono">{item.barcode ?? 'No barcode'}</div>
                    </td>
                    <td>{item.category}</td>
                    <td className="num">{formatMoney(item.salePrice)}</td>
                    <td className="num">{item.gstRate}%</td>
                    <td className="num">
                      {item.trackStock ? (
                        <span className={stockClass(item)}>
                          {formatQty(item.stock)} {item.unit}
                        </span>
                      ) : (
                        <span className="muted small">Not tracked</span>
                      )}
                    </td>
                    <td className="actions">
                      <button type="button" className="btn sm" onClick={() => setDialog({ type: 'form', item })}>
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={!item.trackStock}
                        onClick={() => setDialog({ type: 'adjust', item })}
                      >
                        ± Stock
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Stock history"
                        onClick={() => setDialog({ type: 'history', item })}
                      >
                        <History size={17} />
                      </button>
                      <button type="button" className="icon-btn danger" title="Delete" onClick={() => void remove(item)}>
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.total > data.rows.length && (
              <div className="load-more">
                Showing {data.rows.length} of {data.total}.{' '}
                <button type="button" className="link" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <footer className="page-foot muted">{plural(data.total, 'item')}</footer>

      {dialog?.type === 'form' && (
        <ItemFormDialog item={dialog.item} onSaved={() => void load()} onClose={closeDialog} />
      )}
      {dialog?.type === 'adjust' && (
        <AdjustStockDialog
          item={dialog.item}
          onDone={(item) => {
            toast(`${item.name}: stock is now ${formatQty(item.stock)}`, 'success')
            closeDialog()
            void load()
          }}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'history' && <HistoryDialog item={dialog.item} onClose={closeDialog} />}
      {dialog?.type === 'import' && <ImportDialog onImported={() => void load()} onClose={closeDialog} />}
    </div>
  )
}
