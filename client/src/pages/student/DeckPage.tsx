import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, downloadBlob } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { useEnrollment } from '../../utils/enrollment'
import { Modal } from '../../components/Modal'

interface CardInstance {
  id: string
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING'
  due: string
  origin: string
  exampleSentence: string | null
  card: {
    word: string
    pos: string | null
    definitionL2: string | null
    definitionL1: string | null
    exampleSentence: string | null
  }
}

interface CardHistory {
  instanceId: string
  word: string
  pos: string | null
  events: { reviewedAt: string; grade: number; responseTimeMs: number | null }[]
}

const stateColors: Record<string, string> = {
  NEW: 'badge-gray',
  LEARNING: 'badge-yellow',
  REVIEW: 'badge-green',
  RELEARNING: 'badge-red',
}

const gradeLabels: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }
const gradeColors: Record<number, string> = { 1: 'var(--color-accent)', 2: 'var(--color-warning)', 3: 'var(--color-accent-alt)', 4: 'var(--color-accent-alt)' }

export default function StudentDeckPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const { data: instances, loading, error, reload } = useApi<CardInstance[]>(
    () => api.get(`/students/deck?enrollmentId=${active?.enrollmentId}`),
    [active?.enrollmentId]
  )
  const [filter, setFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [addModal, setAddModal] = useState(false)
  const [editModal, setEditModal] = useState<CardInstance | null>(null)
  const [historyModal, setHistoryModal] = useState<CardInstance | null>(null)
  const [historyData, setHistoryData] = useState<CardHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [addForm, setAddForm] = useState({ word: '', pos: '', definitionL2: '', definitionL1: '', exampleSentence: '' })
  const [editSentence, setEditSentence] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!active) { navigate('/student'); return null }

  const filtered = (instances ?? []).filter((inst) => {
    const matchState = filter === 'ALL' || inst.state === filter
    const q = search.toLowerCase()
    const matchSearch = !q || inst.card.word.toLowerCase().includes(q)
    return matchState && matchSearch
  })

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!addForm.definitionL2.trim() && !addForm.definitionL1.trim()) {
      setFormError('At least one definition (L1 or L2) is required.'); return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/students/deck/cards', { enrollmentId: active.enrollmentId, ...addForm })
      setAddModal(false)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleEditSentence = async (e: FormEvent) => {
    e.preventDefault()
    if (!editModal) return
    setSaving(true)
    try {
      await api.patch(`/students/deck/cards/${editModal.id}`, { exampleSentence: editSentence })
      setEditModal(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const openHistory = async (inst: CardInstance) => {
    setHistoryModal(inst)
    setHistoryData(null)
    setHistoryLoading(true)
    try {
      const data = await api.get<CardHistory>(
        `/students/deck/cards/${inst.id}/history?enrollmentId=${active.enrollmentId}`
      )
      setHistoryData(data)
    } catch (e) {
      setHistoryData(null)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const blob = await api.get<Blob>(`/students/deck/export?enrollmentId=${active.enrollmentId}`)
      downloadBlob(blob, 'deck-export.csv')
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Export failed')
    }
  }

  return (
    <div>
      {addModal && (
        <Modal title="Add Card to Deck" onClose={() => setAddModal(false)}>
          <form onSubmit={handleAdd}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Word *</label>
              <input className="form-input" value={addForm.word} onChange={(e) => setAddForm({ ...addForm, word: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label">Part of Speech</label>
              <input className="form-input" value={addForm.pos} onChange={(e) => setAddForm({ ...addForm, pos: e.target.value })} placeholder="noun, verb, adj…" />
            </div>
            <div className="form-group">
              <label className="form-label">Definition (L2 — target language)</label>
              <textarea className="form-textarea" value={addForm.definitionL2} onChange={(e) => setAddForm({ ...addForm, definitionL2: e.target.value })} rows={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Definition (L1 — native language)</label>
              <textarea className="form-textarea" value={addForm.definitionL1} onChange={(e) => setAddForm({ ...addForm, definitionL1: e.target.value })} rows={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Example Sentence</label>
              <textarea className="form-textarea" value={addForm.exampleSentence} onChange={(e) => setAddForm({ ...addForm, exampleSentence: e.target.value })} rows={2} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setAddModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add Card'}</button>
            </div>
          </form>
        </Modal>
      )}

      {editModal && (
        <Modal title={`Edit Example — "${editModal.card.word}"`} onClose={() => setEditModal(null)}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            You can personalise the example sentence. Leave blank to use the teacher's version.
          </p>
          <form onSubmit={handleEditSentence}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Example Sentence</label>
              <textarea className="form-textarea" value={editSentence} onChange={(e) => setEditSentence(e.target.value)} rows={3} placeholder={editModal.card.exampleSentence ?? 'No example on card'} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Per-card history modal — §21.2 */}
      {historyModal && (
        <Modal title={`Review History — "${historyModal.card.word}"`} onClose={() => setHistoryModal(null)}>
          {historyLoading && <div className="spinner" />}
          {historyData && (
            <>
              {historyData.events.length === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>No reviews yet for this card.</p>
              ) : (
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr><th>Date</th><th>Grade</th><th>Response Time</th></tr>
                  </thead>
                  <tbody>
                    {historyData.events.map((ev, i) => (
                      <tr key={i}>
                        <td>{new Date(ev.reviewedAt).toLocaleString()}</td>
                        <td>
                          <span style={{ color: gradeColors[ev.grade], fontWeight: 600 }}>
                            {gradeLabels[ev.grade] ?? ev.grade}
                          </span>
                        </td>
                        <td style={{ color: 'var(--color-text-muted)' }}>
                          {ev.responseTimeMs ? `${(ev.responseTimeMs / 1000).toFixed(1)}s` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setHistoryModal(null)}>Close</button>
          </div>
        </Modal>
      )}

      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/Vanilla-deck.png" alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          My Deck
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setAddForm({ word: '', pos: '', definitionL2: '', definitionL1: '', exampleSentence: '' }); setFormError(null); setAddModal(true) }}>+ Add Card</button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input className="form-input" style={{ maxWidth: 200 }} placeholder="Search word…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {['ALL', 'NEW', 'LEARNING', 'REVIEW', 'RELEARNING'].map((s) => (
          <button
            key={s}
            className={`btn btn-sm btn-${filter === s ? 'primary' : 'secondary'}`}
            onClick={() => setFilter(s)}
          >{s}</button>
        ))}
      </div>

      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr><th>Word</th><th>POS</th><th>State</th><th>Due</th><th>Origin</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={6} className="table-empty">No cards match the filter.</td></tr>}
            {filtered.map((inst) => (
              <tr key={inst.id}>
                <td style={{ fontWeight: 500 }}>{inst.card.word}</td>
                <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{inst.card.pos ?? '—'}</td>
                <td><span className={`badge ${stateColors[inst.state]}`}>{inst.state}</span></td>
                <td style={{ fontSize: 12 }}>{inst.state === 'NEW' ? '—' : new Date(inst.due).toLocaleDateString()}</td>
                <td style={{ fontSize: 12 }}>{inst.origin}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => openHistory(inst)}
                  >
                    History
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setEditSentence(inst.exampleSentence ?? ''); setFormError(null); setEditModal(inst) }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
