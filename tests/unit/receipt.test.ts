import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { receiptHtml, sampleBill } from '../../src/main/receipt'

describe('receipt', () => {
  it('prints the shop name from the default settings at the top of the bill', () => {
    const html = receiptHtml(sampleBill(DEFAULT_SETTINGS), DEFAULT_SETTINGS)
    expect(html).toContain('<div class="shop">Siddharth Canteen Store</div>')
    expect(html).toContain('TAX INVOICE')
  })

  it('prints the shop name on 58 mm paper too', () => {
    const settings = { ...DEFAULT_SETTINGS, paperWidth: 58 as const }
    expect(receiptHtml(sampleBill(settings), settings)).toContain('Siddharth Canteen Store')
  })

  it('escapes the shop name so a name like "A & B <Store>" cannot break the receipt', () => {
    const settings = { ...DEFAULT_SETTINGS, shopName: 'A & B <Store>' }
    const html = receiptHtml(sampleBill(settings), settings)
    expect(html).toContain('A &amp; B &lt;Store&gt;')
    expect(html).not.toContain('<Store>')
  })
})
