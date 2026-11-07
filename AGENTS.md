# AGENTS.md

Guide for AI coding agents working on **Canteen POS**. Humans: see `README.md`.

## What this is

Offline billing + inventory app for one Indian canteen, replacing the paid Marg ERP. One Windows PC,
one cashier (the owner's father, not technical), English-only, no logins. A USB barcode scanner
acts as a keyboard: it types the digits and presses Enter. Receipts go to an 80/58 mm thermal
printer (not bought yet; untested with real hardware). The shop is GST registered (regular vs
composition not confirmed, so it is a setting).

Marg was deliberately **not** reverse engineered. This is an original design. Do not copy Marg's
code, screens or branding.

## Stack

Electron 45 + React 19 + TypeScript 7 (native `tsc`), built with electron-vite 6. SQLite through
Node's built-in `node:sqlite` (no native modules, so the Windows installer builds on a Mac).
Excel via SheetJS, installed from `cdn.sheetjs.com` in `package.json`: leave it, the npm registry
copy is old and has known vulnerabilities. Installer: electron-builder NSIS, unsigned. Tests:
vitest (unit) + Playwright driving the real Electron app (e2e).

## Commands

```sh
npm run dev         # app with live reload
npm run typecheck   # tsc for main/preload/shared/tests and for renderer
npm test            # vitest: arithmetic + real SQLite files in a temp dir
npm run e2e         # builds, then drives the real app like a cashier; screenshots in tests/e2e/output/
npm run dist:win    # dist/Canteen-POS-Setup-<version>.exe (works from macOS)
```

Run `npm run typecheck && npm test && npm run e2e` before saying a change works. For UI changes,
look at the e2e screenshots at 1366x768; the target laptop screen is small.

## Layout

```
src/shared/     types.ts, api.ts (the contract), billing.ts (bill + GST maths), format.ts (money/date)
src/main/       index.ts (window, IPC, backup), api.ts (implements the contract), services/* (SQL),
                db/schema.ts (migrations), receipt.ts (receipt HTML), printing.ts
src/preload/    one generic bridge: window.bridge.invoke(method, args)
src/renderer/   React screens: pages/*, components/*, AppContext, api.ts (typed proxy)
tests/unit/     vitest;  tests/e2e/run.mjs  Playwright
```

## Rules that matter

- **Money is integer paise everywhere** (`salePrice: 2000` = ₹20). Convert only at the UI edge with
  `parseMoney` / `formatMoney`. Never store or add floating-point rupees. Quantities are rounded to
  3 decimals with `round3`.
- **Bill maths lives only in `src/shared/billing.ts`** (`computeBill`). The billing screen and the
  main process both call it, so what is shown always equals what is stored. Do not re-implement it.
- **Stock changes only through `applyStockChange`** (`services/stock.ts`), inside a transaction. It
  updates `items.stock` and appends to `stock_movements`; the two must never disagree.
- **Bills are snapshots.** `bill_items` copy name, price, cost, HSN and GST rate; `bills` copy the
  GST mode. Later item edits must not change old bills. Cancelled bills keep their number and
  return stock; they are never deleted.
- **Items with history are hidden, not deleted** (`removeItem`).
- **Selling is never blocked by stock.** Stock may go negative; the UI only warns, and only for items
  with `trackStock` on (tea/samosa-style items turn it off).
- **Schema changes are append-only migrations** in `src/main/db/schema.ts` (`PRAGMA user_version`).
  The shop already has v0.1.0 databases, so **never edit an existing migration**: add a new array
  entry, and cover it with a test.
- **Adding an endpoint:** add it to the `Api` interface in `src/shared/api.ts`, implement it in
  `src/main/api.ts` (call a service), then use it from the renderer as `await api.group.method()`.
  `resolveMethod` only exposes functions that exist on the `Api` object. Keep all SQL in
  `src/main/services/`, never in the renderer.
- **Dates** are local-time strings (`'YYYY-MM-DD HH:MM:SS'`), not UTC. Bill numbers are
  `<financial year>/<n>` (e.g. `2026-27/1`), restarting each April.
- **The scan box is the heart of the UI** (`components/ItemSearch.tsx`). It must stay focused,
  handle Enter/Tab as scan end, queue scans in order, and never lose a digit. Keep the keyboard flow
  working (F1-F6 pages, F12 pay, F8 discount, F9 reprint). New dialogs use `components/Modal` so
  `isModalOpen()` stops page shortcuts, and focus moves into the dialog on open.
- The unsaved bill is persisted in `localStorage` (`canteen.cart.v1`) so a crash or power cut
  does not lose it. Restoring a backup clears it.
- **Theme is a tricolour palette defined as CSS variables** at the top of `styles.css` (navy,
  saffron, India green). Saffron is too light for white text (2.1:1): use it only for accents,
  borders and fills with dark text. Do not draw the national flag, the Ashoka Chakra or the state
  emblem in the UI or on receipts; colours only. Receipts stay pure black on white (thermal paper).
- Keep text plain and friendly: the cashier is not technical. UI strings are English only.
- React types: use `SubmitEvent`, not the deprecated `FormEvent`.

## Testing safely

The app reads the real shop database from the user-data folder. **Anything that launches the app
must set `CANTEEN_DATA_DIR` (and `CANTEEN_BACKUP_DIR`) to a temp folder**, as `tests/e2e/run.mjs`
does, or it will touch real data. To test a packaged build:
`E2E_EXECUTABLE="dist/mac-arm64/Canteen POS.app/Contents/MacOS/Canteen POS" node tests/e2e/run.mjs`.
Service tests open a fresh SQLite file per test; follow that pattern rather than mocking the database.

## Releasing

Bump `version` in `package.json`, `npm run dist:win`, then attach `dist/Canteen-POS-Setup-<version>.exe`
to a GitHub Release. Never commit `dist/`, `out/` or `node_modules/` (the installer is over GitHub's
100 MB file limit). Auto-update is off (`publish: null`); the installer is copied to the shop PC by
hand, and installing over an old version keeps the data.

## Not done yet / open questions

- Customer credit (udhaar), cashier logins, barcode label printing, B2B GST invoices: not built.
- No per-bill price override on the billing screen (price comes from the item).
- Printing is verified only through the on-screen preview. Real thermal-printer behaviour
  (paper size, cutter, driver quirks) is untested; `Settings > Use the printer's own paper size`
  is the fallback.
- Not confirmed with the owner: regular vs composition GST.
- The installer is unsigned, so Windows shows a SmartScreen warning.
