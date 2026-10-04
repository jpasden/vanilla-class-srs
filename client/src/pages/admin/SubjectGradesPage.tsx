import { useState, useRef, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface Department { id: string; name: string }
interface SubjectGrade {
  id: string
  name: string
  department: { id: string; name: string }
  lead: { teacherId: string; membership: { teacher: { user: { name: string; email: string } } } } | null
  _count: { classes: number; teachers: number }
}

export default function AdminSubjectGradesPage() {
  const [showArchived, setShowArchived] = useState(false)
  const { data: sgs, loading, error, reload } = useApi<SubjectGrade[]>(
    () => api.get(`/admin/subject-grades${showArchived ? '?archived=true' : ''}`),
    [showArchived],
  )
  const { data: depts } = useApi<Department[]>(() => api.get('/admin/departments'))
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<SubjectGrade | null>(null)
  const [leadTeacherId, setLeadTeacherId] = useState('')
  const [candidates, setCandidates] = useState<{ teacherId: string; teacher: { user: { name: string; email: string } } }[]>([])
  const candidateRequest = useRef(0)
  const [candidatesReady, setCandidatesReady] = useState(false)
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [name, setName] = useState('')
  const [deptId, setDeptId] = useState('')
  const [archiving, setArchiving] = useState<SubjectGrade | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const openCreate = () => { setName(''); setDeptId(depts?.[0]?.id ?? ''); setFormError(null); setShowCreate(true) }
  const openEdit = async (sg: SubjectGrade) => {
    const request = ++candidateRequest.current
    setEditing(sg); setName(sg.name); setDeptId(sg.department.id); setFormError(null)
    setLeadTeacherId(sg.lead?.teacherId ?? ''); setCandidates([]); setCandidatesLoading(true); setCandidatesReady(false)
    try {
      const detail = await api.get<{ teachers: typeof candidates }>(`/admin/subject-grades/${sg.id}`)
      if (request === candidateRequest.current) { setCandidates(detail.teachers); setCandidatesReady(true) }
    } catch (e) {
      if (request === candidateRequest.current) setFormError(e instanceof ApiError ? e.message : 'Unable to load assigned teachers')
    } finally {
      if (request === candidateRequest.current) setCandidatesLoading(false)
    }
  }
  const closeModal = () => { candidateRequest.current++; setShowCreate(false); setEditing(null) }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await api.patch(`/admin/subject-grades/${editing.id}`, { name, departmentId: deptId, leadTeacherId: leadTeacherId || null })
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

  const handleArchive = async () => {
    if (!archiving) return
    setSaving(true)
    try {
      await api.delete(`/admin/subject-grades/${archiving.id}`)
      setArchiving(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUnarchive = async (sg: SubjectGrade) => {
    try { await api.post(`/admin/subject-grades/${sg.id}/unarchive`); reload() }
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
        {editing && <div className="form-group">
          <label className="form-label" htmlFor="subject-lead">Subject Lead Teacher</label>
          <select id="subject-lead" className="form-select" value={leadTeacherId} onChange={e => setLeadTeacherId(e.target.value)} disabled={candidatesLoading || !candidatesReady}>
            <option value="">Unassigned</option>
            {candidates.map(m => <option key={m.teacherId} value={m.teacherId}>{m.teacher.user.name} ({m.teacher.user.email})</option>)}
          </select>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{candidatesLoading ? 'Loading assigned teachers…' : candidates.length ? 'Choose from teachers already assigned to this Subject/Grade. The SL can oversee all its classes.' : 'Add a teacher to this Subject/Grade before choosing an SL.'}</p>
        </div>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || (!!editing && !candidatesReady)}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )

  return (
    <div>
      {modal}
      {archiving && (
        <Modal title="Archive subject grade" onClose={() => setArchiving(null)}>
          <p>
            Archive <strong>{archiving.name}</strong>? It has {archiving._count.classes} class
            {archiving._count.classes !== 1 ? 'es' : ''} under it.
          </p>
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            This cascades: every class under this subject grade is archived too. Nothing is deleted —
            students keep their decks and review history, and you can restore this later from Show
            Archived.
          </div>
          {formError && <div className="alert alert-danger" style={{ marginTop: 12 }}>{formError}</div>}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setArchiving(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={saving} onClick={handleArchive}>{saving ? 'Archiving…' : 'Archive'}</button>
          </div>
        </Modal>
      )}
      <div className="page-header">
        <h1 className="page-title">Subject Grades</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
          {!showArchived && <button className="btn btn-primary" onClick={openCreate}>+ New Subject Grade</button>}
        </div>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {sgs && (
        <div className="card">
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Name</th><th>Department</th><th>Classes</th><th>Teachers</th><th>Subject Lead</th><th style={{ width: 260 }}>Actions</th></tr></thead>
          <tbody>
            {sgs.length === 0 && <tr><td colSpan={6} className="table-empty">{showArchived ? 'No archived subject grades.' : 'No subject grades yet.'}</td></tr>}
            {sgs.map((sg) => (
              <tr key={sg.id}>
                <td><Link to={`/admin/leadership/${sg.id}`}>{sg.name}</Link></td>
                <td>{sg.department.name}</td>
                <td>{sg._count.classes > 0 ? <Link to={`/admin/classes?subjectGradeId=${sg.id}`}>{sg._count.classes}</Link> : 0}</td>
                <td>{sg._count.teachers > 0 ? <Link to="/admin/teachers">{sg._count.teachers}</Link> : 0}</td>
                <td>{sg.lead?.membership.teacher.user.name ?? 'Unassigned'}</td>
                <td>
                  {showArchived ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleUnarchive(sg)}>Unarchive</button>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(sg)} style={{ marginRight: 6 }}>Edit</button>
                      <Link to={`/admin/subject-grades/${sg.id}/batch`} className="btn btn-secondary btn-sm" style={{ marginRight: 6 }}>Batch Ops</Link>
                      <button className="btn btn-danger btn-sm" onClick={() => { setFormError(null); setArchiving(sg) }}>Archive</button>
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
