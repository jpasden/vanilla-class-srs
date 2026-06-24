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
      <div className="login-split" style={{ display: 'flex', maxWidth: 960, width: '100%', minHeight: 600 }}>
        <div className="card login-split-panel" style={{ flex: 1, padding: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
        <div
          className="login-split-panel"
          style={{
            flex: 1,
            background: 'var(--color-accent)',
            color: '#fff',
            padding: 40,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            overflowY: 'auto',
          }}
        >
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
            Welcome to Vanilla!
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16, opacity: 0.9 }}>
            <strong>Vanilla Class SRS</strong> is designed to help students regularly
            review the vocabulary that their teachers want them to learn.
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
            Key Features:
          </h2>
          <ul style={{ fontSize: 16, lineHeight: 1.6, opacity: 0.9, paddingLeft: 20, marginBottom: 16 }}>
            <li>Teachers assign vocabulary for students to review</li>
            <li>Students can freely add their own vocabulary, and teachers can see what their own students add</li>
            <li>Students review on their own; teachers can see the stats</li>
            <li>Leaderboards for each class and student streak stats are generated automatically</li>
            <li>
              Rather than "quizzes," Vanilla provides flashcards which students use to
              self-assess their own knowledge
            </li>
            <li>
              Vanilla uses an{' '}
              <a
                href="https://controlaltbackspace.org/spacing-algorithm/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#fff', textDecoration: 'underline' }}
              >
                SRS algorithm
              </a>{' '}
              to automatically select which vocabulary students need to review <em>now</em>
            </li>
          </ul>
          <p style={{ fontSize: 16, lineHeight: 1.6, opacity: 0.9 }}>
            Students, you need to get your login credentials from your teacher. It will
            be your school email address and a unique password.
          </p>
        </div>
      </div>
    </div>
  )
}
