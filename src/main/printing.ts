import { BrowserWindow } from 'electron'

const MICRONS_PER_PX = 25400 / 96

async function load(win: BrowserWindow, html: string): Promise<void> {
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

/**
 * Silent print to a receipt printer. The page is exactly as long as the receipt
 * (plus a little paper feed for the cutter) so no paper is wasted.
 */
export async function printHtml(
  html: string,
  options: { printer: string; paperWidthMm: number; copies: number; paperFromPrinter: boolean }
): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 480, height: 800, webPreferences: { sandbox: true } })
  try {
    await load(win, html)
    const heightPx = (await win.webContents.executeJavaScript('document.documentElement.scrollHeight')) as number
    const height = Math.max(Math.ceil(heightPx * MICRONS_PER_PX) + 8000, 40000)
    // Some cheap thermal drivers mishandle custom sizes; the setting lets the driver decide.
    const size = options.paperFromPrinter
      ? { usePrinterDefaultPageSize: true }
      : { pageSize: { width: options.paperWidthMm * 1000, height } }
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          deviceName: options.printer,
          printBackground: false,
          margins: { marginType: 'none' },
          ...size,
          copies: options.copies
        },
        (success, reason) => (success ? resolve() : reject(new Error(`Printing failed: ${reason}`)))
      )
    })
  } finally {
    win.destroy()
  }
}

/** On-screen receipt with Print / Close buttons, used until a receipt printer is set up. */
export async function previewHtml(html: string, parent: BrowserWindow | null, paperWidthMm: number): Promise<void> {
  const win = new BrowserWindow({
    parent: parent ?? undefined,
    width: paperWidthMm === 58 ? 380 : 460,
    height: 760,
    title: 'Receipt preview',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true }
  })
  win.setMenu(null)
  await load(win, html)
}
