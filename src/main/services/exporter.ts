import fs from 'node:fs'
import * as XLSX from 'xlsx'
import type { ExportRequest } from '@shared/types'

export function writeWorkbook(filePath: string, sheets: ExportRequest['sheets']): void {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
    const widths = sheet.rows[0]?.map((_, col) =>
      Math.min(Math.max(...sheet.rows.map((r) => String(r[col] ?? '').length), 6) + 2, 50)
    )
    if (widths) ws['!cols'] = widths.map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31))
  }
  fs.writeFileSync(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}
