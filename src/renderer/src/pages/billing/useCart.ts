import { useEffect, useMemo, useReducer } from 'react'
import { round3 } from '@shared/format'
import type { Item } from '@shared/types'

export interface CartLine {
  itemId: number
  name: string
  barcode: string | null
  unit: string
  price: number
  gstRate: number
  qty: number
  /** Stock when the item was scanned, to warn when selling more than we have. */
  stock: number
  trackStock: boolean
}

interface CartState {
  lines: CartLine[]
  discount: number
  selected: number
  /** Bumped on every scan so the scanned row flashes, even if it was already on the bill. */
  flash: { itemId: number; n: number } | null
}

type CartAction =
  | { type: 'add'; item: Item; qty: number }
  | { type: 'setQty'; index: number; qty: number }
  | { type: 'inc'; index: number; delta: number }
  | { type: 'remove'; index: number }
  | { type: 'select'; index: number }
  | { type: 'discount'; amount: number }
  | { type: 'clear' }

// The bill in progress survives a crash, a power cut or switching screens.
const STORAGE_KEY = 'canteen.cart.v1'
const EMPTY: CartState = { lines: [], discount: 0, selected: -1, flash: null }

function load(): CartState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<CartState> | null
    if (saved && Array.isArray(saved.lines) && saved.lines.length > 0) {
      return { ...EMPTY, lines: saved.lines, discount: saved.discount ?? 0, selected: saved.lines.length - 1 }
    }
  } catch {
    // Unreadable draft: start a fresh bill.
  }
  return EMPTY
}

function withoutLine(state: CartState, index: number): CartState {
  const lines = state.lines.filter((_, i) => i !== index)
  return { ...state, lines, selected: Math.min(state.selected, lines.length - 1) }
}

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const { item, qty } = action
      const index = state.lines.findIndex((l) => l.itemId === item.id && l.price === item.salePrice)
      const flash = { itemId: item.id, n: (state.flash?.n ?? 0) + 1 }
      if (index >= 0) {
        const lines = state.lines.map((l, i) => (i === index ? { ...l, qty: round3(l.qty + qty), stock: item.stock } : l))
        return { ...state, lines, selected: index, flash }
      }
      const line: CartLine = {
        itemId: item.id,
        name: item.name,
        barcode: item.barcode,
        unit: item.unit,
        price: item.salePrice,
        gstRate: item.gstRate,
        qty: round3(qty),
        stock: item.stock,
        trackStock: item.trackStock
      }
      return { ...state, lines: [...state.lines, line], selected: state.lines.length, flash }
    }
    case 'setQty':
    case 'inc': {
      const line = state.lines[action.index]
      if (!line) return state
      const qty = round3(action.type === 'setQty' ? action.qty : line.qty + action.delta)
      if (qty <= 0) return withoutLine(state, action.index)
      return {
        ...state,
        lines: state.lines.map((l, i) => (i === action.index ? { ...l, qty } : l)),
        selected: action.index
      }
    }
    case 'remove':
      return withoutLine(state, action.index)
    case 'select':
      return state.lines.length ? { ...state, selected: Math.min(Math.max(action.index, 0), state.lines.length - 1) } : state
    case 'discount':
      return { ...state, discount: Math.max(0, Math.round(action.amount)) }
    case 'clear':
      return EMPTY
  }
}

export function useCart() {
  const [state, dispatch] = useReducer(reducer, undefined, load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines: state.lines, discount: state.discount }))
    } catch {
      // Storage full or blocked: the bill still works, it just won't survive a restart.
    }
  }, [state.lines, state.discount])

  const actions = useMemo(
    () => ({
      add: (item: Item, qty = 1) => dispatch({ type: 'add', item, qty }),
      setQty: (index: number, qty: number) => dispatch({ type: 'setQty', index, qty }),
      inc: (index: number, delta: number) => dispatch({ type: 'inc', index, delta }),
      remove: (index: number) => dispatch({ type: 'remove', index }),
      select: (index: number) => dispatch({ type: 'select', index }),
      setDiscount: (amount: number) => dispatch({ type: 'discount', amount }),
      clear: () => dispatch({ type: 'clear' })
    }),
    []
  )
  return { ...state, ...actions }
}
