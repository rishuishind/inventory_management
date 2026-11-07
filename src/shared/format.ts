// Money, quantity and date helpers. Money is integer paise everywhere except at the edges
// (what the user types and what is shown on screen / paper).

const moneyFormat = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** 123456 -> "1,234.56" */
export function formatMoney(paise: number): string {
  return moneyFormat.format(paise / 100)
}

/** 123456 -> "₹1,234.56" */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  return `${sign}₹${formatMoney(Math.abs(paise))}`
}

/** Parse what the user typed ("12", "12.5", "₹ 1,200") into paise. Returns null when invalid. */
export function parseMoney(text: string | number): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 100) : null
  const cleaned = text.replace(/₹|rs\.?|inr|,|\s/gi, '')
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

/** Paise -> plain rupee string for input fields: 1250 -> "12.50", 1200 -> "12". */
export function paiseToInput(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** 2 -> "2", 0.25 -> "0.25", 1.5 -> "1.5" */
export function formatQty(qty: number): string {
  return String(round3(qty))
}

export function parseQty(text: string): number | null {
  const cleaned = text.trim()
  if (!/^-?\d*\.?\d+$|^-?\d+\.?$/.test(cleaned)) return null
  const value = round3(Number(cleaned))
  return Number.isFinite(value) ? value : null
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local date as 'YYYY-MM-DD'. */
export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local time as 'YYYY-MM-DD HH:MM:SS' (what we store in the database). */
export function toLocalDateTime(d: Date): string {
  return `${toLocalDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 'YYYY-MM-DD' + n days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return toLocalDate(new Date(y, m - 1, d + days))
}

/** '2026-11-07 13:45:10' -> '07-11-2026 13:45' ; '2026-11-07' -> '07-11-2026' */
export function displayDate(stored: string): string {
  const [date, time] = stored.split(' ')
  const [y, m, d] = date.split('-')
  return time ? `${d}-${m}-${y} ${time.slice(0, 5)}` : `${d}-${m}-${y}`
}

/** Indian financial year (April-March) for a date, e.g. '2026-27'. */
export function financialYear(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** First day of the financial year containing d, as 'YYYY-MM-DD'. */
export function financialYearStart(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}-04-01`
}

/** plural(1, 'bill') -> "1 bill", plural(3, 'item') -> "3 items" */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function formatBillNo(fy: string, seq: number): string {
  return `${fy}/${seq}`
}
