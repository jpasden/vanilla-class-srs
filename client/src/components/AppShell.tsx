import { ReactNode, useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'

interface NavItem {
  to: string
  label: string
}

interface AppShellProps {
  roleLabel: string
  userName?: string
  navItems: NavItem[]
  /** Extra content rendered between the brand block and the nav links (e.g. class switcher). */
  extra?: ReactNode
  /** Extra content rendered below the nav links, above Change Password / Sign out. */
  footerExtra?: ReactNode
  onSignOut: () => void
}

export default function AppShell({ roleLabel, userName, navItems, extra, footerExtra, onSignOut }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close the drawer on every navigation so it never stays open after picking a link.
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  const renderSidebarContent = (closeButton?: boolean) => (
    <>
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--color-sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <img src="/Vanilla-card.png" alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'var(--text-2xl)', color: 'var(--color-sidebar-text)', flex: 1 }}>Vanilla SRS</div>
          {closeButton && (
            <button
              className="app-drawer-close"
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
            >
              ✕
            </button>
          )}
        </div>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-sidebar-text)' }}>{userName}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-sidebar-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{roleLabel}</div>
      </div>
      {extra}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 8px', gap: 2 }}>
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} className="sidebar-nav-link">
            {item.label}
          </NavLink>
        ))}
      </div>
      {footerExtra}
      <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <NavLink to="/change-password" className="sidebar-nav-link">Change Password</NavLink>
        <button className="btn btn-secondary btn-sm" onClick={onSignOut}>Sign out</button>
      </div>
    </>
  )

  return (
    <div className="app-layout">
      <button
        className="app-topbar-toggle"
        aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setDrawerOpen((o) => !o)}
      >
        <span className={`hamburger ${drawerOpen ? 'is-open' : ''}`}>
          <span /><span /><span />
        </span>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'var(--text-lg)' }}>Vanilla SRS</span>
      </button>

      <nav className="app-sidebar" style={{ background: 'var(--color-sidebar-bg)', color: 'var(--color-sidebar-text)' }}>
        {renderSidebarContent()}
      </nav>

      {drawerOpen && (
        <div className="app-drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <nav
            className="app-drawer"
            style={{ background: 'var(--color-sidebar-bg)', color: 'var(--color-sidebar-text)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderSidebarContent(true)}
          </nav>
        </div>
      )}

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
