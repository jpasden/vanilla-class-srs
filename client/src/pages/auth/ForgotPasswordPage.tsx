import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 400, width: '100%' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Reset Password</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
          Enter your email and we'll send a reset link.
        </p>
        {sent ? (
          <div className="alert alert-success">
            If that email exists, a reset link has been sent. Check your inbox.
          </div>
        ) : (
          <>
            {error && <div className="alert alert-danger">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}
        <p style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
          <Link to="/login">Back to login</Link>
        </p>
      </div>
    </div>
  )
}
