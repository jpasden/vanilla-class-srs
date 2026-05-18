import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import { ApiError } from '../../utils/api'

export default function LoginPage() {
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (user && !user.mustChangePassword) {
      if (user.role === 'ADMIN') navigate('/admin/departments', { replace: true })
      else if (user.role === 'TEACHER') navigate('/teacher/classes', { replace: true })
      else navigate('/student', { replace: true })
    }
  }, [user, authLoading, navigate])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      // navigation handled by state change above
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 480, width: '100%', padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="/Vanilla-Class-SRS_title.png"
            alt="Vanilla Class SRS"
            style={{ maxWidth: 220, width: '100%', height: 'auto' }}
          />
        </div>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 28, fontSize: 16, textAlign: 'center' }}>
          Sign in to your account
        </p>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </div>
  )
}
