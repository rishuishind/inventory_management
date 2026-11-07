import { FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import type { ImportField, ImportMapping, ImportPreview, ImportResult } from '@shared/types'
import { api, errorMessage } from '../../api'
import { Modal } from '../../components/Modal'

const FIELDS: { field: ImportField; label: string; required?: boolean }[] = [
  { field: 'name', label: 'Item name', required: true },
  { field: 'salePrice', label: 'Sale price (₹)', required: true },
  { field: 'barcode', label: 'Barcode' },
  { field: 'gstRate', label: 'GST %' },
  { field: 'costPrice', label: 'Cost price (₹)' },
  { field: 'hsn', label: 'HSN code' },
  { field: 'category', label: 'Category' },
  { field: 'unit', label: 'Unit' },
  { field: 'stock', label: 'Stock quantity' },
  { field: 'lowStock', label: 'Low stock alert' }
]

/** 0 -> A, 25 -> Z, 26 -> AA: the column letters Excel shows. */
function columnLetter(index: number): string {
  let s = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function ImportDialog({ onImported, onClose }: { onImported: () => void; onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [updateExisting, setUpdateExisting] = useState(true)
  const [updateStock, setUpdateStock] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(): Promise<void> {
    setError(null)
    setResult(null)
    try {
      const p = await api.system.importPick()
      if (p) {
        setPreview(p)
        setMapping(p.mapping)
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function run(): Promise<void> {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.system.importRun(preview.filePath, mapping, { updateExisting, updateStock }))
      onImported()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const missing = FIELDS.filter((f) => f.required && mapping[f.field] === undefined)
  const shown = FIELDS.filter((f) => mapping[f.field] !== undefined)

  return (
    <Modal
      title="Import items from Excel"
      onClose={onClose}
      width={860}
      footer={
        result ? (
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            {preview && (
              <button
                type="button"
                className="btn primary"
                disabled={busy || missing.length > 0}
                onClick={() => void run()}
              >
                {busy ? 'Importing…' : `Import ${preview.rowCount} rows`}
              </button>
            )}
          </>
        )
      }
    >
      <div className="stack">
        {!preview && (
          <div className="import-start">
            <FileSpreadsheet size={40} strokeWidth={1.4} />
            <p>
              Choose an Excel (.xlsx / .xls) or CSV file with your item list, for example the item list exported
              from Marg to Excel. A heading row with names like Item Name, Barcode, MRP, GST % works best.
            </p>
            <button type="button" className="btn primary" onClick={() => void pick()}>
              Choose file…
            </button>
          </div>
        )}

        {preview && !result && (
          <>
            <div className="muted">
              <b>{preview.fileName}</b> · {preview.rowCount} rows found.{' '}
              <button type="button" className="link" onClick={() => void pick()}>
                Choose another file
              </button>
            </div>
            <p className="muted">Check which column holds each detail. Columns were guessed from the headings.</p>
            <div className="mapping-grid">
              {FIELDS.map(({ field, label, required }) => (
                <label key={field}>
                  {label}
                  {required && ' *'}
                  <select
                    value={mapping[field] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => {
                        const next = { ...m }
                        if (e.target.value === '') delete next[field]
                        else next[field] = Number(e.target.value)
                        return next
                      })
                    }
                  >
                    <option value="">— not in file —</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {columnLetter(i)}: {h || '(no heading)'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {shown.length > 0 && (
              <div className="table-wrap modal-table small">
                <table className="table">
                  <thead>
                    <tr>
                      {shown.map((f) => (
                        <th key={f.field}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.slice(0, 5).map((row, r) => (
                      <tr key={r}>
                        {shown.map((f) => (
                          <td key={f.field}>{row[mapping[f.field]!] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              Update items that already exist (matched by barcode, or by name for items without a barcode)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={updateStock}
                disabled={!updateExisting || mapping.stock === undefined}
                onChange={(e) => setUpdateStock(e.target.checked)}
              />
              Also replace the stock of existing items with the quantity in the file
            </label>
            {missing.length > 0 && (
              <div className="form-error">Choose the column for: {missing.map((f) => f.label).join(', ')}</div>
            )}
          </>
        )}

        {result && (
          <div className="import-result">
            <p>
              <b>{result.created}</b> new items added, <b>{result.updated}</b> updated, <b>{result.skipped}</b> rows
              skipped.
            </p>
            {result.errors.length > 0 && (
              <div className="table-wrap modal-table small">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="num">Excel row</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.slice(0, 100).map((e) => (
                      <tr key={e.row}>
                        <td className="num">{e.row}</td>
                        <td>{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}
