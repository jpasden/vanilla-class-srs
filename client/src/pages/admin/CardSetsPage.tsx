import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'
import { cardSetStatusLabel } from '../../utils/cardSetLabels'

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

  const handleDelete = async (cs: CardSet) => {
    if (!confirm(`Delete "${cs.name}"? Students who already have cards from this set keep them and their review history — this just removes the set from active lists and prevents new assignments.`)) return
    try { await api.delete(`/admin/cardsets/${cs.id}`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
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
                <td><Link to={`/admin/cardsets/${cs.id}`}>{cs.name}</Link></td>
                <td><span className={`badge badge-${cs.status === 'DEPARTMENTAL' ? 'blue' : 'gray'}`}>{cardSetStatusLabel(cs.status)}</span></td>
                <td>
                  {cs.status === 'DEPARTMENTAL' ? cs.subjectGrade?.name ?? '—' : cs.teacher?.user.name ?? '—'}
                </td>
                <td>{cs._count.cards}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  {cs.status === 'PRIVATE' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setSgId(''); setPromoteError(null); setPromoting(cs) }}
                    >
                      Promote to Departmental
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(cs)}>Delete</button>
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
