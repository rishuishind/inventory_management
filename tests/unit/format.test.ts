import { describe, expect, it } from 'vitest'
import {
  addDays,
  displayDate,
  financialYear,
  formatMoney,
  formatQty,
  formatRupees,
  parseMoney,
  parseQty,
  toLocalDateTime
} from '@shared/format'

describe('money', () => {
  it('formats with Indian digit grouping', () => {
    expect(formatMoney(123456789)).toBe('12,34,567.89')
    expect(formatRupees(-1050)).toBe('-₹10.50')
  })

  it('parses what people type', () => {
    expect(parseMoney('12')).toBe(1200)
    expect(parseMoney('12.5')).toBe(1250)
    expect(parseMoney('₹ 1,200.05')).toBe(120005)
    expect(parseMoney('Rs. 40')).toBe(4000)
    expect(parseMoney(19.99)).toBe(1999)
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('.')).toBeNull()
  })
})

describe('quantity', () => {
  it('parses and formats', () => {
    expect(parseQty('2')).toBe(2)
    expect(parseQty('0.25')).toBe(0.25)
    expect(parseQty('x')).toBeNull()
    expect(formatQty(0.1 + 0.2)).toBe('0.3')
  })
})

describe('dates', () => {
  it('works out the financial year', () => {
    expect(financialYear(new Date(2026, 3, 1))).toBe('2026-27')
    expect(financialYear(new Date(2027, 2, 31))).toBe('2026-27')
    expect(financialYear(new Date(2099, 11, 1))).toBe('2099-00')
  })

  it('formats and shifts dates', () => {
    expect(toLocalDateTime(new Date(2026, 10, 7, 9, 5, 3))).toBe('2026-11-07 09:05:03')
    expect(displayDate('2026-11-07 13:45:10')).toBe('07-11-2026 13:45')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
