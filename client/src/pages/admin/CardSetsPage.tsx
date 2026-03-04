import { useState } from 'react'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface SubjectGrade { id: string; name: string }
interface CardSet {
  id: string
  name: string
  status: 'PRIVATE' | 'DEPARTMENTAL'
  teacher?: { user: { name: string } }
  subjectGrade?: { name: string }
  _count: { cards: number }
}

export default function AdminCardSetsPage() {
  const { data: css, loading, error, reload } = useApi<CardSet[]>(() => api.get('/admin/cardsets'))
  const { data: sgs } = useApi<SubjectGrade[]>(() => api.get('/admin/subject-grades'))
  const [promoting, setPromoting] = useState<CardSet | null>(null)
  const [sgId, setSgId] = useState('')
  const [promoteError, setPromoteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handlePromote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!promoting) return
    setSaving(true)
    setPromoteError(null)
    try {
      await api.post(`/admin/cardsets/${promoting.id}/promote`, { subjectGradeId: sgId })
      setPromoting(null)
      reload()
    } catch (e) {
      setPromoteError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {promoting && (
        <Modal title={`Promote "${promoting.name}" to Departmental`} onClose={() => setPromoting(null)}>
          <p style={{ fontSize: 14, marginBottom: 16, color: 'var(--color-text-muted)' }}>
            The original teacher retains attribution but loses edit rights. Only admins can edit departmental sets.
          </p>
          <form onSubmit={handlePromote}>
            {promoteError && <div className="alert alert-danger">{promoteError}</div>}
            <div className="form-group">
              <label className="form-label">Assign to Subject Grade</label>
              <select className="form-select" value={sgId} onChange={(e) => setSgId(e.target.value)} required>
                <option value="">Select…</option>
                {sgs?.map((sg) => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
              </select>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setPromoting(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Promoting…' : 'Promote'}</button>
            </div>
          </form>
        </Modal>
      )}
      <div className="page-header">
        <h1 className="page-title">All CardSets</h1>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {css && (
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Cards</th><th>Actions</th></tr></thead>
          <tbody>
            {css.length === 0 && <tr><td colSpan={5} className="table-empty">No cardsets found.</td></tr>}
            {css.map((cs) => (
              <tr key={cs.id}>
                <td>{cs.name}</td>
                <td><span className={`badge badge-${cs.status === 'DEPARTMENTAL' ? 'blue' : 'gray'}`}>{cs.status}</span></td>
                <td>
                  {cs.status === 'DEPARTMENTAL' ? cs.subjectGrade?.name ?? '—' : cs.teacher?.user.name ?? '—'}
                </td>
                <td>{cs._count.cards}</td>
                <td>
                  {cs.status === 'PRIVATE' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setSgId(''); setPromoteError(null); setPromoting(cs) }}
                    >
                      Promote to Departmental
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
