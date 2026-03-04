import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface CardSet {
  id: string
  name: string
  description: string | null
  status: 'PRIVATE' | 'DEPARTMENTAL'
  _count: { cards: number }
}

export default function TeacherCardSetsPage() {
  const { data: css, loading, error, reload } = useApi<CardSet[]>(() => api.get('/teachers/cardsets'))
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/teachers/cardsets', form)
      setShowCreate(false)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (cs: CardSet) => {
    if (!confirm(`Archive "${cs.name}"?`)) return
    try { await api.delete(`/teachers/cardsets/${cs.id}`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  return (
    <div>
      {showCreate && (
        <Modal title="New CardSet" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Unit 3 Vocabulary" />
            </div>
            <div className="form-group">
              <label className="form-label">Description (optional)</label>
              <textarea className="form-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}
      <div className="page-header">
        <h1 className="page-title">CardSets</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', description: '' }); setFormError(null); setShowCreate(true) }}>+ New CardSet</button>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {css && (
        <div className="grid-2">
          {css.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No cardsets yet.</p>}
          {css.map((cs) => (
            <div key={cs.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{cs.name}</div>
                  {cs.description && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{cs.description}</div>}
                </div>
                <span className={`badge badge-${cs.status === 'DEPARTMENTAL' ? 'blue' : 'gray'}`}>{cs.status}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>{cs._count.cards} cards</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Link to={`/teacher/cardsets/${cs.id}`} className="btn btn-primary btn-sm">Manage Cards</Link>
                {cs.status === 'PRIVATE' && (
                  <button className="btn btn-danger btn-sm" onClick={() => handleArchive(cs)}>Archive</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
