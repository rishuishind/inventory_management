import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import type { ApiResponse } from '@shared/api'
import { toLocalDate, toLocalDateTime } from '@shared/format'
import type { Settings } from '@shared/types'
import { createApi, resolveMethod } from './api'
import { type DB, openDatabase } from './db/database'
import { backupDatabase, writeSnapshot } from './services/backup'
import { getSettings, saveSettings } from './services/settings'

// Tests point this at a temporary folder; normally data lives in %APPDATA%\Canteen POS.
// The whole browser profile moves too, so a test never sees a real unsaved bill.
if (process.env.CANTEEN_DATA_DIR) app.setPath('userData', process.env.CANTEEN_DATA_DIR)
const dataDir = app.getPath('userData')
const dbPath = path.join(dataDir, 'canteen.db')

let db: DB | null = null
let mainWindow: BrowserWindow | null = null
let backupError: string | null = null
let skipQuitBackup = false

function backupDir(settings: Settings): string {
  return (
    settings.backupDir ||
    process.env.CANTEEN_BACKUP_DIR ||
    path.join(app.getPath('documents'), 'Canteen POS Backups')
  )
}

function runAutoBackup(onlyIfNotToday: boolean): void {
  if (!db) return
  const settings = getSettings(db)
  if (!settings.autoBackup) return
  if (onlyIfNotToday && settings.lastBackupAt.startsWith(toLocalDate(new Date()))) return
  try {
    const result = backupDatabase(db, backupDir(settings))
    saveSettings(db, { lastBackupAt: result.at })
    backupError = null
  } catch (err) {
    backupError = err instanceof Error ? err.message : String(err)
    console.error('Automatic backup failed:', err)
  }
}

function restoreDatabase(file: string): void {
  if (!db) return
  const settings = getSettings(db)
  const dir = backupDir(settings)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = toLocalDateTime(new Date()).replace(/[: ]/g, '-')
  writeSnapshot(db, path.join(dir, `canteen-before-restore-${stamp}.db`))
  db.close()
  db = null
  for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
  fs.copyFileSync(file, dbPath)
  skipQuitBackup = true
  // The unsaved bill on screen may hold items the backup does not have.
  const forgetDraft = session.defaultSession.clearStorageData({ storages: ['localstorage'] }).catch(() => {})
  // Let the IPC reply reach the screen before restarting.
  setTimeout(() => {
    void forgetDraft.finally(() => {
      app.relaunch()
      app.exit(0)
    })
  }, 300)
}

function applyZoom(settings: Settings): void {
  mainWindow?.webContents.setZoomFactor(settings.zoom)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'Canteen POS',
    backgroundColor: '#f3f5f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.webContents.on('did-finish-load', () => {
    if (db) applyZoom(getSettings(db))
  })
  // A crashed screen should never leave the counter stuck on a blank window.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details.reason)
    if (details.reason !== 'clean-exit') win.reload()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  // Ctrl+Shift+I opens developer tools for troubleshooting.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function setMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  // macOS needs an Edit menu for copy/paste shortcuts to work while developing.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
  )
}

function registerApi(): void {
  const api = createApi({
    db: () => {
      if (!db) throw new Error('Database is not open')
      return db
    },
    window: () => mainWindow,
    dataDir,
    dbPath,
    backupDir,
    backupError: () => backupError,
    onSettingsChanged: applyZoom,
    restoreDatabase
  })

  ipcMain.handle('api', async (event, method: unknown, args: unknown): Promise<ApiResponse> => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'Not allowed' }
    if (typeof method !== 'string' || !Array.isArray(args)) return { ok: false, error: 'Bad request' }
    const fn = resolveMethod(api, method)
    if (!fn) return { ok: false, error: `Unknown action: ${method}` }
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      console.error(`${method} failed:`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function start(): void {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    db = openDatabase(dbPath)
  } catch (err) {
    dialog.showErrorBox(
      'Canteen POS could not start',
      `The database could not be opened.\n\n${err instanceof Error ? err.message : String(err)}\n\nFile: ${dbPath}`
    )
    app.exit(1)
    return
  }
  runAutoBackup(true)
  setMenu()
  registerApi()
  createWindow()
}

if (!app.requestSingleInstanceLock()) {
  // Already running (double-clicked twice): the first window is brought to the front instead.
  app.quit()
} else {
  app.setAppUserModelId('com.canteenpos.app')
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    if (!db) return
    if (!skipQuitBackup) runAutoBackup(false)
    db.close()
    db = null
  })
}
