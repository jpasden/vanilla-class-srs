import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'

const navItems = [
  { to: '/admin/departments', label: 'Departments' },
  { to: '/admin/subject-grades', label: 'Subject Grades' },
  { to: '/admin/teachers', label: 'Teachers' },
  { to: '/admin/cardsets', label: 'CardSets' },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/Vanilla-card.png" alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
              <div>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16 }}>Vanilla SRS</div>
                <div style={{ fontSize: 11, color: 'var(--color-sidebar-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Admin</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-sidebar-muted)' }}>{user?.name}</div>
          </div>
        </div>
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
