import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as XLSX from 'xlsx'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ItemInput, type Settings } from '@shared/types'
import { type DB, openDatabase, SCHEMA_VERSION, schemaVersion } from '../../src/main/db/database'
import { backupDatabase, inspectBackup } from '../../src/main/services/backup'
import { writeWorkbook } from '../../src/main/services/exporter'
import { cancelBill, createBill, getBill, lastBill, listBills } from '../../src/main/services/bills'
import { previewImport, runImport } from '../../src/main/services/importer'
import {
  adjustStock,
  getItem,
  listItems,
  lookupBarcode,
  removeItem,
  saveItem,
  searchItems
} from '../../src/main/services/items'
import { createPurchase } from '../../src/main/services/purchases'
import { gstReport, itemSales, salesSummary, stockReport, todayStats } from '../../src/main/services/reports'
import { getSettings, saveSettings } from '../../src/main/services/settings'
import { stockHistory } from '../../src/main/services/stock'

let dir: string
let db: DB
const settings: Settings = { ...DEFAULT_SETTINGS, roundOff: false }
const day = new Date(2026, 10, 7, 12, 0, 0)
const today = { from: '2026-11-07', to: '2026-11-07' }

function item(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    name: 'Lays Classic 50g',
    barcode: '8901491101831',
    category: 'Snacks',
    unit: 'pcs',
    salePrice: 2000,
    costPrice: 1600,
    gstRate: 5,
    hsn: '2005',
    openingStock: 10,
    lowStock: 2,
    trackStock: true,
    quick: false,
    active: true,
    ...overrides
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteen-test-'))
  db = openDatabase(path.join(dir, 'canteen.db'))
})

afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('database file', () => {
  it('keeps every item, bill and stock level when the app is closed and reopened (as after an update)', () => {
    const lays = saveItem(db, item())
    createBill(db, { lines: [{ itemId: lays.id, qty: 3, price: 2000 }], discount: 0, paymentMode: 'cash', tendered: null }, settings, day)
    saveSettings(db, { shopName: 'Sharma Canteen' })
    db.close()

    db = openDatabase(path.join(dir, 'canteen.db'))
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION)
    expect(getItem(db, lays.id)).toMatchObject({ name: 'Lays Classic 50g', stock: 7 })
    expect(lastBill(db)).toMatchObject({ billNo: '2026-27/1', total: 6000 })
    expect(getSettings(db).shopName).toBe('Sharma Canteen')
    // The next bill continues the numbering instead of starting again.
    const next = createBill(db, { lines: [{ itemId: lays.id, qty: 1, price: 2000 }], discount: 0, paymentMode: 'upi', tendered: null }, settings, day)
    expect(next.billNo).toBe('2026-27/2')
  })

  it('refuses a database made by a newer version instead of damaging it', () => {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => openDatabase(path.join(dir, 'canteen.db'))).toThrow(/newer version/)
    // afterEach closes `db`: give it something open.
    db = new DatabaseSync(':memory:')
  })
})

