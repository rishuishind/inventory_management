# Canteen POS

Billing and stock software for the canteen. It runs on one Windows PC, works without internet,
uses the USB barcode scanner and prints receipts on a thermal printer. No yearly fee.

## Install on the Windows PC

1. Download `Canteen-POS-Setup-<version>.exe` from this repository's **Releases** page (right-hand
   side of the repo's main page) onto the PC. Only that one file is needed. If you built it
   yourself it is in `dist/` (see "For development").
2. Double-click it. Windows will say **"Windows protected your PC"** because the app is not
   code-signed (signing certificates cost money every year). Click **More info → Run anyway**.
3. Pick the install folder and click **Install**. The app opens, and a **Canteen POS** shortcut
   appears on the desktop. Admin rights are not needed.

To update later, install the new setup file over the old one. Bills and items are kept.
Uninstalling also keeps them.

## First-time setup

1. **Settings (F6)**: shop name, address, phone, GSTIN, receipt message, then **Save settings**.
   - **GST type**: *Regular* prints a Tax Invoice with CGST/SGST. *Composition* prints a Bill of
     Supply with no tax. *Not registered* prints a plain bill. Ask your CA once if unsure.
   - Prices are taken as GST-inclusive (MRP) by default.
2. **Items (F2)**: either **Import from Excel** (export the item list from Marg to Excel first),
   or **New item (Ctrl+N)**. In the item form, click the Barcode box and scan the product.
   - For tea, samosa and anything made in the canteen: leave the barcode empty, untick
     **Track stock** and tick **Show as a quick button**. Name them however you like
     (for example `loose_tea`). Typing part of the name finds them.
3. **Backups**: Settings → Backup → **Change…** and choose a Google Drive / OneDrive folder or a
   pen drive, so a copy survives if the PC fails. The app backs up by itself every day.

## Daily use (for the cashier)

| Key | What it does |
|---|---|
| **Scan** | Adds the item. Scanning it again adds one more. |
| Type a name + **Enter** | Finds items without barcodes (e.g. `tea`). Arrow keys pick from the list. |
| `3*` then scan | Adds 3 at once. |
| **+ / −** | Change quantity of the highlighted line. **Del** removes it, **↑ ↓** move. |
| **F12** | Pay: **F1** Cash, **F2** UPI, **F3** Card, type cash received, **Enter** saves. |
| **F8** | Discount on the bill (`20` = ₹20 off, `10%` = 10% off). |
| **F9** | Reprint the last receipt. |
| F1–F6 | Billing, Items, Stock In, Bills, Reports, Settings. |

- An unknown barcode opens the New item form with the barcode filled in. Fill name and price,
  press Enter, and it goes on the bill.
- Selling is never blocked when stock is zero; the line just shows "Out of stock".
- A bill that is half done is kept even if the app or the PC shuts down.
- **Stock In (F3)** when goods arrive. **Bills (F4)** to find, reprint or cancel a bill
  (cancelled bills keep their number and their items go back into stock).
  **Reports (F5)** for daily sales, cash/UPI/card, item-wise sales, GST and stock value, all
  exportable to Excel.
- Text too small? Settings → **Text size on screen**.
- On some laptops the F-keys need the **Fn** key held down.

## Test checklist for the Windows laptop

1. Install as above. The app should open full-screen.
2. Plug in the scanner, open **Notepad** and scan any product: the digits should appear and the
   cursor should jump to a new line. That means the scanner works as a keyboard, which is all
   the app needs. Then try it in the app.
3. Settings: fill shop details, Save.
4. Items: add 3 items, at least one by scanning into the Barcode box. Add a tea item without
   a barcode (untick Track stock, tick quick button).
5. Billing: scan, scan the same item again, type the tea name, use the quick button,
   F8 discount, F12 → cash 500 → Enter. Check the change shown.
6. The receipt preview opens (no printer yet). Click **Print** → choose **Microsoft Print to PDF**
   to see it as a PDF.
7. Bills (F4): open the bill, Print, then Cancel bill; check the stock went back (Items).
8. Stock In (F3): scan an item, quantity 24, buying price, F12. Check the stock in Items.
9. Reports (F5): numbers should match; **Export to Excel** should open in Excel.
10. Close the app and reopen: everything is still there. `Documents\Canteen POS Backups` has
    today's backup file.
11. Start a bill, then close the app from Task Manager and reopen: the bill is still on screen.

## When the receipt printer arrives

1. Install the printer's Windows driver (from its box or website) and print a Windows test page.
2. Settings → **Receipt printer**: choose it, pick the paper width (80 mm = 3 inch,
   58 mm = 2 inch), **Save settings**, then **Test print**.
3. If the receipt prints too small, too wide or cut off, tick **Use the printer's own paper size**,
   save and test again.
4. Tick **Print the receipt automatically** if every customer should get one. Otherwise tick
   "Print receipt" in the payment window when someone asks for it.

When buying: a USB thermal printer with a Windows driver and an auto-cutter. 80 mm paper is
easier to read than 58 mm.

## Where the data is

| What | Where |
|---|---|
| Database (all items, bills, stock) | `%APPDATA%\Canteen POS\canteen.db` |
| Daily backups (last 60 days) | `Documents\Canteen POS Backups` (or the folder chosen in Settings) |

To move to a new PC: install the app there, then Settings → **Restore from backup…** and pick the
latest backup file. The current data is saved as a separate backup before anything is replaced.

## For development

Needs Node.js 22.12+ (macOS or Windows).

```sh
npm install
npm run dev          # run the app with live reload
npm test             # unit + database tests
npm run e2e          # drives the real app like a cashier, screenshots in tests/e2e/output/
npm run typecheck
npm run dist:win     # builds dist/Canteen-POS-Setup-<version>.exe (works from a Mac too)
```

Bump `version` in `package.json` before building an update.

Using an AI coding agent? Point it at `AGENTS.md` (Claude Code reads `CLAUDE.md`, which imports it).
It has the architecture, the rules that must not be broken and how to test safely.

- Electron 45 + React 19 + TypeScript, built with electron-vite.
- SQLite through Node's built-in `node:sqlite` (part of Electron), so there are no native modules
  to compile and the Windows installer can be built on a Mac.
- Excel import/export with SheetJS.

```
src/shared/     types, API contract, money/date helpers, bill + GST arithmetic
src/main/       Electron main process: database, services, printing, backups
src/preload/    the one bridge between screens and main process
src/renderer/   the screens (React)
tests/unit/     arithmetic and database tests (vitest)
tests/e2e/      end-to-end run of the real app (Playwright)
```

Money is stored as whole paise, never floating-point rupees. Database changes go in a new entry
in `src/main/db/schema.ts`; never edit one that has shipped.
