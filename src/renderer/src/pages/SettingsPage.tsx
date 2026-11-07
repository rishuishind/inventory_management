import { AlertTriangle, FolderOpen, HardDriveDownload, Printer, RotateCcw, Save } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { displayDate } from '@shared/format'
import type { AppInfo, GstMode, PrinterInfo, Settings } from '@shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../AppContext'
import { useToast } from '../components/Toast'

const GST_MODES: { mode: GstMode; title: string; text: string }[] = [
  { mode: 'regular', title: 'Regular GST', text: 'Receipt is a Tax Invoice showing CGST and SGST.' },
  {
    mode: 'composition',
    title: 'Composition scheme',
    text: 'Receipt is a Bill of Supply. No tax is shown or collected.'
  },
  { mode: 'none', title: 'Not registered', text: 'Plain bill without GST.' }
]

const ZOOMS = [0.9, 1, 1.1, 1.25, 1.4]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function SettingsPage() {
  const { settings, setSettings } = useApp()
  const toast = useToast()
  const [form, setForm] = useState<Settings>(settings)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(settings)

  const loadInfo = (): void => {
    api.system.info().then(setInfo, () => {})
  }

  useEffect(() => {
    loadInfo()
    api.system.printers().then(setPrinters, () => {})
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => setForm((f) => ({ ...f, [key]: value }))

  async function save(): Promise<void> {
    setBusy(true)
    try {
      const { lastBackupAt: _ignored, ...patch } = form
      const saved = await api.settings.save(patch)
      setSettings(saved)
      setForm(saved)
      loadInfo()
      toast('Settings saved', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await action()
      if (done) toast(done, 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  async function backupNow(): Promise<void> {
    await run(async () => {
      const result = await api.system.backupNow()
      const fresh = await api.settings.get()
      setSettings(fresh)
      setForm((f) => ({ ...f, lastBackupAt: fresh.lastBackupAt }))
      loadInfo()
      toast(`Backup saved: ${result.path}`, 'success')
    })
  }

  async function chooseFolder(): Promise<void> {
    const dir = await api.system.chooseBackupDir()
    if (dir) set('backupDir', dir)
  }

  return (
    <div className="page settings">
      <header className="page-head">
        <h1>Settings</h1>
        <div className="page-actions">
          {dirty && (
            <button type="button" className="btn" onClick={() => setForm(settings)}>
              <RotateCcw size={16} /> Undo changes
            </button>
          )}
          <button type="button" className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>
            <Save size={16} /> Save settings
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <Section title="Shop details (printed on the receipt)">
          <div className="stack">
            <label>
              Shop name
              <input value={form.shopName} onChange={(e) => set('shopName', e.target.value)} />
            </label>
            <label>
              Address
              <textarea rows={2} value={form.shopAddress} onChange={(e) => set('shopAddress', e.target.value)} />
            </label>
            <div className="form-row">
              <label>
                Phone
                <input value={form.shopPhone} onChange={(e) => set('shopPhone', e.target.value)} />
              </label>
              <label>
                GSTIN
                <input
                  value={form.gstin}
                  onChange={(e) => set('gstin', e.target.value.toUpperCase())}
                  placeholder="15 characters"
                  className="mono"
                />
              </label>
            </div>
            <label>
              Message at the bottom of the receipt
              <input value={form.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} />
            </label>
          </div>
        </Section>

        <Section title="GST">
          <div className="stack">
            <div className="choice-cards">
              {GST_MODES.map((g) => (
                <button
                  key={g.mode}
                  type="button"
                  className={`choice ${form.gstMode === g.mode ? 'on' : ''}`}
                  onClick={() => set('gstMode', g.mode)}
                >
                  <b>{g.title}</b>
                  <span>{g.text}</span>
                </button>
              ))}
            </div>
            {form.gstMode === 'regular' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.pricesIncludeGst}
                  onChange={(e) => set('pricesIncludeGst', e.target.checked)}
                />
                Item prices already include GST (MRP). Untick if GST should be added on top.
              </label>
            )}
            <label className="narrow">
              GST % for new items
              <input
                value={form.defaultGstRate}
                onChange={(e) => set('defaultGstRate', Number(e.target.value) || 0)}
                inputMode="decimal"
              />
            </label>
            <p className="muted small">Not sure which GST type applies to your canteen? Ask your CA once.</p>
          </div>
        </Section>

        <Section title="Billing">
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={form.roundOff} onChange={(e) => set('roundOff', e.target.checked)} />
              Round the bill total to the nearest rupee
            </label>
            <label className="check">
              <input type="checkbox" checked={form.beep} onChange={(e) => set('beep', e.target.checked)} />
              Beep when an item is scanned
            </label>
            <label className="narrow">
              Text size on screen
              <select value={form.zoom} onChange={(e) => set('zoom', Number(e.target.value))}>
                {ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {Math.round(z * 100)}%
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>

        <Section title="Receipt printer">
          <div className="stack">
            <label>
              Printer
              <select value={form.printerName} onChange={(e) => set('printerName', e.target.value)}>
                <option value="">No printer: show receipt on screen</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                Paper width
                <select value={form.paperWidth} onChange={(e) => set('paperWidth', Number(e.target.value) as 58 | 80)}>
                  <option value={80}>80 mm (3 inch)</option>
                  <option value={58}>58 mm (2 inch)</option>
                </select>
              </label>
              <label>
                Copies
                <select value={form.printCopies} onChange={(e) => set('printCopies', Number(e.target.value))}>
                  {[1, 2, 3].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.autoPrint} onChange={(e) => set('autoPrint', e.target.checked)} />
              Print the receipt automatically when a bill is saved
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.paperFromPrinter}
                onChange={(e) => set('paperFromPrinter', e.target.checked)}
              />
              Use the printer's own paper size (try this if receipts print too small, too wide or cut off)
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="btn"
                disabled={dirty}
                onClick={() => void run(() => api.system.testPrint())}
              >
                <Printer size={16} /> Test print
              </button>
              {dirty && <span className="muted small">Save settings first to test them.</span>}
            </div>
          </div>
        </Section>

        <Section title="Backup">
          <div className="stack">
            {info?.backupError && (
              <div className="alert">
                <AlertTriangle size={18} /> The last automatic backup failed: {info.backupError}
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={form.autoBackup} onChange={(e) => set('autoBackup', e.target.checked)} />
              Back up automatically every day (keeps the last 60 days)
            </label>
            <div className="path-row">
              <span className="muted">Backup folder</span>
              <code>{form.backupDir || info?.backupDir || '…'}</code>
              <button type="button" className="btn sm" onClick={() => void chooseFolder()}>
                Change…
              </button>
              {form.backupDir && (
                <button type="button" className="btn sm" onClick={() => set('backupDir', '')}>
                  Use default
                </button>
              )}
            </div>
            <p className="muted small">
              Tip: choose a pen drive or a Google Drive / OneDrive folder so a copy survives if this computer fails.
            </p>
            <div className="muted">
              Last backup: <b>{settings.lastBackupAt ? displayDate(settings.lastBackupAt) : 'never'}</b>
            </div>
            <div className="row-actions">
              <button type="button" className="btn" disabled={dirty} onClick={() => void backupNow()}>
                <HardDriveDownload size={16} /> Back up now
              </button>
              {info && (
                <button type="button" className="btn" onClick={() => void run(() => api.system.openFolder(info.backupDir))}>
                  <FolderOpen size={16} /> Open backup folder
                </button>
              )}
              <button type="button" className="btn danger-outline" onClick={() => void run(() => api.system.restore())}>
                <RotateCcw size={16} /> Restore from backup…
              </button>
            </div>
          </div>
        </Section>

        <Section title="About">
          <div className="stack small">
            <div>
              Canteen POS version <b>{info?.version}</b>
            </div>
            <div className="path-row">
              <span className="muted">Data file</span>
              <code>{info?.dbPath}</code>
              {info && (
                <button type="button" className="btn sm" onClick={() => void run(() => api.system.openFolder(info.dataDir))}>
                  <FolderOpen size={14} /> Open
                </button>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
