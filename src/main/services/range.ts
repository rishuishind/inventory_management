import { addDays } from '@shared/format'
import type { DateRange } from '@shared/types'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Inclusive date range -> [start, end) bounds comparable with stored 'YYYY-MM-DD HH:MM:SS' text. */
export function rangeBounds(range: DateRange): [string, string] {
  if (!DATE.test(range.from) || !DATE.test(range.to)) throw new Error('Invalid date range')
  return [`${range.from} 00:00:00`, `${addDays(range.to, 1)} 00:00:00`]
}
