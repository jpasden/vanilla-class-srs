import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface SubjectGrade { id: string; name: string }
interface Class {
  id: string
  name: string
  subjectGrade: { id: string; name: string }
  _count: { enrollments: number }
}

export default function TeacherClassesPage() {
  const { data: classes, loading, error, reload } = useApi<Class[]>(() => api.get('/teachers/classes'))
  const { data: sgs } = useApi<SubjectGrade[]>(() => api.get('/teachers/subject-grades'))
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Class | null>(null)
  const [name, setName] = useState('')
  const [sgId, setSgId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const openCreate = () => { setName(''); setSgId(sgs?.[0]?.id ?? ''); setFormError(null); setShowCreate(true) }
  const openEdit = (c: Class) => { setEditing(c); setName(c.name); setFormError(null) }
  const closeModal = () => { setShowCreate(false); setEditing(null) }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await api.patch(`/teachers/classes/${editing.id}`, { name })
      } else {
        await api.post('/teachers/classes', { name, subjectGradeId: sgId })
      }
      closeModal()
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (c: Class) => {
    if (!confirm(`Archive class "${c.name}"?`)) return
    try { await api.delete(`/teachers/classes/${c.id}`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  const modal = (showCreate || editing) && (
    <Modal title={editing ? 'Rename Class' : 'New Class'} onClose={closeModal}>
      <form onSubmit={handleSave}>
        {formError && <div className="alert alert-danger">{formError}</div>}
        <div className="form-group">
          <label className="form-label">Class Name</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Class 12A" />
        </div>
        {!editing && (
          <div className="form-group">
            <label className="form-label">Subject Grade</label>
            <select className="form-select" value={sgId} onChange={(e) => setSgId(e.target.value)} required>
              <option value="">Select…</option>
              {sgs?.map((sg) => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
            </select>
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )

  return (
    <div>
      {modal}
      <div className="page-header">
        <h1 className="page-title">My Classes</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ New Class</button>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {classes && (
        <div className="grid-2">
          {classes.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No classes yet.</p>}
          {classes.map((c) => (
            <div key={c.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{c.subjectGrade.name}</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                {c._count.enrollments} student{c._count.enrollments !== 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link to={`/teacher/classes/${c.id}`} className="btn btn-primary btn-sm">Open</Link>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Rename</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleArchive(c)}>Archive</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
