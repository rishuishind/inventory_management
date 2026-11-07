import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { type DB, transaction } from '../db/database'

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export function getSettings(db: DB): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS }
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  for (const { key, value } of rows) {
    if (!(key in DEFAULT_SETTINGS)) continue
    try {
      ;(settings as unknown as Record<string, unknown>)[key] = JSON.parse(value)
    } catch {
      // Ignore a corrupt value and keep the default.
    }
  }
  return settings
}

function clean(patch: Partial<Settings>): Partial<Settings> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`)
    const expected = typeof DEFAULT_SETTINGS[key as keyof Settings]
    if (typeof value !== expected) throw new Error(`Invalid value for ${key}`)
    out[key] = typeof value === 'string' ? value.trim() : value
  }
  const s = out as Partial<Settings>
  if (s.gstin !== undefined) {
    s.gstin = s.gstin.toUpperCase()
    if (s.gstin && !GSTIN.test(s.gstin)) throw new Error('GSTIN should be 15 characters, like 09ABCDE1234F1Z5')
  }
  if (s.gstMode !== undefined && !['regular', 'composition', 'none'].includes(s.gstMode)) {
    throw new Error('Invalid GST type')
  }
  if (s.paperWidth !== undefined && s.paperWidth !== 58 && s.paperWidth !== 80) {
    throw new Error('Paper width must be 58 or 80 mm')
  }
  if (s.defaultGstRate !== undefined && (s.defaultGstRate < 0 || s.defaultGstRate > 100)) {
    throw new Error('Default GST % must be between 0 and 100')
  }
  if (s.printCopies !== undefined) s.printCopies = Math.min(Math.max(Math.round(s.printCopies), 1), 5)
  if (s.zoom !== undefined) s.zoom = Math.min(Math.max(s.zoom, 0.7), 2)
  return s
}

export function saveSettings(db: DB, patch: Partial<Settings>): Settings {
  const values = clean(patch)
  transaction(db, () => {
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    )
    for (const [key, value] of Object.entries(values)) upsert.run(key, JSON.stringify(value))
  })
  return getSettings(db)
}
