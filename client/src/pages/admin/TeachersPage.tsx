import { useState, FormEvent, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'
import { formatLastLogin } from '../../utils/formatDate'
import { downloadPasswordSheet, printPasswordSlips } from '../../utils/passwordSheet'

interface SubjectGrade { id: string; name: string; department: { name: string } }
interface Teacher {
  id: string
  user: { id: string; name: string; email: string; role: string; lastLoginAt: string | null }
  subjectGrades: { subjectGrade: SubjectGrade }[]
}

export default function AdminTeachersPage() {
  const { data: teachers, loading, error, reload } = useApi<Teacher[]>(() => api.get('/admin/teachers'))
  const { data: sgs } = useApi<SubjectGrade[]>(() => api.get('/admin/subject-grades'))
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Teacher | null>(null)
  const [showAssign, setShowAssign] = useState<Teacher | null>(null)
  const [promoting, setPromoting] = useState<Teacher | null>(null)
  const [offboarding, setOffboarding] = useState<Teacher | null>(null)
  const [removingSg, setRemovingSg] = useState<{ teacher: Teacher; sg: SubjectGrade } | null>(null)
  const [createdCreds, setCreatedCreds] = useState<{ email: string; tempPassword: string } | null>(null)
  const [resetConfirm, setResetConfirm] = useState<Teacher | null>(null)
  const [resetResult, setResetResult] = useState<{ studentName: string; tempPassword: string } | null>(null)
  const [form, setForm] = useState({ name: '', email: '', subjectGradeIds: [] as string[] })
  const [editForm, setEditForm] = useState({ name: '', email: '' })
  const [assignSgId, setAssignSgId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastLoginSortAsc, setLastLoginSortAsc] = useState<boolean | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const toggleRow = (teacherId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(teacherId)) next.delete(teacherId)
      else next.add(teacherId)
      return next
    })
  }

  // Classic expand-all/collapse-all: if anything is currently collapsed,
  // expand everything; only collapse everything once all rows are already
  // expanded. Computed fresh each click rather than tracked as its own
  // flag, so it can never disagree with the row states it's summarizing.
  const allRowsExpanded = !!teachers?.length && teachers.every((t) => expandedRows.has(t.id))
  const toggleAllRows = () => {
    if (!teachers) return
    setExpandedRows(allRowsExpanded ? new Set() : new Set(teachers.map((t) => t.id)))
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const result = await api.post<{ teacherId: string; tempPassword: string }>('/admin/teachers', form)
      setShowCreate(false)
      setCreatedCreds({ email: form.email, tempPassword: result.tempPassword })
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    setFormError(null)
    try {
      await api.patch(`/admin/teachers/${editing.id}`, editForm)
      setEditing(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleOffboard = async () => {
    if (!offboarding) return
    setSaving(true)
    setFormError(null)
    try {
      await api.delete(`/admin/teachers/${offboarding.id}`)
      setOffboarding(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleResetPassword = async () => {
    if (!resetConfirm) return
    setSaving(true)
    setFormError(null)
    try {
      const result = await api.post<{ teacherName: string; tempPassword: string }>(`/admin/teachers/${resetConfirm.id}/reset-password`, {})
      setResetConfirm(null)
      setResetResult({ studentName: result.teacherName, tempPassword: result.tempPassword })
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handlePromoteAdmin = async () => {
    if (!promoting) return
    setSaving(true)
    try {
      await api.post(`/admin/teachers/${promoting.id}/promote-admin`)
      setPromoting(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
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

  const handleRemoveSg = async () => {
    if (!removingSg) return
    setSaving(true)
    try {
      await api.delete(`/admin/teachers/${removingSg.teacher.id}/subject-grades/${removingSg.sg.id}`)
      setRemovingSg(null)
      reload()
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  // Never-logged-in ("Never") rows sink to the end regardless of sort direction,
  // so unactivated accounts don't jump to the top of a descending sort.
  const sortedTeachers = lastLoginSortAsc === null || !teachers
    ? teachers
    : [...teachers].sort((a, b) => {
        const aAt = a.user.lastLoginAt
        const bAt = b.user.lastLoginAt
        if (!aAt && !bAt) return 0
        if (!aAt) return 1
        if (!bAt) return -1
        return lastLoginSortAsc ? aAt.localeCompare(bAt) : bAt.localeCompare(aAt)
      })

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
            <div className="form-group">
              <label className="form-label">Subject Grades (optional)</label>
              {sgs && sgs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sgs.map((sg) => (
                    <label key={sg.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={form.subjectGradeIds.includes(sg.id)}
                        onChange={(e) => {
                          const ids = e.target.checked
                            ? [...form.subjectGradeIds, sg.id]
                            : form.subjectGradeIds.filter((id) => id !== sg.id)
                          setForm({ ...form, subjectGradeIds: ids })
                        }}
                      />
                      {sg.name} ({sg.department.name})
                    </label>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No subject grades exist yet.</p>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit — ${editing.user.name}`} onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label">Other Actions</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { const t = editing; setEditing(null); setFormError(null); setResetConfirm(t) }}
                >
                  Reset Password
                </button>
                {editing.user.role !== 'ADMIN' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { const t = editing; setEditing(null); setFormError(null); setPromoting(t) }}
                  >
                    Promote to Admin
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => { const t = editing; setEditing(null); setFormError(null); setOffboarding(t) }}
                >
                  Offboard
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
      {offboarding && (
        <Modal title="Offboard teacher" onClose={() => setOffboarding(null)}>
          <p>Remove <strong>{offboarding.user.name}</strong> as a teacher?</p>
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            Their account is kept and demoted to a student role rather than deleted — nothing about
            their login is destroyed. This is blocked if they still have any classes (active or
            archived); reassign those to another teacher first.
          </div>
          {formError && <div className="alert alert-danger" style={{ marginTop: 12 }}>{formError}</div>}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setOffboarding(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={saving} onClick={handleOffboard}>{saving ? 'Offboarding…' : 'Offboard'}</button>
          </div>
        </Modal>
      )}
      {promoting && (
        <Modal title="Promote to Admin" onClose={() => setPromoting(null)}>
          <p>Promote <strong>{promoting.user.name}</strong> to Admin? They will gain full admin access.</p>
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            This cannot be undone from this screen — there's no "demote to teacher" action yet.
          </div>
          {formError && <div className="alert alert-danger" style={{ marginTop: 12 }}>{formError}</div>}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setPromoting(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={handlePromoteAdmin}>{saving ? 'Promoting…' : 'Promote'}</button>
          </div>
        </Modal>
      )}
      {removingSg && (
        <Modal title="Remove subject grade" onClose={() => setRemovingSg(null)}>
          <p>
            Remove <strong>{removingSg.teacher.user.name}</strong> from{' '}
            <strong>{removingSg.sg.name}</strong>?
          </p>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setRemovingSg(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={saving} onClick={handleRemoveSg}>{saving ? 'Removing…' : 'Remove'}</button>
          </div>
        </Modal>
      )}
      {createdCreds && (
        <Modal title="Teacher Created" onClose={() => setCreatedCreds(null)} preventDismiss>
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            Account created for <strong>{createdCreds.email}</strong>.
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>Temporary password:</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{createdCreds.tempPassword}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              This password is shown only once and cannot be recovered — save it now. The teacher must change it on first login.
            </div>
          </div>
          <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => downloadPasswordSheet([{ studentName: createdCreds.email, tempPassword: createdCreds.tempPassword }], 'Teacher')}>Download CSV</button>
              <button className="btn btn-secondary" onClick={() => printPasswordSlips([{ studentName: createdCreds.email, tempPassword: createdCreds.tempPassword }], 'New Teacher')}>Print slip</button>
            </div>
            <button className="btn btn-primary" onClick={() => setCreatedCreds(null)}>Done</button>
          </div>
        </Modal>
      )}
      {resetConfirm && (
        <Modal title="Reset teacher password" onClose={() => setResetConfirm(null)}>
          <p>
            Reset the password for <strong>{resetConfirm.user.name}</strong>? Their current password will
            stop working immediately, and they'll need the new one-time password to log in.
          </p>
          {formError && <div className="alert alert-danger" style={{ marginTop: 12 }}>{formError}</div>}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setResetConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={saving} onClick={handleResetPassword}>{saving ? 'Resetting…' : 'Reset Password'}</button>
          </div>
        </Modal>
      )}
      {resetResult && (
        <Modal title="Password Reset" onClose={() => setResetResult(null)} preventDismiss>
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            <strong>{resetResult.studentName}</strong>'s password has been reset.
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>Temporary password:</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{resetResult.tempPassword}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              This is the only copy — passwords are hashed on creation and cannot be shown again. They must change it on first login.
            </div>
          </div>
          <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => downloadPasswordSheet([resetResult], 'Teacher')}>Download CSV</button>
              <button className="btn btn-secondary" onClick={() => printPasswordSlips([resetResult], 'Password Reset')}>Print slip</button>
            </div>
            <button className="btn btn-primary" onClick={() => setResetResult(null)}>Done</button>
          </div>
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
        <div className="card">
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th style={{ cursor: 'pointer' }} onClick={toggleAllRows}>
                Subject Grades {allRowsExpanded ? '▼' : '▶'}
              </th>
              <th>Classes</th>
              <th style={{ cursor: 'pointer' }} onClick={() => setLastLoginSortAsc((v) => (v === false ? true : false))}>
                Last Login {lastLoginSortAsc === null ? '' : lastLoginSortAsc ? '↑' : '↓'}
              </th>
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedTeachers?.length === 0 && <tr><td colSpan={7} className="table-empty">No teachers yet.</td></tr>}
            {sortedTeachers?.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td>{t.user.name}</td>
                  <td>{t.user.email}</td>
                  <td><span className={`badge badge-${t.user.role === 'ADMIN' ? 'red' : 'blue'}`}>{t.user.role}</span></td>
                  <td>
                    <span style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleRow(t.id)}>
                      {expandedRows.has(t.id) ? '▼' : '▶'} ({t.subjectGrades.length})
                    </span>
                    <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} onClick={() => { setFormError(null); setAssignSgId(''); setShowAssign(t) }}>
                      + SG
                    </button>
                  </td>
                  <td><Link to={`/admin/classes?teacherId=${t.id}`}>View classes</Link></td>
                  <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{formatLastLogin(t.user.lastLoginAt)}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(t); setEditForm({ name: t.user.name, email: t.user.email }); setFormError(null) }}>Edit</button>
                  </td>
                </tr>
                {expandedRows.has(t.id) && (
                  <tr>
                    <td colSpan={3}></td>
                    <td style={{ paddingTop: 4, paddingBottom: 12, verticalAlign: 'top' }}>
                      <ol style={{ margin: 0, paddingLeft: 18, textAlign: 'left' }}>
                        {t.subjectGrades.map((m) => (
                          <li key={m.subjectGrade.id} style={{ marginBottom: 2 }}>
                            <Link to={`/admin/classes?subjectGradeId=${m.subjectGrade.id}`}>{m.subjectGrade.name}</Link>
                            <button
                              onClick={() => setRemovingSg({ teacher: t, sg: m.subjectGrade })}
                              className="badge btn-danger"
                              style={{ border: 'none', cursor: 'pointer', fontWeight: 'bold', marginLeft: 10 }}
                              title="Remove"
                            >✕</button>
                          </li>
                        ))}
                      </ol>
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
        </div>
      )}
    </div>
  )
}
