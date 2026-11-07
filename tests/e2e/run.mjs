// End-to-end check of the real app: launches Electron with a throwaway database, drives the
// billing flow with the keyboard exactly like a USB barcode scanner, and saves screenshots
// of every screen to tests/e2e/output/. Run with: npm run e2e
// To test a packaged build instead: E2E_EXECUTABLE="dist/mac-arm64/Canteen POS.app/Contents/MacOS/Canteen POS" node tests/e2e/run.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'tests/e2e/output')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteen-e2e-'))
const backupDir = path.join(dataDir, 'backups')

const step = (name) => console.log(`• ${name}`)
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) })

const env = { ...process.env, CANTEEN_DATA_DIR: dataDir, CANTEEN_BACKUP_DIR: backupDir }
const app = await electron.launch(
  process.env.E2E_EXECUTABLE
    ? { executablePath: path.resolve(process.env.E2E_EXECUTABLE), args: [], env }
    : { args: [path.join(root, 'out/main/index.js')], env }
)

const page = await app.firstWindow()
try {
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message))
  page.on('console', (msg) => msg.type() === 'error' && console.error('CONSOLE:', msg.text()))
  await page.waitForSelector('.item-search input')
  // Emulate a typical 1366x768 laptop screen so screenshots match what the cashier will see.
  // (Emulated rather than resizing the window, which window managers may override.)
  const resize = (width, height) => page.setViewportSize({ width, height })
  await resize(1366, 768)

  const call = (method, ...args) =>
    page.evaluate(async ([m, a]) => {
      const res = await window.bridge.invoke(m, a)
      if (!res.ok) throw new Error(res.error)
      return res.data
    }, [method, args])

  step('first launch made a backup')
  assert.ok(fs.readdirSync(backupDir).some((f) => f.startsWith('canteen-backup-')))

  step('set up shop and items')
  await call('settings.save', { shopName: 'Sharma Canteen', shopAddress: 'Main Gate, Sector 5\nNoida', shopPhone: '98100 00000', gstin: '09ABCDE1234F1Z5' })
  const base = { category: 'Snacks', unit: 'pcs', costPrice: 0, hsn: '', lowStock: 5, trackStock: true, quick: false, active: true }
  await call('items.save', { ...base, name: 'Lays Classic 50g', barcode: '8901491101831', salePrice: 2000, costPrice: 1650, gstRate: 5, openingStock: 24 })
  await call('items.save', { ...base, name: 'Parle-G 100g', barcode: '8901719101038', salePrice: 1000, costPrice: 850, gstRate: 5, openingStock: 40 })
  await call('items.save', { ...base, name: 'Cola 250ml', barcode: '8901764012273', salePrice: 4000, costPrice: 3100, gstRate: 40, openingStock: 3, category: 'Drinks' })
  await call('items.save', { ...base, name: 'loose_tea', barcode: null, salePrice: 1000, gstRate: 5, openingStock: 0, quick: true, trackStock: false, category: 'Tea & Coffee', unit: 'cup' })
  await call('items.save', { ...base, name: 'Samosa', barcode: null, salePrice: 1500, gstRate: 5, openingStock: 0, quick: true, trackStock: false, category: 'Food', unit: 'plate' })
  // Re-open billing so it picks up the new shop name and quick buttons.
  await page.reload()
  await page.waitForSelector('.quick-btn')

  const scanBox = page.locator('.item-search input')
  const scan = async (code) => {
    await page.keyboard.type(code, { delay: 4 })
    await page.keyboard.press('Enter')
  }
  const rows = page.locator('.cart-table tbody tr')

  step('scan a barcode adds the item')
  await scanBox.focus()
  await scan('8901491101831')
  await rows.first().waitFor()
  assert.equal(await rows.count(), 1)
  assert.match(await rows.first().innerText(), /Lays Classic 50g/)

  step('scanning it again increases the quantity')
  await scan('8901491101831')
  await page.waitForFunction(() => document.querySelector('.cart-table tbody tr .stepper input')?.value === '2')

  step('two scans in quick succession are both counted')
  await scan('8901719101038')
  await scan('8901719101038')
  await page.waitForFunction(() => document.querySelectorAll('.cart-table tbody tr').length === 2)
  await page.waitForFunction(() => document.querySelectorAll('.cart-table tbody tr .stepper input')[1]?.value === '2')

  step('3* prefix adds three at once')
  await scan('3*8901764012273')
  await page.waitForFunction(() => document.querySelectorAll('.cart-table tbody tr .stepper input')[2]?.value === '3')

  step('typing a loose item name shows suggestions; Enter adds the first')
  await page.keyboard.type('loose_t', { delay: 30 })
  await page.waitForSelector('.item-search-results li')
  await shot(page, '01-search-dropdown')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.cart-table tbody tr').length === 4)

  step('+ on the empty scan box adds one more of the selected line')
  await page.keyboard.press('+')
  await page.waitForFunction(() => document.querySelectorAll('.cart-table tbody tr .stepper input')[3]?.value === '2')

  step('quick button adds Samosa')
  await page.locator('.quick-btn', { hasText: 'Samosa' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.cart-table tbody tr').length === 5)

  step('typing anywhere goes to the scan box')
  await page.locator('.totals-counts').click()
  await scan('8901491101831')
  await page.waitForFunction(() => document.querySelector('.cart-table tbody tr .stepper input')?.value === '3')

  step('unknown barcode opens New item with the barcode filled in')
  await scan('8906000000019')
  await page.waitForSelector('.modal')
  assert.equal(await page.locator('.modal input.mono').inputValue(), '8906000000019')
  await page.keyboard.type('Kurkure Masala 40g')
  await page.locator('.modal label', { hasText: 'Sale price' }).locator('input').fill('20')
  await shot(page, '02-new-item-from-scan')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.modal', { state: 'detached' })
  await page.waitForFunction(() => document.querySelectorAll('.cart-table tbody tr').length === 6)

  step('text that matches nothing shows an error instead of adding')
  await page.keyboard.type('pizza', { delay: 10 })
  await page.keyboard.press('Enter')
  await page.waitForSelector('.toast.error')
  assert.equal(await rows.count(), 6)

  // Lays 3x20 + Parle 2x10 + Cola 3x40 + tea 2x10 + samosa 15 + kurkure 20 = 255
  const total = await page.locator('[data-testid=bill-total]').innerText()
  assert.equal(total, '₹255.00')
  // Made-in-canteen items (stock not tracked) must not show stock warnings.
  assert.equal(await page.locator('.cart-table tr', { hasText: 'Samosa' }).locator('.badge').count(), 0)
  assert.equal(await page.locator('.cart-table tr', { hasText: 'Cola' }).locator('.badge').count(), 0)
  await shot(page, '03-billing-cart')
  await resize(1024, 640)
  await page.waitForTimeout(200)
  await shot(page, '03b-billing-cart-small-screen')
  const cutOff = await page.evaluate(() => {
    const wrap = document.querySelector('.cart .table-wrap')
    return wrap.scrollWidth > wrap.clientWidth
  })
  assert.equal(cutOff, false, 'cart table must fit a 1024px wide window')
  await resize(1366, 768)

  step('discount 5 then pay by cash with change')
  await page.keyboard.press('F8')
  await page.keyboard.type('5')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('[data-testid=bill-total]')?.textContent === '₹250.00')
  // Type the cash straight after F12, as a fast cashier would: nothing may land behind the dialog.
  await page.keyboard.press('F12')
  await page.keyboard.type('500')
  await page.waitForSelector('.pay')
  assert.equal(await page.locator('.pay-cash input').inputValue(), '500')
  assert.equal(await scanBox.inputValue(), '')
  await page.waitForSelector('.pay-change strong')
  assert.equal(await page.locator('.pay-change strong').innerText(), '₹250.00')
  await shot(page, '04-payment')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.toast.success')
  await page.waitForSelector('.cart .empty')

  step('bill saved with correct totals, stock reduced')
  const bill = await call('bills.last')
  assert.equal(bill.billNo.endsWith('/1'), true)
  assert.equal(bill.total, 25000)
  assert.equal(bill.discount, 500)
  assert.equal(bill.tendered, 50000)
  assert.equal(bill.lines.length, 6)
  assert.equal(bill.cgst + bill.sgst, bill.lines.reduce((a, l) => a + l.tax, 0))
  const lays = await call('items.lookup', '8901491101831')
  assert.equal(lays.stock, 21)
  const cola = await call('items.lookup', '8901764012273')
  assert.equal(cola.stock, 0)

  step('the bill in progress survives a restart of the screen')
  await scan('8901719101038')
  await rows.first().waitFor()
  await page.reload()
  await page.waitForSelector('.cart-table tbody tr')
  assert.equal(await rows.count(), 1)
  await page.locator('.totals-actions button', { hasText: 'Clear bill' }).click()
  await page.locator('.modal .btn.danger').click()
  await page.waitForSelector('.cart .empty')

  step('receipt preview opens when no printer is set up')
  const previewPromise = app.waitForEvent('window')
  await page.keyboard.press('F9')
  const preview = await previewPromise
  await preview.waitForSelector('.receipt')
  await preview.setViewportSize({ width: 460, height: 1000 })
  const receiptText = await preview.locator('.receipt').innerText()
  assert.match(receiptText, /Sharma Canteen/)
  assert.match(receiptText, /TAX INVOICE/)
  assert.match(receiptText, /GSTIN: 09ABCDE1234F1Z5/)
  assert.match(receiptText, /Change\s+250\.00/)
  await preview.screenshot({ path: path.join(outDir, '05-receipt-80mm.png'), fullPage: true })
  const previewClosed = preview.waitForEvent('close')
  await preview.click('#close')
  await previewClosed

  step('58 mm receipt layout')
  await call('settings.save', { paperWidth: 58 })
  const preview58Promise = app.waitForEvent('window')
  await call('bills.print', bill.id)
  const preview58 = await preview58Promise
  await preview58.waitForSelector('.receipt')
  await preview58.setViewportSize({ width: 380, height: 1000 })
  await preview58.screenshot({ path: path.join(outDir, '06-receipt-58mm.png'), fullPage: true })
  // Escape closes the preview; the window can vanish before the key press call returns.
  const preview58Closed = preview58.waitForEvent('close')
  await preview58.keyboard.press('Escape').catch(() => {})
  await preview58Closed
  await call('settings.save', { paperWidth: 80 })

  step('Items screen')
  await page.keyboard.press('F2')
  await page.waitForSelector('.page h1:text("Items")')
  await page.waitForSelector('.table tbody tr')
  await shot(page, '07-items')
  await page.locator('.segmented button', { hasText: 'Low stock' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.table tbody tr')].some((r) => r.textContent.includes('Cola')))

  step('Stock In: scan, set quantity and price, save')
  await page.keyboard.press('F3')
  await page.waitForSelector('.page h1:text("Stock In")')
  await page.locator('.form-row input').first().fill('Metro Wholesale')
  await page.locator('.item-search input').focus()
  await scan('8901764012273')
  await page.waitForSelector('.table tbody tr')
  await page.locator('.table tbody tr input[aria-label=Quantity]').fill('24')
  await page.locator('.table tbody tr input[aria-label="Buying price"]').fill('31.50')
  await shot(page, '08-stock-in')
  await page.keyboard.press('F12')
  await page.waitForSelector('.recent-list li')
  const colaAfter = await call('items.lookup', '8901764012273')
  assert.equal(colaAfter.stock, 24)
  assert.equal(colaAfter.costPrice, 3150)

  step('Bills screen with detail')
  await page.keyboard.press('F4')
  await page.waitForSelector('.table tbody tr')
  await page.locator('.table tbody tr').first().click()
  await page.waitForSelector('.bill-detail h2')
  await shot(page, '09-bills')

  step('Reports')
  await page.keyboard.press('F5')
  await page.waitForSelector('.stats')
  await shot(page, '10-reports-summary')
  await page.locator('.segmented button', { hasText: 'GST' }).click()
  await page.waitForSelector('.report tfoot')
  await shot(page, '11-reports-gst')

  step('Settings')
  await page.keyboard.press('F6')
  await page.waitForSelector('.settings-grid')
  await shot(page, '12-settings')

  step('cancel the bill returns stock')
  await call('bills.cancel', bill.id)
  assert.equal((await call('items.lookup', '8901491101831')).stock, 24)
  const summary = await call('reports.summary', { from: '2000-01-01', to: '2999-12-31' })
  assert.equal(summary.bills, 0)
  assert.equal(summary.cancelled, 1)

  console.log('\nAll end-to-end checks passed. Screenshots in tests/e2e/output/')
} catch (err) {
  await shot(page, 'FAILED').catch(() => {})
  console.error('Focused element:', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200)).catch(() => '?'))
  throw err
} finally {
  await app.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
