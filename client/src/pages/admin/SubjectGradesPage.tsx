import { useState, FormEvent } from 'react'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface Department { id: string; name: string }
interface SubjectGrade {
  id: string
  name: string
  department: { id: string; name: string }
  _count: { classes: number; teachers: number }
}

export default function AdminSubjectGradesPage() {
  const { data: sgs, loading, error, reload } = useApi<SubjectGrade[]>(() => api.get('/admin/subject-grades'))
  const { data: depts } = useApi<Department[]>(() => api.get('/admin/departments'))
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<SubjectGrade | null>(null)
  const [name, setName] = useState('')
  const [deptId, setDeptId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const openCreate = () => { setName(''); setDeptId(depts?.[0]?.id ?? ''); setFormError(null); setShowCreate(true) }
  const openEdit = (sg: SubjectGrade) => { setEditing(sg); setName(sg.name); setDeptId(sg.department.id); setFormError(null) }
  const closeModal = () => { setShowCreate(false); setEditing(null) }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await api.patch(`/admin/subject-grades/${editing.id}`, { name, departmentId: deptId })
      } else {
        await api.post('/admin/subject-grades', { name, departmentId: deptId })
      }
      closeModal()
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (sg: SubjectGrade) => {
    if (!confirm(`Archive subject grade "${sg.name}"?`)) return
    try { await api.delete(`/admin/subject-grades/${sg.id}`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  const modal = (showCreate || editing) && (
    <Modal title={editing ? 'Edit Subject Grade' : 'New Subject Grade'} onClose={closeModal}>
      <form onSubmit={handleSave}>
        {formError && <div className="alert alert-danger">{formError}</div>}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. English B HL Grade 12" />
        </div>
        <div className="form-group">
          <label className="form-label">Department</label>
          <select className="form-select" value={deptId} onChange={(e) => setDeptId(e.target.value)} required>
            <option value="">Select…</option>
            {depts?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
      <div className="page-header">
        <h1 className="page-title">Subject Grades</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ New Subject Grade</button>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {sgs && (
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Name</th><th>Department</th><th>Classes</th><th>Teachers</th><th style={{ width: 120 }}>Actions</th></tr></thead>
          <tbody>
            {sgs.length === 0 && <tr><td colSpan={5} className="table-empty">No subject grades yet.</td></tr>}
            {sgs.map((sg) => (
              <tr key={sg.id}>
                <td>{sg.name}</td>
                <td>{sg.department.name}</td>
                <td>{sg._count.classes}</td>
                <td>{sg._count.teachers}</td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(sg)} style={{ marginRight: 6 }}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleArchive(sg)}>Archive</button>
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
