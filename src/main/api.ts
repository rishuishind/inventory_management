import path from 'node:path'
import { app, type BrowserWindow, dialog, shell } from 'electron'
import type { Api } from '@shared/api'
import type { Bill, PrintResult, Settings } from '@shared/types'
import type { DB } from './db/database'
import { previewHtml, printHtml } from './printing'
import { receiptHtml, sampleBill } from './receipt'
import { backupDatabase, inspectBackup } from './services/backup'
import { cancelBill, createBill, getBill, lastBill, listBills } from './services/bills'
import { writeWorkbook } from './services/exporter'
import { previewImport, runImport } from './services/importer'
import {
  adjustStock,
  getItem,
  itemCategories,
  listItems,
  lookupBarcode,
  quickItems,
  removeItem,
  saveItem,
  searchItems
} from './services/items'
import { createPurchase, getPurchase, listPurchases, recentSuppliers } from './services/purchases'
import { gstReport, itemSales, salesSummary, stockReport, todayStats } from './services/reports'
import { getSettings, saveSettings } from './services/settings'
import { stockHistory } from './services/stock'

export interface AppContext {
  db: () => DB
  window: () => BrowserWindow | null
  dataDir: string
  dbPath: string
  backupDir: (settings: Settings) => string
  backupError: () => string | null
  onSettingsChanged: (settings: Settings) => void
  restoreDatabase: (file: string) => void
}

export function createApi(ctx: AppContext): Api {
  const db = (): DB => ctx.db()
  const settings = (): Settings => getSettings(db())
  const requireWindow = (): BrowserWindow => {
    const win = ctx.window()
    if (!win) throw new Error('The main window is not open')
    return win
  }

  async function printBill(bill: Bill): Promise<PrintResult> {
    const s = settings()
    if (!s.printerName) {
      await previewHtml(receiptHtml(bill, s, { preview: true }), ctx.window(), s.paperWidth)
      return { mode: 'preview' }
    }
    await printHtml(receiptHtml(bill, s), {
      printer: s.printerName,
      paperWidthMm: s.paperWidth,
      copies: s.printCopies,
      paperFromPrinter: s.paperFromPrinter
    })
    return { mode: 'printed' }
  }

  return {
    items: {
      lookup: (code) => lookupBarcode(db(), code),
      search: (q, limit) => searchItems(db(), q, limit),
      list: (query) => listItems(db(), query),
      get: (id) => getItem(db(), id),
      save: (input) => saveItem(db(), input),
      remove: (id) => removeItem(db(), id),
      categories: () => itemCategories(db()),
      quick: () => quickItems(db())
    },
    stock: {
      adjust: (input) => adjustStock(db(), input),
      history: (itemId) => stockHistory(db(), itemId)
    },
    bills: {
      create: (draft) => createBill(db(), draft, settings()),
      list: (range, q) => listBills(db(), range, q),
      get: (id) => getBill(db(), id),
      last: () => lastBill(db()),
      cancel: (id) => cancelBill(db(), id),
      print: async (id) => {
        const bill = getBill(db(), id)
        if (!bill) throw new Error('Bill not found')
        return printBill(bill)
      }
    },
    purchases: {
      create: (input) => createPurchase(db(), input),
      list: (range) => listPurchases(db(), range),
      get: (id) => getPurchase(db(), id),
      suppliers: () => recentSuppliers(db())
    },
    reports: {
      summary: (range) => salesSummary(db(), range),
      itemSales: (range) => itemSales(db(), range),
      gst: (range) => gstReport(db(), range),
      stock: () => stockReport(db()),
      today: () => todayStats(db())
    },
    settings: {
      get: settings,
      save: (patch) => {
        const saved = saveSettings(db(), patch)
        ctx.onSettingsChanged(saved)
        return saved
      }
    },
    system: {
      info: () => ({
        version: app.getVersion(),
        dataDir: ctx.dataDir,
        dbPath: ctx.dbPath,
        backupDir: ctx.backupDir(settings()),
        backupError: ctx.backupError()
      }),
      printers: async () => {
        const printers = (await ctx.window()?.webContents.getPrintersAsync()) ?? []
        return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name }))
      },
      testPrint: () => printBill(sampleBill(settings())),
      backupNow: () => {
        const result = backupDatabase(db(), ctx.backupDir(settings()))
        saveSettings(db(), { lastBackupAt: result.at })
        return result
      },
      chooseBackupDir: async () => {
        const res = await dialog.showOpenDialog(requireWindow(), {
          title: 'Choose backup folder',
          properties: ['openDirectory', 'createDirectory']
        })
        return res.canceled ? null : (res.filePaths[0] ?? null)
      },
      restore: async () => {
        const win = requireWindow()
        const res = await dialog.showOpenDialog(win, {
          title: 'Choose a backup to restore',
          defaultPath: ctx.backupDir(settings()),
          filters: [{ name: 'Canteen POS backup', extensions: ['db'] }],
          properties: ['openFile']
        })
        const file = res.filePaths[0]
        if (res.canceled || !file) return { restored: false }
        if (path.resolve(file) === path.resolve(ctx.dbPath)) throw new Error('That is the database currently in use.')
        const info = inspectBackup(file)
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Restore', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Restore backup',
          message: 'Replace all current data with this backup?',
          detail:
            `${path.basename(file)}\n${info.items} items, ${info.bills} bills.\n\n` +
            'Your current data is saved as a separate backup file first. The app will restart.'
        })
        if (response !== 0) return { restored: false }
        ctx.restoreDatabase(file)
        return { restored: true }
      },
      openFolder: async (target) => {
        const known = [ctx.dataDir, ctx.backupDir(settings())].map((p) => path.resolve(p))
        if (known.includes(path.resolve(target))) {
          const error = await shell.openPath(target)
          if (error) throw new Error(error)
        } else {
          shell.showItemInFolder(target)
        }
      },
      exportExcel: async (request) => {
        const res = await dialog.showSaveDialog(requireWindow(), {
          title: 'Save Excel file',
          defaultPath: path.join(app.getPath('documents'), `${request.defaultName}.xlsx`),
          filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
        })
        if (res.canceled || !res.filePath) return { saved: false }
        writeWorkbook(res.filePath, request.sheets)
        return { saved: true, path: res.filePath }
      },
      importPick: async () => {
        const res = await dialog.showOpenDialog(requireWindow(), {
          title: 'Choose item list (Excel or CSV)',
          defaultPath: app.getPath('documents'),
          filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
          properties: ['openFile']
        })
        const file = res.filePaths[0]
        return res.canceled || !file ? null : previewImport(file)
      },
      importRun: (filePath, mapping, options) => runImport(db(), filePath, mapping, options)
    }
  }
}

/** Find api[namespace][method] for an IPC call like "items.search". */
export function resolveMethod(api: Api, method: string): ((...args: unknown[]) => unknown) | null {
  const [group, name, ...rest] = method.split('.')
  if (!group || !name || rest.length) return null
  const ns = (api as unknown as Record<string, Record<string, unknown>>)[group]
  if (!ns || !Object.hasOwn(api, group) || !Object.hasOwn(ns, name)) return null
  const fn = ns[name]
  return typeof fn === 'function' ? (fn as (...args: unknown[]) => unknown) : null
}
