// The contract between the screens (renderer) and the database/printer side (main).
// main/api.ts implements this interface; the renderer calls it through a typed proxy.

import type {
  AppInfo,
  BackupResult,
  Bill,
  BillDraft,
  BillSummary,
  DateRange,
  ExportRequest,
  GstRow,
  ImportMapping,
  ImportOptions,
  ImportPreview,
  ImportResult,
  Item,
  ItemInput,
  ItemList,
  ItemListQuery,
  ItemSalesRow,
  PrintResult,
  PrinterInfo,
  Purchase,
  PurchaseInput,
  PurchaseSummary,
  SalesSummary,
  Settings,
  StockAdjustInput,
  StockMovement,
  StockRow,
  TodayStats
} from './types'

export interface Api {
  items: {
    /** Exact barcode match among active items. */
    lookup(code: string): Item | null
    search(q: string, limit?: number): Item[]
    list(query: ItemListQuery): ItemList
    get(id: number): Item | null
    save(input: ItemInput): Item
    remove(id: number): { deleted: boolean }
    categories(): string[]
    quick(): Item[]
  }
  stock: {
    adjust(input: StockAdjustInput): Item
    history(itemId: number): StockMovement[]
  }
  bills: {
    create(draft: BillDraft): Bill
    list(range: DateRange, q?: string): BillSummary[]
    get(id: number): Bill | null
    last(): Bill | null
    cancel(id: number): Bill
    print(id: number): Promise<PrintResult>
  }
  purchases: {
    create(input: PurchaseInput): Purchase
    list(range: DateRange): PurchaseSummary[]
    get(id: number): Purchase | null
    suppliers(): string[]
  }
  reports: {
    summary(range: DateRange): SalesSummary
    itemSales(range: DateRange): ItemSalesRow[]
    gst(range: DateRange): GstRow[]
    stock(): StockRow[]
    today(): TodayStats
  }
  settings: {
    get(): Settings
    save(patch: Partial<Settings>): Settings
  }
  system: {
    info(): AppInfo
    printers(): Promise<PrinterInfo[]>
    testPrint(): Promise<PrintResult>
    backupNow(): BackupResult
    chooseBackupDir(): Promise<string | null>
    restore(): Promise<{ restored: boolean }>
    openFolder(path: string): Promise<void>
    exportExcel(request: ExportRequest): Promise<{ saved: boolean; path?: string }>
    importPick(): Promise<ImportPreview | null>
    importRun(filePath: string, mapping: ImportMapping, options: ImportOptions): ImportResult
  }
}

/** What the renderer sees: every call is async because it crosses the process boundary. */
export type Remote<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : Remote<T[K]>
}

export type ApiResponse = { ok: true; data: unknown } | { ok: false; error: string }
