import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useAuth } from '../../utils/auth'

export default function ChangePasswordPage() {
  const { refresh, user } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    setError(null)
    setLoading(true)
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: password })
      await refresh()
      // After refresh, mustChangePassword will be false — navigate to appropriate home
      if (user?.role === 'ADMIN') navigate('/admin/departments')
      else if (user?.role === 'TEACHER') navigate('/teacher/classes')
      else navigate('/student')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Change failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 400, width: '100%' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Change Password</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
          {user?.mustChangePassword
            ? 'You must set a new password before continuing.'
            : 'Update your password.'}
        </p>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Current Password</label>
            <input
              className="form-input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input
              className="form-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  )
}