describe('items', () => {
  it('creates items with opening stock and finds them by barcode and name', () => {
    const lays = saveItem(db, item())
    expect(lays.stock).toBe(10)
    expect(lookupBarcode(db, ' 8901491101831 ')?.id).toBe(lays.id)
    expect(searchItems(db, 'lays 50').map((i) => i.id)).toEqual([lays.id])
    expect(stockHistory(db, lays.id)[0]).toMatchObject({ reason: 'opening', change: 10, balance: 10 })
  })

  it('treats _ in search as a normal character (loose_ items)', () => {
    saveItem(db, item({ name: 'loose_tea', barcode: null }))
    saveItem(db, item({ name: 'looseXtea', barcode: null }))
    expect(searchItems(db, 'loose_').map((i) => i.name)).toEqual(['loose_tea'])
  })

  it('ranks an exact name match first', () => {
    saveItem(db, item({ name: 'Lemon Tea', barcode: null }))
    saveItem(db, item({ name: 'Tea (Large)', barcode: null }))
    saveItem(db, item({ name: 'Tea', barcode: null }))
    expect(searchItems(db, 'tea')[0].name).toBe('Tea')
  })

  it('rejects a barcode that another item already uses', () => {
    saveItem(db, item())
    expect(() => saveItem(db, item({ name: 'Other' }))).toThrow(/already used by "Lays Classic 50g"/)
  })

  it('hides items that have history instead of deleting them', () => {
    const unused = saveItem(db, item({ barcode: null, name: 'Unused' }))
    expect(removeItem(db, unused.id)).toEqual({ deleted: true })
    expect(getItem(db, unused.id)).toBeNull()

    const sold = saveItem(db, item())
    createBill(db, { lines: [{ itemId: sold.id, qty: 1, price: 2000 }], discount: 0, paymentMode: 'cash', tendered: null }, settings, day)
    expect(removeItem(db, sold.id)).toEqual({ deleted: false })
    expect(getItem(db, sold.id)?.active).toBe(false)
    expect(lookupBarcode(db, '8901491101831')).toBeNull()
  })

  it('filters low stock', () => {
    saveItem(db, item({ barcode: '1', name: 'Plenty', openingStock: 50, lowStock: 5 }))
    saveItem(db, item({ barcode: '2', name: 'Running low', openingStock: 3, lowStock: 5 }))
    saveItem(db, item({ barcode: '3', name: 'Sold out', openingStock: 0, lowStock: 0 }))
    saveItem(db, item({ barcode: null, name: 'Tea (made here)', openingStock: 0, trackStock: false }))
    expect(listItems(db, { filter: 'low' }).rows.map((i) => i.name)).toEqual(['Running low', 'Sold out'])
    expect(listItems(db, { filter: 'out' }).total).toBe(1)
    expect(stockReport(db).map((i) => i.name)).not.toContain('Tea (made here)')
  })

  it('adjusts stock to a counted value', () => {
    const lays = saveItem(db, item())
    expect(adjustStock(db, { itemId: lays.id, mode: 'set', qty: 7, reason: 'Count' }).stock).toBe(7)
    expect(adjustStock(db, { itemId: lays.id, mode: 'add', qty: -2, reason: 'Damaged' }).stock).toBe(5)
    expect(stockHistory(db, lays.id).map((m) => m.change)).toEqual([-2, -3, 10])
  })
})

describe('bills', () => {
  it('saves a bill, numbers it per financial year and reduces stock', () => {
    const lays = saveItem(db, item())
    const tea = saveItem(db, item({ name: 'Tea', barcode: null, salePrice: 1000, gstRate: 5, openingStock: 0 }))
    const bill = createBill(
      db,
      {
        lines: [
          { itemId: lays.id, qty: 2, price: 2000 },
          { itemId: tea.id, qty: 1, price: 1000 }
        ],
        discount: 0,
        paymentMode: 'cash',
        tendered: 10000
      },
      settings,
      day
    )
    expect(bill.billNo).toBe('2026-27/1')
    expect(bill.total).toBe(5000)
    expect(bill.lines).toHaveLength(2)
    expect(bill.cgst + bill.sgst).toBe(bill.lines.reduce((a, l) => a + l.tax, 0))
    expect(getItem(db, lays.id)?.stock).toBe(8)
    // Selling with no stock is allowed; stock just goes negative.
    expect(getItem(db, tea.id)?.stock).toBe(-1)

    const second = createBill(db, { lines: [{ itemId: tea.id, qty: 1, price: 1000 }], discount: 0, paymentMode: 'upi', tendered: null }, settings, day)
    expect(second.billNo).toBe('2026-27/2')
    const nextYear = createBill(db, { lines: [{ itemId: tea.id, qty: 1, price: 1000 }], discount: 0, paymentMode: 'upi', tendered: null }, settings, new Date(2027, 3, 1))
    expect(nextYear.billNo).toBe('2027-28/1')
    expect(lastBill(db)?.id).toBe(nextYear.id)
  })

  it('snapshots item details so later edits do not change old bills', () => {
    const lays = saveItem(db, item())
    const bill = createBill(db, { lines: [{ itemId: lays.id, qty: 1, price: 2000 }], discount: 0, paymentMode: 'card', tendered: null }, settings, day)
    saveItem(db, { ...item(), id: lays.id, name: 'Renamed', salePrice: 9900 })
    expect(getBill(db, bill.id)?.lines[0]).toMatchObject({ name: 'Lays Classic 50g', price: 2000 })
  })

  it('refuses empty bills and short cash', () => {
    const lays = saveItem(db, item())
    expect(() => createBill(db, { lines: [], discount: 0, paymentMode: 'cash', tendered: null }, settings, day)).toThrow(/empty/)
    expect(() =>
      createBill(db, { lines: [{ itemId: lays.id, qty: 1, price: 2000 }], discount: 0, paymentMode: 'cash', tendered: 1000 }, settings, day)
    ).toThrow(/less than/)
    expect(listBills(db, today)).toHaveLength(0)
    expect(getItem(db, lays.id)?.stock).toBe(10)
  })

  it('cancels a bill, returns stock and drops it from sales', () => {
    const lays = saveItem(db, item())
    const bill = createBill(db, { lines: [{ itemId: lays.id, qty: 3, price: 2000 }], discount: 0, paymentMode: 'cash', tendered: null }, settings, day)
    expect(getItem(db, lays.id)?.stock).toBe(7)
    expect(cancelBill(db, bill.id, day).status).toBe('cancelled')
    expect(getItem(db, lays.id)?.stock).toBe(10)
    expect(() => cancelBill(db, bill.id, day)).toThrow(/already cancelled/)
    const summary = salesSummary(db, today)
    expect(summary).toMatchObject({ bills: 0, cancelled: 1, total: 0 })
  })

  it('finds bills by number across dates', () => {
    const lays = saveItem(db, item())
    createBill(db, { lines: [{ itemId: lays.id, qty: 1, price: 2000 }], discount: 0, paymentMode: 'cash', tendered: null }, settings, day)
    expect(listBills(db, { from: '2020-01-01', to: '2020-01-01' }, '2026-27/1')).toHaveLength(1)
  })
})

