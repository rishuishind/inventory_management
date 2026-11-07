import type { ExportCell } from '@shared/types'
import { api, errorMessage } from '../api'

/** Paise -> rupees as a number, so Excel can add the column up. */
export const rupees = (paise: number): number => Math.round(paise) / 100

export async function exportSheets(
  defaultName: string,
  sheets: { name: string; rows: ExportCell[][] }[],
  toast: (text: string, kind?: 'success' | 'error' | 'info') => void
): Promise<void> {
  try {
    const result = await api.system.exportExcel({ defaultName, sheets })
    if (result.saved && result.path) {
      toast(`Saved ${result.path}`, 'success')
      void api.system.openFolder(result.path)
    }
  } catch (err) {
    toast(`Could not save the Excel file: ${errorMessage(err)}`, 'error')
  }
}
