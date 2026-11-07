// Renders build/icon.svg to build/icon.png (512x512) using Electron itself, so no image tools
// are needed. electron-builder turns the PNG into the Windows .ico. Run: npx electron scripts/make-icon.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

// Keep Chromium's profile out of ~/Library/Application Support (or %APPDATA%).
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteen-icon-'))
app.setPath('userData', profileDir)

const buildDir = path.join(__dirname, '..', 'build')
const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  fs.writeFileSync(path.join(buildDir, 'icon.png'), image.resize({ width: 512, height: 512 }).toPNG())
  console.log('Wrote build/icon.png', image.getSize())
  app.quit()
})

app.on('quit', () => fs.rmSync(profileDir, { recursive: true, force: true }))
