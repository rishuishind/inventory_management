import { ScanBarcode } from 'lucide-react'
import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from 'react'
import { looksLikeBarcode, parseScanInput } from '@shared/billing'
import { formatQty, formatRupees } from '@shared/format'
import type { Item } from '@shared/types'
import { api, errorMessage } from '../api'
import { useToast } from './Toast'

interface ItemSearchProps {
  onPick: (item: Item, qty: number) => void
  /** A barcode (digits) that matches no item: offer to create it. */
  onUnknown: (code: string, qty: number) => void
  /** Typed text that matches no item. */
  onNotFound: (term: string) => void
  /** Keys pressed while the box is empty, e.g. +/- on the billing screen. Return true if handled. */
  onEmptyKey?: (e: KeyboardEvent<HTMLInputElement>) => boolean
  inputRef?: Ref<HTMLInputElement>
  placeholder?: string
  autoFocus?: boolean
}

/**
 * The scan box. A USB barcode scanner "types" the digits and presses Enter, so scanning and
 * typing a name use the same input. While typing a name, matching items drop down below.
 */
export function ItemSearch({
  onPick,
  onUnknown,
  onNotFound,
  onEmptyKey,
  inputRef,
  placeholder = 'Scan barcode or type item name…',
  autoFocus
}: ItemSearchProps) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [results, setResults] = useState<{ term: string; items: Item[] }>({ term: '', items: [] })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const request = useRef(0)
  // Scans are handled one after another, in order, even if the next scan arrives mid-lookup.
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function closeList(): void {
    window.clearTimeout(timer.current)
    request.current++
    setOpen(false)
  }

  function onChange(value: string): void {
    setText(value)
    window.clearTimeout(timer.current)
    const { term } = parseScanInput(value)
    if (term.length < 2) {
      request.current++
      setOpen(false)
      return
    }
    timer.current = window.setTimeout(async () => {
      const id = ++request.current
      try {
        const items = await api.items.search(term, 8)
        if (id !== request.current) return
        setResults({ term, items })
        setActive(0)
        setOpen(items.length > 0)
      } catch {
        // Typing again will retry.
      }
    }, 120)
  }

  function submit(value: string): void {
    const { qty, term } = parseScanInput(value)
    // Only use the highlighted suggestion if it belongs to what is in the box right now.
    const highlighted = open && results.term === term ? results.items[active] : undefined
    setText('')
    closeList()
    if (!term) return
    queue.current = queue.current.then(async () => {
      try {
        const exact = await api.items.lookup(term)
        if (exact) return onPick(exact, qty)
        if (highlighted) return onPick(highlighted, qty)
        if (looksLikeBarcode(term)) return onUnknown(term, qty)
        const [best] = await api.items.search(term, 1)
        if (best) return onPick(best, qty)
        onNotFound(term)
      } catch (err) {
        toast(errorMessage(err), 'error')
      }
    })
  }

  function pickFromList(item: Item): void {
    const { qty } = parseScanInput(text)
    setText('')
    closeList()
    onPick(item, qty)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const last = results.items.length - 1
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, last) : Math.max(a - 1, 0)))
      return
    }
    // Some scanners end with Tab instead of Enter. Read the live value: a fast scanner can
    // press Enter before React has re-rendered with the last digit.
    const value = e.currentTarget.value
    if (e.key === 'Enter' || (e.key === 'Tab' && value.trim())) {
      e.preventDefault()
      submit(value)
      return
    }
    if (e.key === 'Escape' && (text || open)) {
      e.preventDefault()
      setText('')
      closeList()
      return
    }
    if (!text && onEmptyKey?.(e)) e.preventDefault()
  }

  return (
    <div className="item-search">
      <ScanBarcode className="item-search-icon" size={24} aria-hidden />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-label="Scan barcode or search item"
      />
      {open && (
        <ul className="item-search-results" role="listbox">
          {results.items.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                pickFromList(item)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="name">{item.name}</span>
              <span className="muted mono">{item.barcode ?? ''}</span>
              {item.trackStock ? (
                <span className={`stock ${item.stock <= 0 ? 'out' : item.stock <= item.lowStock ? 'low' : ''}`}>
                  {formatQty(item.stock)} {item.unit}
                </span>
              ) : (
                <span className="stock">{item.unit}</span>
              )}
              <span className="price">{formatRupees(item.salePrice)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
