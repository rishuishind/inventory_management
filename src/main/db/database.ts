import { DatabaseSync } from 'node:sqlite'
import { migrations } from './schema'

export type DB = DatabaseSync

export const SCHEMA_VERSION = migrations.length

export function openDatabase(file: string): DB {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  // FULL: a saved bill survives a power cut. Bills are small, so the extra fsync is not noticeable.
  db.exec('PRAGMA synchronous = FULL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}

export function schemaVersion(db: DB): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function migrate(db: DB): void {
  const current = schemaVersion(db)
  if (current > SCHEMA_VERSION) {
    throw new Error('This database was made by a newer version of Canteen POS. Please update the app.')
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    transaction(db, () => {
      db.exec(migrations[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

/** Run fn inside a write transaction; nested calls join the outer transaction. */
export function transaction<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Escape a user search word for LIKE ... ESCAPE '\'. "loose_tea" must not treat _ as a wildcard. */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}
