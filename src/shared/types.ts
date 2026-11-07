// Domain types shared by the main process (database) and the renderer (screens).
// Money is always stored as integer paise; quantities are numbers rounded to 3 decimals.

export type GstMode = 'regular' | 'composition' | 'none'
export type PaymentMode = 'cash' | 'upi' | 'card'

export interface Item {
  id: number
  name: string
  barcode: string | null
  category: string
  unit: string
  salePrice: number
  costPrice: number
  gstRate: number
  hsn: string
  stock: number
  lowStock: number
  /** False for things made in the canteen (tea, samosa): no stock warnings. */
  trackStock: boolean
  /** Pinned as a quick button on the billing screen (tea, samosa, ...). */
  quick: boolean
  active: boolean
}

export interface ItemInput {
  id?: number
  name: string
  barcode: string | null
  category: string
  unit: string
  salePrice: number
  costPrice: number
  gstRate: number
  hsn: string
  /** Only used when creating an item. Later changes go through stock in / adjust. */
  openingStock?: number
  lowStock: number
  trackStock: boolean
  quick: boolean
  active: boolean
}

export type ItemFilter = 'all' | 'low' | 'out' | 'quick' | 'inactive'

export interface ItemListQuery {
  q?: string
  filter?: ItemFilter
  category?: string
  limit?: number
  offset?: number
}

export interface ItemList {
  rows: Item[]
  total: number
}

export interface BillLineInput {
  itemId: number
  qty: number
  /** Unit price in paise, as shown on the billing screen. */
  price: number
}

export interface BillDraft {
  lines: BillLineInput[]
  discount: number
  paymentMode: PaymentMode
  /** Cash handed over by the customer (paise), used to show change on the receipt. */
  tendered: number | null
}

export interface BillLine {
  id: number
  itemId: number | null
  name: string
  barcode: string | null
  hsn: string
  unit: string
  qty: number
  price: number
  costPrice: number
  amount: number
  discount: number
  gstRate: number
  taxable: number
  tax: number
}

export type BillStatus = 'paid' | 'cancelled'

export interface BillSummary {
  id: number
  billNo: string
  createdAt: string
  itemCount: number
  total: number
  paymentMode: PaymentMode
  status: BillStatus
}

export interface Bill extends BillSummary {
  subtotal: number
  discount: number
  taxable: number
  cgst: number
  sgst: number
  roundOff: number
  tendered: number | null
  cancelledAt: string | null
  /** Snapshot of the GST settings when the bill was made, so reprints look the same. */
  gstMode: GstMode
  pricesIncludeGst: boolean
  lines: BillLine[]
}

export interface PurchaseLineInput {
  itemId: number
  qty: number
  costPrice: number
  /** New selling price; updates the item when it differs. */
  salePrice?: number
}

export interface PurchaseInput {
  supplier: string
  invoiceNo: string
  note: string
  lines: PurchaseLineInput[]
}

export interface PurchaseSummary {
  id: number
  createdAt: string
  supplier: string
  invoiceNo: string
  itemCount: number
  total: number
}

export interface PurchaseLine {
  itemId: number
  name: string
  qty: number
  costPrice: number
  amount: number
}

export interface Purchase extends PurchaseSummary {
  note: string
  lines: PurchaseLine[]
}

export type MovementReason = 'opening' | 'sale' | 'sale_cancel' | 'purchase' | 'adjust'

export interface StockAdjustInput {
  itemId: number
  /** 'set' = counted stock is exactly qty, 'add' = add qty (negative removes). */
  mode: 'set' | 'add'
  qty: number
  reason: string
}

export interface StockMovement {
  id: number
  createdAt: string
  change: number
  balance: number
  reason: MovementReason
  refId: number | null
  refLabel: string | null
  note: string
}

/** Inclusive date range, 'YYYY-MM-DD'. */
export interface DateRange {
  from: string
  to: string
}

export interface DaySales {
  date: string
  bills: number
  total: number
  cash: number
  upi: number
  card: number
}

export interface SalesSummary {
  bills: number
  cancelled: number
  subtotal: number
  discount: number
  taxable: number
  cgst: number
  sgst: number
  roundOff: number
  total: number
  cash: number
  upi: number
  card: number
  /** Cost of goods sold, from the cost price recorded on each bill line. */
  cost: number
  days: DaySales[]
}

export interface ItemSalesRow {
  itemId: number | null
  name: string
  unit: string
  qty: number
  sales: number
  taxable: number
  cost: number
}

export interface GstRow {
  rate: number
  taxable: number
  cgst: number
  sgst: number
}

export interface StockRow extends Item {
  stockValue: number
}

export interface TodayStats {
  bills: number
  total: number
}

export interface Settings {
  shopName: string
  shopAddress: string
  shopPhone: string
  gstin: string
  gstMode: GstMode
  pricesIncludeGst: boolean
  defaultGstRate: number
  roundOff: boolean
  beep: boolean
  receiptFooter: string
  /** Windows printer name. Empty = no printer, show a preview instead. */
  printerName: string
  paperWidth: 58 | 80
  /** Let the printer driver pick the paper size (for drivers that mishandle custom sizes). */
  paperFromPrinter: boolean
  /** Print the receipt as soon as a bill is saved. */
  autoPrint: boolean
  printCopies: number
  zoom: number
  /** Empty = Documents/Canteen POS Backups. */
  backupDir: string
  autoBackup: boolean
  lastBackupAt: string
}

export const DEFAULT_SETTINGS: Settings = {
  shopName: 'My Canteen',
  shopAddress: '',
  shopPhone: '',
  gstin: '',
  gstMode: 'regular',
  pricesIncludeGst: true,
  defaultGstRate: 5,
  roundOff: true,
  beep: true,
  receiptFooter: 'Thank you! Visit again.',
  printerName: '',
  paperWidth: 80,
  paperFromPrinter: false,
  autoPrint: false,
  printCopies: 1,
  zoom: 1,
  backupDir: '',
  autoBackup: true,
  lastBackupAt: ''
}

export interface PrinterInfo {
  name: string
  displayName: string
}

export interface PrintResult {
  /** 'printed' = sent to printer, 'preview' = preview window opened. */
  mode: 'printed' | 'preview'
}

export interface BackupResult {
  path: string
  at: string
}

export interface AppInfo {
  version: string
  dataDir: string
  dbPath: string
  backupDir: string
  /** Set when the last automatic backup failed, so Settings can warn about it. */
  backupError: string | null
}

export type ImportField =
  | 'name'
  | 'barcode'
  | 'salePrice'
  | 'costPrice'
  | 'gstRate'
  | 'hsn'
  | 'category'
  | 'unit'
  | 'stock'
  | 'lowStock'

/** Column index in the sheet for each of our fields. */
export type ImportMapping = Partial<Record<ImportField, number>>

export interface ImportPreview {
  filePath: string
  fileName: string
  headers: string[]
  sample: string[][]
  rowCount: number
  mapping: ImportMapping
}

export interface ImportOptions {
  updateExisting: boolean
  updateStock: boolean
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: { row: number; reason: string }[]
}

export type ExportCell = string | number | null

export interface ExportRequest {
  defaultName: string
  sheets: { name: string; rows: ExportCell[][] }[]
}