describe('purchases', () => {
  it('adds stock and updates cost and sale price', () => {
    const lays = saveItem(db, item())
    const p = createPurchase(
      db,
      { supplier: 'Metro', invoiceNo: 'INV-9', note: '', lines: [{ itemId: lays.id, qty: 24, costPrice: 1700, salePrice: 2200 }] },
      day
    )
    expect(p.total).toBe(24 * 1700)
    expect(getItem(db, lays.id)).toMatchObject({ stock: 34, costPrice: 1700, salePrice: 2200 })
    expect(stockHistory(db, lays.id)[0]).toMatchObject({ reason: 'purchase', refLabel: 'Metro', change: 24 })
  })
})

describe('reports', () => {
  it('summarises sales, GST, items and stock value', () => {
    const lays = saveItem(db, item())
    const cola = saveItem(db, item({ name: 'Cola 250ml', barcode: '2', salePrice: 4000, costPrice: 3000, gstRate: 40, openingStock: 5 }))
    createBill(db, { lines: [{ itemId: lays.id, qty: 2, price: 2000 }], discount: 0, paymentMode: 'cash', tendered: null }, settings, day)
    createBill(db, { lines: [{ itemId: cola.id, qty: 1, price: 4000 }], discount: 0, paymentMode: 'upi', tendered: null }, settings, day)

    const s = salesSummary(db, today)
    expect(s).toMatchObject({ bills: 2, total: 8000, cash: 4000, upi: 4000, card: 0, cost: 2 * 1600 + 3000 })
    expect(s.days).toEqual([{ date: '2026-11-07', bills: 2, total: 8000, cash: 4000, upi: 4000, card: 0 }])

    const gst = gstReport(db, today)
    expect(gst.map((g) => g.rate)).toEqual([5, 40])
    expect(gst.reduce((a, g) => a + g.cgst + g.sgst, 0)).toBe(s.cgst + s.sgst)

    expect(itemSales(db, today).map((r) => [r.name, r.qty, r.sales])).toEqual([
      ['Lays Classic 50g', 2, 4000],
      ['Cola 250ml', 1, 4000]
    ])
    expect(stockReport(db).find((r) => r.id === lays.id)?.stockValue).toBe(8 * 1600)
    expect(todayStats(db, day)).toEqual({ bills: 2, total: 8000 })
  })
})

describe('settings', () => {
  it('merges saved values over defaults and validates them', () => {
    expect(getSettings(db).shopName).toBe(DEFAULT_SETTINGS.shopName)
    expect(saveSettings(db, { shopName: '  Sharma Canteen ', gstin: '09abcde1234f1z5' })).toMatchObject({
      shopName: 'Sharma Canteen',
      gstin: '09ABCDE1234F1Z5'
    })
    expect(() => saveSettings(db, { gstin: '123' })).toThrow(/GSTIN/)
    expect(() => saveSettings(db, { paperWidth: 70 as 80 })).toThrow(/58 or 80/)
    expect(() => saveSettings(db, { zoom: '2' as unknown as number })).toThrow(/Invalid value/)
  })
})

