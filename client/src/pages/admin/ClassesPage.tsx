import { useState, FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface SubjectGrade { id: string; name: string; department: { name: string } }
interface Teacher { id: string; user: { id: string; name: string } }
interface Class {
  id: string; name: string
  teacher: { id: string; user: { name: string } }
  subjectGrade: { id: string; name: string }
  _count: { enrollments: number; assignments: number }
}

export default function AdminClassesPage() {
  const [params] = useSearchParams()
  const subjectGradeId = params.get('subjectGradeId') ?? undefined
  const teacherId = params.get('teacherId') ?? undefined

  const [showArchived, setShowArchived] = useState(false)
  const query = new URLSearchParams()
  if (showArchived) query.set('archived', 'true')
  if (subjectGradeId) query.set('subjectGradeId', subjectGradeId)
  if (teacherId) query.set('teacherId', teacherId)

  const { data: classes, loading, error, reload } = useApi<Class[]>(
    () => api.get(`/admin/classes?${query.toString()}`),
    [showArchived, subjectGradeId, teacherId],
  )
  const { data: sgs } = useApi<SubjectGrade[]>(() => api.get('/admin/subject-grades'))
  const { data: teachers } = useApi<Teacher[]>(() => api.get('/admin/teachers'))

  const filteredTeacherName = teacherId ? teachers?.find((t) => t.id === teacherId)?.user.name : undefined
  const filteredSubjectGradeName = subjectGradeId ? sgs?.find((sg) => sg.id === subjectGradeId)?.name : undefined
  const filterLabel = filteredTeacherName ?? filteredSubjectGradeName

  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Class | null>(null)
  const [form, setForm] = useState({ name: '', subjectGradeId: '', teacherId: '' })
  const [archiving, setArchiving] = useState<Class | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const openCreate = () => { setForm({ name: '', subjectGradeId: sgs?.[0]?.id ?? '', teacherId: teachers?.[0]?.id ?? '' }); setFormError(null); setShowCreate(true) }
  const openEdit = (c: Class) => { setEditing(c); setForm({ name: c.name, subjectGradeId: c.subjectGrade.id, teacherId: c.teacher.id }); setFormError(null) }
  const closeModal = () => { setShowCreate(false); setEditing(null) }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await api.patch(`/admin/classes/${editing.id}`, { name: form.name, teacherId: form.teacherId })
      } else {
        await api.post('/admin/classes', form)
      }
      closeModal()
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!archiving) return
    setSaving(true)
    try {
      await api.delete(`/admin/classes/${archiving.id}`)
      setArchiving(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUnarchive = async (c: Class) => {
    try { await api.post(`/admin/classes/${c.id}/unarchive`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  const modal = (showCreate || editing) && (
    <Modal title={editing ? 'Edit Class' : 'New Class'} onClose={closeModal}>
      <form onSubmit={handleSave}>
        {formError && <div className="alert alert-danger">{formError}</div>}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. 11A" />
        </div>
        {!editing && (
          <div className="form-group">
            <label className="form-label">Subject Grade</label>
            <select className="form-select" value={form.subjectGradeId} onChange={(e) => setForm({ ...form, subjectGradeId: e.target.value })} required>
              <option value="">Select…</option>
              {sgs?.map((sg) => <option key={sg.id} value={sg.id}>{sg.name} ({sg.department.name})</option>)}
            </select>
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Teacher</label>
          <select className="form-select" value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} required>
            <option value="">Select…</option>
            {teachers?.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
          </select>
        </div>
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
      {archiving && (
        <Modal title="Archive class" onClose={() => setArchiving(null)}>
          <p>
            Archive <strong>{archiving.name}</strong>? It will disappear from active lists and its teacher
            will no longer see it in "My Classes."
          </p>
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            Nothing is deleted — enrollments, decks, and review history are kept. You can restore this
            class later from Show Archived.
          </div>
          {formError && <div className="alert alert-danger" style={{ marginTop: 12 }}>{formError}</div>}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setArchiving(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={saving} onClick={handleArchive}>{saving ? 'Archiving…' : 'Archive'}</button>
          </div>
        </Modal>
      )}
      <div className="page-header">
        <h1 className="page-title">Classes{filterLabel ? ` - ${filterLabel}` : ''}{subjectGradeId || teacherId ? ' (filtered)' : ''}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
          {!showArchived && <button className="btn btn-primary" onClick={openCreate}>+ New Class</button>}
        </div>
      </div>
      {(subjectGradeId || teacherId) && (
        <p style={{ marginBottom: 16 }}><Link to="/admin/classes">Clear filter</Link></p>
      )}
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {classes && (
        <div className="card">
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Name</th><th>Subject Grade</th><th>CardSets</th><th>Teacher</th><th>Students</th><th style={{ width: 160 }}>Actions</th></tr></thead>
          <tbody>
            {classes.length === 0 && <tr><td colSpan={6} className="table-empty">{showArchived ? 'No archived classes.' : 'No classes yet.'}</td></tr>}
            {classes.map((c) => (
              <tr key={c.id}>
                <td>{showArchived ? c.name : <Link to={`/admin/classes/${c.id}`}>{c.name}</Link>}</td>
                <td>{c.subjectGrade.name}</td>
                <td>{c._count.assignments}</td>
                <td>{c.teacher.user.name}</td>
                <td>{c._count.enrollments}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  {showArchived ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleUnarchive(c)}>Unarchive</button>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => { setFormError(null); setArchiving(c) }}>Archive</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </div>
      )}
    </div>
  )
}
