import { useState, FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'
import { CsvImportModal } from '../../components/CsvImportModal'

interface Card {
  id: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null
}
interface CardSet {
  id: string
  name: string
  description: string | null
  status: 'PRIVATE' | 'DEPARTMENTAL'
  cards: Card[]
}

type CardFormData = { word: string; pos: string; definitionL2: string; definitionL1: string; exampleSentence: string }
const emptyForm: CardFormData = { word: '', pos: '', definitionL2: '', definitionL1: '', exampleSentence: '' }

export default function TeacherCardSetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: cs, loading, reload } = useApi<CardSet>(() => api.get(`/teachers/cardsets/${id}`), [id])
  const [editing, setEditing] = useState<Card | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<CardFormData>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [csName, setCsName] = useState('')

  const isEditable = cs?.status === 'PRIVATE'

  const openCreate = () => { setForm(emptyForm); setFormError(null); setCreating(true) }
  const openEdit = (c: Card) => {
    setEditing(c)
    setForm({ word: c.word, pos: c.pos ?? '', definitionL2: c.definitionL2 ?? '', definitionL1: c.definitionL1 ?? '', exampleSentence: c.exampleSentence ?? '' })
    setFormError(null)
  }
  const closeModal = () => { setEditing(null); setCreating(false) }

  const validate = (f: CardFormData) => {
    if (!f.word.trim()) return 'Word is required.'
    if (!f.definitionL2.trim() && !f.definitionL1.trim()) return 'At least one definition (L1 or L2) is required.'
    return null
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    const err = validate(form)
    if (err) { setFormError(err); return }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        word: form.word,
        pos: form.pos || undefined,
        definitionL2: form.definitionL2 || undefined,
        definitionL1: form.definitionL1 || undefined,
        exampleSentence: form.exampleSentence || undefined,
      }
      if (editing) {
        await api.patch(`/teachers/cardsets/${id}/cards/${editing.id}`, payload)
      } else {
        await api.post(`/teachers/cardsets/${id}/cards`, payload)
      }
      closeModal()
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (c: Card) => {
    if (!confirm(`Delete card "${c.word}"? This cannot be undone.`)) return
    try { await api.delete(`/teachers/cardsets/${id}/cards/${c.id}`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  const handleRename = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try { await api.patch(`/teachers/cardsets/${id}`, { name: csName }); setShowRename(false); reload() }
    catch (e) { setFormError(e instanceof ApiError ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="spinner" />

  return (
    <div>
      {(editing || creating) && (
        <Modal title={editing ? `Edit "${editing.word}"` : 'New Card'} onClose={closeModal}>
          <form onSubmit={handleSave}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Word *</label>
              <input className="form-input" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Part of Speech</label>
              <input className="form-input" value={form.pos} onChange={(e) => setForm({ ...form, pos: e.target.value })} placeholder="noun, verb, adj…" />
            </div>
            <div className="form-group">
              <label className="form-label">Definition (L2 — target language)</label>
              <textarea className="form-textarea" value={form.definitionL2} onChange={(e) => setForm({ ...form, definitionL2: e.target.value })} rows={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Definition (L1 — native language)</label>
              <textarea className="form-textarea" value={form.definitionL1} onChange={(e) => setForm({ ...form, definitionL1: e.target.value })} rows={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Example Sentence</label>
              <textarea className="form-textarea" value={form.exampleSentence} onChange={(e) => setForm({ ...form, exampleSentence: e.target.value })} rows={2} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
      {showRename && (
        <Modal title="Rename CardSet" onClose={() => setShowRename(false)}>
          <form onSubmit={handleRename}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">New Name</label>
              <input className="form-input" value={csName} onChange={(e) => setCsName(e.target.value)} required />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowRename(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
      {showImport && (
        <CsvImportModal
          title="Import Cards from CSV"
          endpoint={`/teachers/cardsets/${id}/cards/import`}
          onSuccess={() => { setShowImport(false); reload() }}
          onClose={() => setShowImport(false)}
          templateHint='CSV columns: word,pos,definition_l2,definition_l1,example_sentence — at least one definition required per row.'
        />
      )}

      <div style={{ marginBottom: 20 }}>
        <Link to="/teacher/cardsets" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← CardSets</Link>
        <div className="page-header" style={{ marginTop: 8 }}>
          <div>
            <h1 className="page-title">{cs?.name}</h1>
            {cs?.description && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{cs.description}</p>}
            <span className={`badge badge-${cs?.status === 'DEPARTMENTAL' ? 'blue' : 'gray'}`} style={{ marginTop: 4 }}>{cs?.status}</span>
          </div>
          {isEditable && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setCsName(cs?.name ?? ''); setFormError(null); setShowRename(true) }}>Rename</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}>Import CSV</button>
              <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Add Card</button>
            </div>
          )}
        </div>
      </div>

      <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Word</th><th>POS</th><th>L2 Definition</th><th>L1 Definition</th><th>Example</th>
            {isEditable && <th style={{ width: 100 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {!cs?.cards.length && <tr><td colSpan={6} className="table-empty">No cards yet. Add one or import a CSV.</td></tr>}
          {cs?.cards.map((c) => (
            <tr key={c.id}>
              <td style={{ fontWeight: 500 }}>{c.word}</td>
              <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{c.pos ?? '—'}</td>
              <td style={{ fontSize: 13 }}>{c.definitionL2 ?? '—'}</td>
              <td style={{ fontSize: 13 }}>{c.definitionL1 ?? '—'}</td>
              <td style={{ fontSize: 13 }}>{c.exampleSentence ?? '—'}</td>
              {isEditable && (
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)} style={{ marginRight: 4 }}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
