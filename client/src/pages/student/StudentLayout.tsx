import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import { useEnrollment } from '../../utils/enrollment'

const navItems = [
  { to: '/student/review', label: 'Study' },
  { to: '/student/deck', label: 'My Deck' },
  { to: '/student/optional', label: 'Optional Sets' },
  { to: '/student/stats', label: 'Stats' },
]

export default function StudentLayout() {
  const { user, logout } = useAuth()
  const { active, setActive, enrollmentCount } = useEnrollment()
  const navigate = useNavigate()

  return (
    <div className="app-layout">
      <nav className="app-sidebar" style={{
        background: 'var(--color-sidebar-bg)',
        color: 'var(--color-sidebar-text)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--color-sidebar-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <img src="/Vanilla-card.png" alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} />
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'var(--text-2xl)', color: 'var(--color-sidebar-text)' }}>Vanilla SRS</div>
          </div>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-sidebar-text)' }}>{user?.name}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-sidebar-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>Student</div>
        </div>
        {active && (
          <div style={{ padding: '6px 16px', background: 'var(--color-sidebar-well)', fontSize: 'var(--text-xs)' }}>
            <span style={{ color: 'var(--color-sidebar-muted)' }}>Class: </span>
            <span style={{ color: 'var(--color-sidebar-text)', fontWeight: 500 }}>{active.className}</span>
            {enrollmentCount > 1 && (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '0 0 0 8px', textDecoration: 'underline' }}
                onClick={() => { setActive(null); navigate('/student') }}
              >
                Switch
              </button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 8px', gap: 2 }}>
          {active && navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className="sidebar-nav-link">
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
