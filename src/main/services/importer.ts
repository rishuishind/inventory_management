import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { parseMoney, round3, toLocalDateTime } from '@shared/format'
import type { ImportField, ImportMapping, ImportOptions, ImportPreview, ImportResult } from '@shared/types'
import { type DB, transaction } from '../db/database'
import { applyStockChange } from './stock'

type Cell = string | number | boolean | null

/** Header patterns, most specific first. Built for Marg / Tally / Busy style item exports. */
const HEADER_PATTERNS: [ImportField, RegExp][] = [
  ['hsn', /hsn|sac/i],
  ['barcode', /bar\s*code|\bean\b|\bupc\b/i],
  ['gstRate', /gst\s*(%|rate|per)|tax\s*(%|rate)|igst/i],
  ['name', /(item|product)\s*name|^name$/i],
  ['salePrice', /sal(e|es|ing)\s*(price|rate)|^s\.?\s*rate$/i],
  ['costPrice', /(purchase|cost|buying)\s*(price|rate)?|^p\.?\s*rate$/i],
  ['lowStock', /re-?order|min(imum)?\s*(stock|qty|level)|low\s*stock/i],
  ['stock', /closing\s*(stock|qty|quantity|bal)|^closing$|current\s*stock|^stock$|stock\s*(qty|quantity)|^balance(\s*qty)?$/i],
  ['category', /categor|group/i],
  ['unit', /^units?$|uom|unit/i],
  ['name', /description|particulars|^item$|^product$/i],
  ['salePrice', /^rate$|^mrp$|price|mrp/i],
  ['gstRate', /^gst$|^tax$/i],
  ['stock', /^qty$|quantity|stock/i]
]

export function guessMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {}
  const used = new Set<number>()
  for (const [field, pattern] of HEADER_PATTERNS) {
    if (mapping[field] !== undefined) continue
    const col = headers.findIndex((h, i) => !used.has(i) && h !== '' && pattern.test(h))
    if (col >= 0) {
      mapping[field] = col
      used.add(col)
    }
  }
  return mapping
}

/** Excel stores barcodes as numbers; print them without exponents or ".0". */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v)
  return String(v).trim()
}

interface SheetRow {
  /** Row number as Excel shows it, for error messages. */
  rowNo: number
  cells: Cell[]
}

function readRows(filePath: string): SheetRow[] {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet?.['!ref']) throw new Error('The first sheet of this file is empty')
  const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r
  return XLSX.utils
    .sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true })
    .map((cells, i) => ({ rowNo: firstRow + i + 1, cells }))
    .filter((r) => r.cells.some((c) => cellText(c) !== ''))
}

