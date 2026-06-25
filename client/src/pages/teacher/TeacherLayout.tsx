import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import AppShell from '../../components/AppShell'

const navItems = [
  { to: '/teacher/classes', label: 'My Classes' },
  { to: '/teacher/cardsets', label: 'CardSets' },
]

export default function TeacherLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <AppShell
      roleLabel="Teacher"
      userName={user?.name}
      navItems={navItems}
      onSignOut={async () => { await logout(); navigate('/login') }}
    />
  )
}
