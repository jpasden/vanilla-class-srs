import { useState, FormEvent } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
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
      await api.post('/auth/reset-password', { token, password })
      navigate('/login')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="card" style={{ maxWidth: 400, width: '100%' }}>
          <div className="alert alert-danger">Invalid or missing reset token.</div>
          <Link to="/forgot-password">Request a new reset link</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 400, width: '100%' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Set New Password</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
          Enter your new password below.
        </p>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleSubmit}>
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
            <label className="form-label">Confirm Password</label>
            <input
              className="form-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Saving…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  )
}
