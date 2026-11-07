import { describe, expect, it } from 'vitest'
import { allocate, computeBill, parseScanInput, splitTax } from '@shared/billing'

const regularIncl = { gstMode: 'regular' as const, pricesIncludeGst: true, roundOff: false, discount: 0 }

describe('allocate', () => {
  it('splits proportionally without losing paise', () => {
    const shares = allocate(100, [1000, 2000, 3000])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
    expect(shares).toEqual([17, 33, 50])
  })

  it('returns zeros when nothing to split', () => {
    expect(allocate(0, [10, 20])).toEqual([0, 0])
    expect(allocate(50, [0, 0])).toEqual([0, 0])
  })
})

describe('splitTax', () => {
  it('splits evenly and gives the odd paisa to CGST', () => {
    expect(splitTax(100)).toEqual({ cgst: 50, sgst: 50 })
    expect(splitTax(95)).toEqual({ cgst: 48, sgst: 47 })
  })
})

describe('computeBill', () => {
  it('back-calculates GST from inclusive prices', () => {
    // ₹20 x 2 at 5% inclusive: taxable 38.10, tax 1.90
    const r = computeBill([{ price: 2000, qty: 2, gstRate: 5 }], regularIncl)
    expect(r.subtotal).toBe(4000)
    expect(r.taxable).toBe(3810)
    expect(r.tax).toBe(190)
    expect(r.cgst + r.sgst).toBe(190)
    expect(r.total).toBe(4000)
  })

  it('adds GST on top of exclusive prices', () => {
    const r = computeBill([{ price: 10000, qty: 1, gstRate: 18 }], { ...regularIncl, pricesIncludeGst: false })
    expect(r.taxable).toBe(10000)
    expect(r.tax).toBe(1800)
    expect(r.total).toBe(11800)
    expect(r.gstSummary).toEqual([{ rate: 18, taxable: 10000, cgst: 900, sgst: 900 }])
  })

  it('charges no tax in composition and unregistered modes', () => {
    for (const gstMode of ['composition', 'none'] as const) {
      const r = computeBill([{ price: 2000, qty: 1, gstRate: 5 }], { ...regularIncl, gstMode })
      expect(r.tax).toBe(0)
      expect(r.taxable).toBe(2000)
      expect(r.total).toBe(2000)
      expect(r.gstSummary).toEqual([])
    }
  })

  it('spreads the bill discount over lines before tax', () => {
    const r = computeBill(
      [
        { price: 3000, qty: 1, gstRate: 5 },
        { price: 1000, qty: 1, gstRate: 18 }
      ],
      { ...regularIncl, discount: 400 }
    )
    expect(r.lines.map((l) => l.discount)).toEqual([300, 100])
    expect(r.lines[0].total).toBe(2700)
    expect(r.lines[1].total).toBe(900)
    expect(r.total).toBe(3600)
    expect(r.gstSummary.map((g) => g.rate)).toEqual([5, 18])
  })

  it('never discounts more than the subtotal', () => {
    const r = computeBill([{ price: 1000, qty: 1, gstRate: 0 }], { ...regularIncl, discount: 5000 })
    expect(r.discount).toBe(1000)
    expect(r.total).toBe(0)
  })

  it('rounds the final amount to the nearest rupee', () => {
    const lines = [{ price: 1249, qty: 1, gstRate: 0 }]
    expect(computeBill(lines, { ...regularIncl, roundOff: true })).toMatchObject({ total: 1200, roundOff: -49 })
    const up = [{ price: 1250, qty: 1, gstRate: 0 }]
    expect(computeBill(up, { ...regularIncl, roundOff: true })).toMatchObject({ total: 1300, roundOff: 50 })
  })

  it('handles fractional quantities (loose items by weight)', () => {
    const r = computeBill([{ price: 4500, qty: 0.25, gstRate: 0 }], regularIncl)
    expect(r.subtotal).toBe(1125)
  })

  it('keeps the totals consistent for many mixed lines', () => {
    const lines = Array.from({ length: 25 }, (_, i) => ({ price: 999 + i * 37, qty: 1 + (i % 3), gstRate: [0, 5, 18, 40][i % 4] }))
    const r = computeBill(lines, { ...regularIncl, discount: 1234, roundOff: true })
    const lineTotal = r.lines.reduce((a, l) => a + l.total, 0)
    expect(lineTotal + r.roundOff).toBe(r.total)
    expect(r.subtotal - r.discount).toBe(lineTotal)
    expect(r.cgst + r.sgst).toBe(r.tax)
    expect(r.gstSummary.reduce((a, g) => a + g.taxable, 0)).toBe(r.taxable)
  })
})

describe('parseScanInput', () => {
  it('reads a quantity prefix', () => {
    expect(parseScanInput('3*8901234567890')).toEqual({ qty: 3, term: '8901234567890' })
    expect(parseScanInput('2 * tea')).toEqual({ qty: 2, term: 'tea' })
    expect(parseScanInput('0.5*sugar')).toEqual({ qty: 0.5, term: 'sugar' })
  })

  it('treats anything else as a plain search term', () => {
    expect(parseScanInput(' 8901234567890 ')).toEqual({ qty: 1, term: '8901234567890' })
    expect(parseScanInput('loose_tea')).toEqual({ qty: 1, term: 'loose_tea' })
  })
})
