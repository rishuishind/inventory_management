import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toLocalDate, toLocalDateTime } from '@shared/format'
import type { BackupResult } from '@shared/types'
import { type DB, SCHEMA_VERSION, schemaVersion } from '../db/database'

const DAILY_BACKUP = /^canteen-backup-\d{4}-\d{2}-\d{2}\.db$/

/** One file per day (later backups the same day replace it), keeping the last `keep` days. */
export function backupDatabase(db: DB, dir: string, now = new Date(), keep = 60): BackupResult {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `canteen-backup-${toLocalDate(now)}.db`)
  writeSnapshot(db, file)
  pruneBackups(dir, keep)
  return { path: file, at: toLocalDateTime(now) }
}

/** Consistent copy of the live database (safe while the app is running). */
export function writeSnapshot(db: DB, file: string): void {
  const tmp = `${file}.tmp`
  fs.rmSync(tmp, { force: true })
  db.prepare('VACUUM INTO ?').run(tmp)
  fs.renameSync(tmp, file)
}

export function pruneBackups(dir: string, keep: number): void {
  const daily = fs
    .readdirSync(dir)
    .filter((f) => DAILY_BACKUP.test(f))
    .sort()
    .reverse()
  for (const old of daily.slice(keep)) fs.rmSync(path.join(dir, old), { force: true })
}

/** Check that a file really is one of our databases before restoring it. */
export function inspectBackup(file: string): { items: number; bills: number } {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(file, { readOnly: true })
  } catch {
    throw new Error('Could not open this file as a Canteen POS backup.')
  }
  try {
    const version = schemaVersion(db)
    if (version < 1) throw new Error('This file is not a Canteen POS backup.')
    if (version > SCHEMA_VERSION) throw new Error('This backup is from a newer version of Canteen POS.')
    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    return { items: count('items'), bills: count('bills') }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Canteen POS')) throw err
    throw new Error('This file is not a Canteen POS backup.')
  } finally {
    db.close()
  }
}
