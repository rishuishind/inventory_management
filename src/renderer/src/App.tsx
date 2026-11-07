import { BarChart3, Boxes, type LucideIcon, PackagePlus, ReceiptText, Settings as SettingsIcon, ShoppingCart } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatRupees, plural } from '@shared/format'
import { AppProvider, useApp } from './AppContext'
import { ConfirmProvider } from './components/Confirm'
import { isModalOpen } from './components/Modal'
import { ToastProvider } from './components/Toast'
import { BillingPage } from './pages/billing/BillingPage'
import { BillsPage } from './pages/BillsPage'
import { ItemsPage } from './pages/items/ItemsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StockInPage } from './pages/StockInPage'

type Page = 'billing' | 'items' | 'stockin' | 'bills' | 'reports' | 'settings'

const NAV: { id: Page; label: string; key: string; Icon: LucideIcon }[] = [
  { id: 'billing', label: 'Billing', key: 'F1', Icon: ShoppingCart },
  { id: 'items', label: 'Items', key: 'F2', Icon: Boxes },
  { id: 'stockin', label: 'Stock In', key: 'F3', Icon: PackagePlus },
  { id: 'bills', label: 'Bills', key: 'F4', Icon: ReceiptText },
  { id: 'reports', label: 'Reports', key: 'F5', Icon: BarChart3 },
  { id: 'settings', label: 'Settings', key: 'F6', Icon: SettingsIcon }
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="clock">
      <span>{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      <small>{now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</small>
    </div>
  )
}

function Shell() {
  const { settings, today } = useApp()
  const [page, setPage] = useState<Page>('billing')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = NAV.find((n) => n.key === e.key)
      if (target && !isModalOpen()) {
        e.preventDefault()
        setPage(target.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <ShoppingCart size={20} />
          </div>
          <div>
            <div className="brand-name">{settings.shopName}</div>
            <div className="brand-sub">Canteen POS</div>
          </div>
        </div>
        <ul>
          {NAV.map(({ id, label, key, Icon }) => (
            <li key={id}>
              <button
                type="button"
                className={page === id ? 'active' : ''}
                aria-current={page === id ? 'page' : undefined}
                title={`${label} (${key})`}
                onClick={() => setPage(id)}
              >
                <Icon size={20} />
                <span>{label}</span>
                <kbd>{key}</kbd>
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          <div className="sidebar-today">
            <small>Today</small>
            <b>{formatRupees(today.total)}</b>
            <small>{plural(today.bills, 'bill')}</small>
          </div>
          <Clock />
        </div>
      </nav>
      <main className="content">
        {page === 'billing' && <BillingPage />}
        {page === 'items' && <ItemsPage />}
        {page === 'stockin' && <StockInPage />}
        {page === 'bills' && <BillsPage />}
        {page === 'reports' && <ReportsPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

export function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </AppProvider>
    </ToastProvider>
  )
}
