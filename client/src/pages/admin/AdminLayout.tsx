import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import AppShell from '../../components/AppShell'

const navItems = [
  { to: '/admin/study', label: 'Study', disabled: true, disabledReason: 'Coming soon — admin study view is not yet available' },
  { to: '/admin/departments', label: 'Departments' },
  { to: '/admin/subject-grades', label: 'Subject Grades' },
  { to: '/admin/teachers', label: 'Teachers' },
  { to: '/admin/cardsets', label: 'CardSets' },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <AppShell
      roleLabel="Admin"
      userName={user?.name}
      navItems={navItems}
      onSignOut={async () => { await logout(); navigate('/login') }}
    />
  )
}
