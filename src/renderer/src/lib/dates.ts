import { addDays, financialYearStart, toLocalDate } from '@shared/format'
import type { DateRange } from '@shared/types'

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'fy' | 'custom'

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'This month',
  lastMonth: 'Last month',
  fy: 'This financial year',
  custom: 'Custom dates'
}

export function presetRange(preset: RangePreset, now = new Date()): DateRange {
  const today = toLocalDate(now)
  switch (preset) {
    case 'yesterday': {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case 'week':
      return { from: addDays(today, -6), to: today }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today }
    case 'lastMonth': {
      const end = addDays(`${today.slice(0, 8)}01`, -1)
      return { from: `${end.slice(0, 8)}01`, to: end }
    }
    case 'fy':
      return { from: financialYearStart(now), to: today }
    default:
      return { from: today, to: today }
  }
}

export const todayRange = (): DateRange => presetRange('today')
