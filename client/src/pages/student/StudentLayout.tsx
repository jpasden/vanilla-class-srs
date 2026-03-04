import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import { useEnrollment } from '../../utils/enrollment'

export default function StudentLayout() {
  const { user, logout } = useAuth()
  const { active, setActive } = useEnrollment()
  const navigate = useNavigate()

  const navItems = active ? [
    { to: '/student/deck', label: 'My Deck' },
    { to: '/student/review', label: 'Study' },
    { to: '/student/optional', label: 'Optional Sets' },
    { to: '/student/stats', label: 'Stats' },
  ] : []

  return (
    <div className="app-layout">
      <nav className="app-sidebar" style={{
        background: 'var(--color-sidebar-bg)',
        color: 'var(--color-sidebar-text)',
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-sidebar-border)', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16 }}>Vanilla SRS</div>
              <div style={{ fontSize: 11, color: 'var(--color-sidebar-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Student</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-sidebar-muted)' }}>{user?.name}</div>
          </div>
        </div>
        {active && (
          <div style={{ padding: '6px 16px', background: 'var(--color-sidebar-well)', fontSize: 12, width: '100%' }}>
            <span style={{ color: 'var(--color-sidebar-muted)' }}>Class: </span>
            <span style={{ color: 'var(--color-sidebar-text)', fontWeight: 500 }}>{active.className}</span>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 11, padding: '0 0 0 8px', textDecoration: 'underline' }}
              onClick={() => { setActive(null); navigate('/student') }}
            >
              Switch
            </button>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', padding: '4px 8px', gap: 2, flex: 1 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'block',
                padding: '8px 12px',
                borderRadius: 'var(--radius-pill)',
                color: isActive ? 'var(--color-vanilla)' : 'var(--color-sidebar-muted)',
                background: isActive ? 'var(--color-sidebar-active-bg)' : 'transparent',
                textDecoration: 'none',
                fontFamily: 'var(--font-heading)',
                fontSize: 14,
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <div style={{ padding: '8px 16px' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => { await logout(); navigate('/login') }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