describe('backup', () => {
  it('writes a daily snapshot that can be inspected', () => {
    saveItem(db, item())
    const backupDir = path.join(dir, 'backups')
    const result = backupDatabase(db, backupDir, day)
    expect(path.basename(result.path)).toBe('canteen-backup-2026-11-07.db')
    // A second backup on the same day replaces the first.
    backupDatabase(db, backupDir, day)
    expect(fs.readdirSync(backupDir)).toEqual(['canteen-backup-2026-11-07.db'])
    expect(inspectBackup(result.path)).toEqual({ items: 1, bills: 0 })
  })

  it('keeps only the newest daily backups', () => {
    const backupDir = path.join(dir, 'backups')
    for (let d = 1; d <= 5; d++) backupDatabase(db, backupDir, new Date(2026, 10, d), 3)
    expect(fs.readdirSync(backupDir).sort()).toEqual([
      'canteen-backup-2026-11-03.db',
      'canteen-backup-2026-11-04.db',
      'canteen-backup-2026-11-05.db'
    ])
  })

  it('rejects files that are not backups', () => {
    const bogus = path.join(dir, 'bogus.db')
    fs.writeFileSync(bogus, 'hello')
    expect(() => inspectBackup(bogus)).toThrow(/not a Canteen POS backup/)
  })
})

describe('excel export', () => {
  it('writes numbers as numbers so Excel can total them', () => {
    const file = path.join(dir, 'report.xlsx')
    writeWorkbook(file, [{ name: 'Sales', rows: [['Item', 'Amount'], ['Tea', 12.5], ['Samosa', 30]] }])
    const sheet = XLSX.read(fs.readFileSync(file)).Sheets.Sales
    expect(XLSX.utils.sheet_to_json(sheet)).toEqual([
      { Item: 'Tea', Amount: 12.5 },
      { Item: 'Samosa', Amount: 30 }
    ])
  })
})

describe('excel import', () => {
  function writeSheet(rows: (string | number)[][]): string {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Items')
    const file = path.join(dir, 'items.xlsx')
    fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
    return file
  }

  it('finds the header row under a title block and guesses columns', () => {
    const file = writeSheet([
      ['SHARMA CANTEEN'],
      ['Item List as on 07-11-2026'],
      [],
      ['S.No', 'Item Name', 'Barcode', 'MRP', 'Purchase Rate', 'GST %', 'HSN', 'Closing Stock'],
      [1, 'Parle-G 100g', 8901719101038, 10, 8.5, '5%', '1905', 48],
      [2, 'loose_tea', '', 10, 0, 5, '', 0]
    ])
    const preview = previewImport(file)
    expect(preview.rowCount).toBe(2)
    expect(preview.mapping).toEqual({ name: 1, barcode: 2, salePrice: 3, costPrice: 4, gstRate: 5, hsn: 6, stock: 7 })
    expect(preview.sample[0][2]).toBe('8901719101038')
  })

  it('creates new items, then updates them on a second import', () => {
    const file = writeSheet([
      ['Item Name', 'Barcode', 'MRP', 'Purchase Rate', 'GST %', 'Stock'],
      ['Parle-G 100g', 8901719101038, 10, 8.5, 0.05, 48],
      ['loose_tea', '', '₹ 10', '', '5%', ''],
      ['', '', '', '', '', ''],
      ['Bad price', '123', 'abc', '', '', '']
    ])
    const mapping = previewImport(file).mapping
    const first = runImport(db, file, mapping, { updateExisting: true, updateStock: false }, day)
    expect(first).toMatchObject({ created: 2, updated: 0, skipped: 1 })
    expect(first.errors).toEqual([{ row: 5, reason: 'Bad price: no valid sale price' }])
    expect(lookupBarcode(db, '8901719101038')).toMatchObject({ salePrice: 1000, costPrice: 850, gstRate: 5, stock: 48 })
    expect(searchItems(db, 'loose_tea')[0]).toMatchObject({ salePrice: 1000, gstRate: 5, barcode: null })

    const again = writeSheet([
      ['Item Name', 'Barcode', 'MRP', 'Stock'],
      ['Parle-G 100g', 8901719101038, 12, 40]
    ])
    const second = runImport(db, again, previewImport(again).mapping, { updateExisting: true, updateStock: true }, day)
    expect(second).toMatchObject({ created: 0, updated: 1 })
    expect(lookupBarcode(db, '8901719101038')).toMatchObject({ salePrice: 1200, stock: 40 })
  })
})
