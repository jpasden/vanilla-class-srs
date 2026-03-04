import { useState, FormEvent } from 'react'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface SubjectGrade { id: string; name: string; department: { name: string } }
interface Teacher {
  id: string
  user: { id: string; name: string; email: string; role: string }
  subjectGrades: { subjectGrade: SubjectGrade }[]
}

export default function AdminTeachersPage() {
  const { data: teachers, loading, error, reload } = useApi<Teacher[]>(() => api.get('/admin/teachers'))
  const { data: sgs } = useApi<SubjectGrade[]>(() => api.get('/admin/subject-grades'))
  const [showCreate, setShowCreate] = useState(false)
  const [showAssign, setShowAssign] = useState<Teacher | null>(null)
  const [form, setForm] = useState({ name: '', email: '', subjectGradeIds: [] as string[] })
  const [assignSgId, setAssignSgId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/admin/teachers', form)
      setShowCreate(false)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const handlePromoteAdmin = async (t: Teacher) => {
    if (!confirm(`Promote ${t.user.name} to Admin? They will gain full admin access.`)) return
    try { await api.post(`/admin/teachers/${t.id}/promote-admin`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  const handleAssignSg = async (e: FormEvent) => {
    e.preventDefault()
    if (!showAssign || !assignSgId) return
    setSaving(true)
    try {
      await api.post(`/admin/teachers/${showAssign.id}/subject-grades`, { subjectGradeIds: [assignSgId] })
      setShowAssign(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveSg = async (teacher: Teacher, sgId: string) => {
    if (!confirm('Remove this teacher from the subject grade?')) return
    try {
      await api.delete(`/admin/teachers/${teacher.id}/subject-grades/${sgId}`)
      reload()
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  return (
    <div>
      {showCreate && (
        <Modal title="New Teacher" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}
      {showAssign && (
        <Modal title={`Assign Subject Grade — ${showAssign.user.name}`} onClose={() => setShowAssign(null)}>
          <form onSubmit={handleAssignSg}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Subject Grade</label>
              <select className="form-select" value={assignSgId} onChange={(e) => setAssignSgId(e.target.value)} required>
                <option value="">Select…</option>
                {sgs?.map((sg) => <option key={sg.id} value={sg.id}>{sg.name} ({sg.department.name})</option>)}
              </select>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAssign(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Assigning…' : 'Assign'}</button>
            </div>
          </form>
        </Modal>
      )}
      <div className="page-header">
        <h1 className="page-title">Teachers</h1>
        <button className="btn btn-primary" onClick={() => { setFormError(null); setForm({ name: '', email: '', subjectGradeIds: [] }); setShowCreate(true) }}>
          + New Teacher
        </button>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {teachers && (
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Subject Grades</th><th>Actions</th></tr></thead>
          <tbody>
            {teachers.length === 0 && <tr><td colSpan={5} className="table-empty">No teachers yet.</td></tr>}
            {teachers.map((t) => (
              <tr key={t.id}>
                <td>{t.user.name}</td>
                <td>{t.user.email}</td>
                <td><span className={`badge badge-${t.user.role === 'ADMIN' ? 'red' : 'blue'}`}>{t.user.role}</span></td>
                <td>
                  {t.subjectGrades.map((m) => (
                    <span key={m.subjectGrade.id} style={{ marginRight: 4 }}>
                      <span className="badge badge-gray">{m.subjectGrade.name}</span>
                      <button
                        onClick={() => handleRemoveSg(t, m.subjectGrade.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: 12, marginLeft: 2 }}
                        title="Remove"
                      >✕</button>
                    </span>
                  ))}
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: 4 }} onClick={() => { setFormError(null); setAssignSgId(''); setShowAssign(t) }}>
                    + SG
                  </button>
                </td>
                <td>
                  {t.user.role !== 'ADMIN' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => handlePromoteAdmin(t)}>Promote to Admin</button>
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