/** Exports often start with a title block; the header row is the one that looks most like headers. */
function findHeaderRow(rows: SheetRow[]): number {
  let best = 0
  let bestScore = -1
  rows.slice(0, 20).forEach((row, i) => {
    const texts = row.cells.map(cellText)
    const score = Object.keys(guessMapping(texts)).length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  return best
}

function parseSheet(filePath: string): { headers: string[]; data: SheetRow[] } {
  const rows = readRows(filePath)
  if (rows.length === 0) throw new Error('The first sheet of this file is empty')
  const headerRow = findHeaderRow(rows)
  return { headers: rows[headerRow].cells.map(cellText), data: rows.slice(headerRow + 1) }
}

export function previewImport(filePath: string): ImportPreview {
  const { headers, data } = parseSheet(filePath)
  return {
    filePath,
    fileName: path.basename(filePath),
    headers,
    sample: data.slice(0, 8).map((r) => headers.map((_, i) => cellText(r.cells[i] ?? ''))),
    rowCount: data.length,
    mapping: guessMapping(headers)
  }
}

function parseNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const paise = parseMoney(cellText(v).replace(/%$/, ''))
  return paise === null ? null : paise / 100
}

function parseGst(v: Cell): number {
  const text = cellText(v)
  const m = /(\d+(?:\.\d+)?)/.exec(text)
  if (!m) return 0
  const n = Number(m[1])
  // A percent-formatted cell holds 0.05 for 5%.
  return typeof v === 'number' && n > 0 && n < 1 ? round3(n * 100) : n
}

export function runImport(
  db: DB,
  filePath: string,
  mapping: ImportMapping,
  options: ImportOptions,
  now = new Date()
): ImportResult {
  if (mapping.name === undefined) throw new Error('Choose which column has the item name')
  if (mapping.salePrice === undefined) throw new Error('Choose which column has the sale price')
  const { data } = parseSheet(filePath)
  const at = toLocalDateTime(now)
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  const get = (row: Cell[], field: ImportField): Cell => {
    const col = mapping[field]
    return col === undefined ? '' : (row[col] ?? '')
  }

  const findByBarcode = db.prepare('SELECT id, stock, barcode FROM items WHERE barcode = ?')
  const findByName = db.prepare(
    'SELECT id, stock, barcode FROM items WHERE name = ? COLLATE NOCASE ORDER BY active DESC, id LIMIT 1'
  )
  const insert = db.prepare(
    `INSERT INTO items (name, barcode, category, unit, sale_price, cost_price, gst_rate, hsn, low_stock,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const update = db.prepare(
    `UPDATE items SET name = ?, barcode = COALESCE(?, barcode), category = CASE WHEN ? = '' THEN category ELSE ? END,
       unit = CASE WHEN ? = '' THEN unit ELSE ? END, sale_price = ?, cost_price = ?, gst_rate = ?,
       hsn = CASE WHEN ? = '' THEN hsn ELSE ? END, low_stock = ?, active = 1, updated_at = ?
     WHERE id = ?`
  )

  transaction(db, () => {
    data.forEach(({ rowNo, cells: row }) => {
      const name = cellText(get(row, 'name'))
      const price = parseNumber(get(row, 'salePrice'))
      if (!name) {
        result.skipped++
        return
      }
      if (price === null || price < 0) {
        result.errors.push({ row: rowNo, reason: `${name}: no valid sale price` })
        result.skipped++
        return
      }
      const barcode = cellText(get(row, 'barcode')) || null
      const category = cellText(get(row, 'category'))
      const unit = cellText(get(row, 'unit')).toLowerCase()
      const hsn = cellText(get(row, 'hsn'))
      const cost = Math.max(parseNumber(get(row, 'costPrice')) ?? 0, 0)
      const gst = mapping.gstRate === undefined ? 0 : parseGst(get(row, 'gstRate'))
      const stock = mapping.stock === undefined ? null : parseNumber(get(row, 'stock'))
      const lowStock = Math.max(parseNumber(get(row, 'lowStock')) ?? 0, 0)
      if (gst < 0 || gst > 100) {
        result.errors.push({ row: rowNo, reason: `${name}: GST % "${cellText(get(row, 'gstRate'))}" is not valid` })
        result.skipped++
        return
      }
      const salePaise = Math.round(price * 100)
      const costPaise = Math.round(cost * 100)

      type Match = { id: number; stock: number; barcode: string | null } | undefined
      let existing = (barcode ? findByBarcode.get(barcode) : undefined) as Match
      if (!existing) {
        const byName = findByName.get(name) as Match
        // Same name but a different barcode is a different product (e.g. another pack size).
        if (byName && !(barcode && byName.barcode && byName.barcode !== barcode)) existing = byName
      }
      if (existing) {
        if (!options.updateExisting) {
          result.skipped++
          return
        }
        update.run(
          name,
          barcode,
          category,
          category,
          unit,
          unit,
          salePaise,
          costPaise,
          gst,
          hsn,
          hsn,
          round3(lowStock),
          at,
          existing.id
        )
        if (options.updateStock && stock !== null) {
          const change = round3(stock - existing.stock)
          if (change !== 0) {
            applyStockChange(db, { itemId: existing.id, change, reason: 'adjust', note: 'Excel import', at })
          }
        }
        result.updated++
        return
      }
      const { lastInsertRowid } = insert.run(
        name,
        barcode,
        category,
        unit || 'pcs',
        salePaise,
        costPaise,
        gst,
        hsn,
        round3(lowStock),
        at,
        at
      )
      if (stock !== null && round3(stock) !== 0) {
        applyStockChange(db, { itemId: Number(lastInsertRowid), change: round3(stock), reason: 'opening', at })
      }
      result.created++
    })
  })
  return result
}
