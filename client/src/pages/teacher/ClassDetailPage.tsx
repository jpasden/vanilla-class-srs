import { useState, useRef, FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'
import { CsvImportModal } from '../../components/CsvImportModal'
import { downloadPasswordSheet, printPasswordSlips } from '../../utils/passwordSheet'
import ClassStatsPanel from './ClassStatsPanel'

interface Class {
  id: string; name: string
  subjectGrade: { name: string; department: { name: string } }
  _count: { enrollments: number; assignments: number }
}
interface Enrollment {
  id: string
  student: { id: string; user: { name: string; email: string } }
  deck: { id: string; _count: { instances: number } } | null
}
interface CardSet { id: string; name: string; status: string; _count: { cards: number } }
interface Assignment {
  id: string; type: string; priority: number
  cardSet: { id: string; name: string; status: string; _count: { cards: number } }
}
interface HomeworkReq {
  id: string; sessionsRequired: number; minCardsPerSession: number
  periodDays: number; alertThresholdDays: number; activeFrom: string
  cardSets: { id: string; name: string }[]
}

type Tab = 'students' | 'assignments' | 'homework' | 'stats'

interface AssignConfirm {
  cardSetId: string
  cardSetName: string
  type: string
  priority: number
  totalInstances: number
  enrollmentCount: number
}

interface ProgressLine {
  studentName: string
  instancesCreated: number
  completed: number
  total: number
}

export default function TeacherClassDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: cls, loading: clsLoading } = useApi<Class>(() => api.get(`/teachers/classes/${id}`), [id])
  const { data: enrollments, reload: reloadEnrollments } = useApi<Enrollment[]>(() => api.get(`/teachers/classes/${id}/students`), [id])
  const { data: assignments, reload: reloadAssignments } = useApi<Assignment[]>(() => api.get(`/teachers/classes/${id}/assignments`), [id])
  const { data: hw, reload: reloadHw } = useApi<HomeworkReq | null>(() => api.get(`/teachers/classes/${id}/homework`), [id])
  const { data: cardSets } = useApi<CardSet[]>(() => api.get('/teachers/cardsets'))

  const [tab, setTab] = useState<Tab>('students')
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [showImportStudents, setShowImportStudents] = useState(false)
  const [showAddAssignment, setShowAddAssignment] = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState<Assignment | null>(null)
  const [unenrollConfirm, setUnenrollConfirm] = useState<Enrollment | null>(null)
  const [unenrollTyped, setUnenrollTyped] = useState('')
  const [showHw, setShowHw] = useState(false)
  const [studentForm, setStudentForm] = useState({ email: '', name: '' })
  const [newStudentResult, setNewStudentResult] = useState<{ status: string; tempPassword?: string } | null>(null)
  const [assignForm, setAssignForm] = useState({ cardSetId: '', type: 'MANDATORY', priority: 0 })
  const [hwForm, setHwForm] = useState({ sessionsRequired: 2, cardSetIds: [] as string[] })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [assignConfirm, setAssignConfirm] = useState<AssignConfirm | null>(null)
  const [progressLines, setProgressLines] = useState<ProgressLine[]>([])
  const [progressDone, setProgressDone] = useState(false)
  const [progressError, setProgressError] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const [resetResult, setResetResult] = useState<{ studentName: string; tempPassword: string }[] | null>(null)
  const pendingAssignmentId = useRef<string | null>(null)

  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    setNewStudentResult(null)
    try {
      const result = await api.post<{ status: string; tempPassword?: string }>(`/teachers/classes/${id}/students`, studentForm)
      setNewStudentResult(result)
      reloadEnrollments()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleResetStudentPassword = async (enr: Enrollment) => {
    if (!confirm(`Reset password for ${enr.student.user.name}? They will need the new temp password to log in.`)) return
    try {
      const result = await api.post<{ tempPassword: string }>(`/teachers/classes/${id}/students/${enr.student.id}/reset-password`, {})
      setResetResult([{ studentName: enr.student.user.name, tempPassword: result.tempPassword }])
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed')
    }
  }

  const handleUnenroll = async () => {
    if (!unenrollConfirm) return
    try {
      await api.delete(`/teachers/classes/${id}/students/${unenrollConfirm.student.id}`)
      setUnenrollConfirm(null)
      setUnenrollTyped('')
      reloadEnrollments()
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed')
    }
  }

  const handleResetAllPasswords = async () => {
    const count = enrollments?.length ?? 0
    if (!confirm(`Reset passwords for all ${count} students in this class? They will all need the new temp password to log in.`)) return
    try {
      const result = await api.post<{ results: { studentName: string; tempPassword: string }[]; count: number }>(`/teachers/classes/${id}/reset-passwords`, {})
      setResetResult(result.results)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed')
    }
  }

  const handleAssign = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const result = await api.post<{
        assignmentId: string
        cardSetName: string
        totalInstances: number
        enrollmentCount: number
        needsStream: boolean
      }>(`/teachers/classes/${id}/assignments`, assignForm)

      setShowAddAssignment(false)

      if (result.needsStream) {
        pendingAssignmentId.current = result.assignmentId
        setAssignConfirm({
          cardSetId: assignForm.cardSetId,
          cardSetName: result.cardSetName,
          type: assignForm.type,
          priority: assignForm.priority,
          totalInstances: result.totalInstances,
          enrollmentCount: result.enrollmentCount,
        })
      } else {
        reloadAssignments()
      }
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const openAssignmentStream = (path: string) => {
    setProgressError(false)

    const es = new EventSource(path, { withCredentials: true })

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data) as ProgressLine
      setProgressLines((prev) => [...prev, data])
    })

    es.addEventListener('done', () => {
      setProgressDone(true)
      es.close()
      reloadAssignments()
    })

    es.onerror = () => {
      // A genuine "done" event always arrives before the connection closes,
      // so any error/close here means the connection dropped mid-stream —
      // treating that the same as success (the old bug) told the teacher an
      // assignment finished when only some students actually got the words.
      setProgressDone(true)
      setProgressError(true)
      es.close()
      reloadAssignments()
    }
  }

  const handleConfirmAssign = () => {
    const assignmentId = pendingAssignmentId.current
    if (!assignmentId) return

    setAssignConfirm(null)
    setProgressLines([])
    setProgressDone(false)
    setShowProgress(true)
    openAssignmentStream(`/api/teachers/classes/${id}/assignments/${assignmentId}/progress`)
  }

  const handleResumeAssign = () => {
    const assignmentId = pendingAssignmentId.current
    if (!assignmentId) return

    setProgressDone(false)
    openAssignmentStream(`/api/teachers/classes/${id}/assignments/${assignmentId}/resume`)
  }

  const handleRemoveAssignment = async (keepCards: boolean) => {
    if (!removeConfirm) return
    setSaving(true)
    try {
      const result = await api.delete<{ cardsRemoved: number }>(
        `/teachers/classes/${id}/assignments/${removeConfirm.id}${keepCards ? '?keepCards=true' : ''}`,
      )
      setRemoveConfirm(null)
      reloadAssignments()
      if (result.cardsRemoved > 0) {
        alert(`Removed "${removeConfirm.cardSet.name}" and ${result.cardsRemoved} word${result.cardsRemoved !== 1 ? 's' : ''} from student decks.`)
      }
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveHw = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      await api.post(`/teachers/classes/${id}/homework`, hwForm)
      setShowHw(false)
      reloadHw()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (clsLoading) return <div className="spinner" />

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link to="/teacher/classes" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← Classes</Link>
        <h1 className="page-title" style={{ marginTop: 4 }}>{cls?.name}</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {cls?.subjectGrade.name} · {cls?.subjectGrade.department.name}
        </p>
      </div>

      <div className="tabs">
        {(['students', 'assignments', 'homework', 'stats'] as Tab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Students tab */}
      {tab === 'students' && (
        <div>
          {showAddStudent && (
            <Modal title="Add Student" onClose={() => { setShowAddStudent(false); setNewStudentResult(null) }}>
              <form onSubmit={handleAddStudent}>
                {formError && <div className="alert alert-danger">{formError}</div>}
                {newStudentResult && (
                  <div className="alert alert-success">
                    Student {newStudentResult.status === 'already_enrolled' ? 'already enrolled.' : 'added.'}
                    {newStudentResult.tempPassword && (
                      <> Temp password: <strong style={{ fontFamily: 'monospace' }}>{newStudentResult.tempPassword}</strong></>
                    )}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={studentForm.email} onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input className="form-input" value={studentForm.name} onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })} required />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => { setShowAddStudent(false); setNewStudentResult(null) }}>Close</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add Student'}</button>
                </div>
              </form>
            </Modal>
          )}
          {showImportStudents && (
            <CsvImportModal
              title="Import Students from CSV"
              printLabel={cls?.name ?? ''}
              endpoint={`/teachers/classes/${id}/students/import`}
              onSuccess={() => { setShowImportStudents(false); reloadEnrollments() }}
              onClose={() => setShowImportStudents(false)}
              templateHint='CSV format: name,email — one student per row. Existing users will be enrolled without duplicating their account.'
            />
          )}
          {resetResult && (
            <Modal title={resetResult.length === 1 ? 'Password Reset' : 'Class Passwords Reset'} onClose={() => setResetResult(null)}>
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                {resetResult.length === 1
                  ? <><strong>{resetResult[0].studentName}</strong>'s password has been reset.</>
                  : <><strong>{resetResult.length}</strong> student{resetResult.length !== 1 ? 's' : ''} reset.</>
                }
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  This is the only copy — passwords are hashed on creation and cannot be
                  shown again. {resetResult.length === 1 ? 'This student' : 'Each student'} must change it on first login.
                </div>
                <table className="table" style={{ fontSize: 14 }}>
                  <thead><tr><th>Student</th><th>Temporary password</th></tr></thead>
                  <tbody>
                    {resetResult.map((r, i) => (
                      <tr key={i}>
                        <td>{r.studentName}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: 0.5 }}>{r.tempPassword}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => downloadPasswordSheet(resetResult)}>Download CSV</button>
                  <button className="btn btn-secondary" onClick={() => printPasswordSlips(resetResult, cls?.name ?? '')}>Print slips</button>
                </div>
                <button className="btn btn-primary" onClick={() => setResetResult(null)}>Done</button>
              </div>
            </Modal>
          )}
          {unenrollConfirm && (
            <Modal title="Unenroll student" onClose={() => setUnenrollConfirm(null)}>
              <p>
                Remove <strong>{unenrollConfirm.student.user.name}</strong> ({unenrollConfirm.student.user.email})
                from this class?
              </p>
              <div className="alert alert-info" style={{ marginTop: 12 }}>
                Their deck and review history are kept, not deleted — they'll just stop
                appearing in this class's roster and stats. They can be re-enrolled later
                (e.g. re-importing them by CSV) and will pick up right where they left off.
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">
                  Type <strong>{unenrollConfirm.student.user.name}</strong> to confirm
                </label>
                <input
                  className="form-input"
                  value={unenrollTyped}
                  onChange={(e) => setUnenrollTyped(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setUnenrollConfirm(null)}>Cancel</button>
                <button
                  className="btn btn-danger"
                  disabled={unenrollTyped.trim() !== unenrollConfirm.student.user.name}
                  onClick={handleUnenroll}
                >
                  Unenroll
                </button>
              </div>
            </Modal>
          )}
          <div className="page-header" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => { setFormError(null); setNewStudentResult(null); setStudentForm({ email: '', name: '' }); setShowAddStudent(true) }}>+ Add Student</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImportStudents(true)}>Import CSV</button>
              {enrollments && enrollments.length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={handleResetAllPasswords}>Reset All Passwords</button>
              )}
            </div>
          </div>
          <div className="card">
          <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Cards in Deck</th><th>Actions</th></tr></thead>
            <tbody>
              {!enrollments?.length && <tr><td colSpan={4} className="table-empty">No students enrolled.</td></tr>}
              {enrollments?.map((enr) => (
                <tr key={enr.id}>
                  <td><Link to={`/teacher/classes/${id}/students/${enr.student.id}/stats`} state={{ studentName: enr.student.user.name }}>{enr.student.user.name}</Link></td>
                  <td>{enr.student.user.email}</td>
                  <td>{enr.deck?._count.instances ?? 0}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <Link
                      to={`/teacher/classes/${id}/students/${enr.student.id}`}
                      className="btn btn-secondary btn-sm"
                    >View Cards</Link>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleResetStudentPassword(enr)}>Reset Password</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { setUnenrollConfirm(enr); setUnenrollTyped('') }}>Unenroll</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </div>
      )}

      {/* Confirm large assignment modal */}
      {assignConfirm && (
        <Modal title="Confirm Assignment" onClose={() => setAssignConfirm(null)}>
          <p style={{ marginBottom: 16, fontSize: 14 }}>
            Assigning <strong>{assignConfirm.cardSetName}</strong> as{' '}
            <strong>{assignConfirm.type}</strong> will create{' '}
            <strong>{assignConfirm.totalInstances.toLocaleString()} CardInstances</strong> across{' '}
            <strong>{assignConfirm.enrollmentCount} student{assignConfirm.enrollmentCount !== 1 ? 's' : ''}</strong>.
            This may take a moment.
          </p>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setAssignConfirm(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleConfirmAssign}>Confirm &amp; Assign</button>
          </div>
        </Modal>
      )}

      {/* Assignment progress modal */}
      {showProgress && (
        <Modal
          title={progressError ? 'Connection lost' : 'Creating CardInstances…'}
          onClose={() => { if (progressDone) setShowProgress(false) }}
        >
          <div style={{ fontFamily: 'monospace', fontSize: 13, maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
            {progressLines.map((line, i) => (
              <div key={i} style={{ marginBottom: 4, color: 'var(--color-text)' }}>
                <span style={{ marginRight: 8 }}>✓</span>
                <span>
                  {line.instancesCreated} card{line.instancesCreated !== 1 ? 's' : ''} added for{' '}
                  <strong>{line.studentName}</strong>
                  {' '}({line.completed} / {line.total})
                </span>
              </div>
            ))}
            {!progressDone && (
              <div style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>Working…</div>
            )}
          </div>
          {progressError && (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              {(() => {
                const last = progressLines[progressLines.length - 1]
                return last
                  ? `Connection lost after ${last.completed} of ${last.total} students. The rest still need this word list.`
                  : 'Connection lost before any students were updated.'
              })()}
            </div>
          )}
          {progressDone && (
            <div className="modal-footer">
              {progressError ? (
                <>
                  <button className="btn btn-secondary" onClick={() => setShowProgress(false)}>Close</button>
                  <button className="btn btn-primary" onClick={handleResumeAssign}>Resume</button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={() => setShowProgress(false)}>Done</button>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* Assignments tab */}
      {tab === 'assignments' && (
        <div>
          {showAddAssignment && (
            <Modal title="Assign CardSet" onClose={() => setShowAddAssignment(false)}>
              <form onSubmit={handleAssign}>
                {formError && <div className="alert alert-danger">{formError}</div>}
                <div className="form-group">
                  <label className="form-label">CardSet</label>
                  <select className="form-select" value={assignForm.cardSetId} onChange={(e) => setAssignForm({ ...assignForm, cardSetId: e.target.value })} required>
                    <option value="">Select…</option>
                    {cardSets?.map((cs) => <option key={cs.id} value={cs.id}>{cs.name} ({cs._count.cards} cards)</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-select" value={assignForm.type} onChange={(e) => setAssignForm({ ...assignForm, type: e.target.value })}>
                    <option value="MANDATORY">Mandatory</option>
                    <option value="OPTIONAL">Optional</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority (lower = introduced first)</label>
                  <input className="form-input" type="number" min={0} value={assignForm.priority} onChange={(e) => setAssignForm({ ...assignForm, priority: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddAssignment(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Assigning…' : 'Assign'}</button>
                </div>
              </form>
            </Modal>
          )}
          {removeConfirm && (
            <Modal title="Remove assignment" onClose={() => setRemoveConfirm(null)}>
              <p>
                Remove <strong>{removeConfirm.cardSet.name}</strong> ({removeConfirm.cardSet._count.cards}{' '}
                word{removeConfirm.cardSet._count.cards !== 1 ? 's' : ''}) from this class?
              </p>
              <div className="alert alert-danger" style={{ marginTop: 12 }}>
                This will also remove these words and their review history from every student's
                deck in this class. This cannot be undone.
              </div>
              <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => handleRemoveAssignment(true)}
                  title="Unassign, but leave the words already in student decks"
                >
                  Unassign only — keep the words
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saving}
                  onClick={() => handleRemoveAssignment(false)}
                >
                  {saving ? 'Removing…' : 'Remove words from decks'}
                </button>
              </div>
            </Modal>
          )}
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { setFormError(null); setAssignForm({ cardSetId: '', type: 'MANDATORY', priority: 0 }); setShowAddAssignment(true) }}>+ Assign CardSet</button>
          </div>
          <div className="card">
          <div className="table-scroll">
          <table className="table">
            <thead><tr><th>CardSet</th><th>Type</th><th>Priority</th><th>Cards</th><th>Actions</th></tr></thead>
            <tbody>
              {!assignments?.length && <tr><td colSpan={5} className="table-empty">No assignments yet.</td></tr>}
              {assignments?.map((a) => (
                <tr key={a.id}>
                  <td>{a.cardSet.name}</td>
                  <td><span className={`badge badge-${a.type === 'MANDATORY' ? 'blue' : 'yellow'}`}>{a.type}</span></td>
                  <td>{a.priority}</td>
                  <td>{a.cardSet._count.cards}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => setRemoveConfirm(a)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </div>
      )}

      {/* Homework tab */}
      {tab === 'homework' && (
        <div>
          {showHw && (
            <Modal title="Set Homework Requirement" onClose={() => setShowHw(false)}>
              <form onSubmit={handleSaveHw}>
                {formError && <div className="alert alert-danger">{formError}</div>}
                <div className="form-group">
                  <label className="form-label">Sessions required per week</label>
                  <input className="form-input" type="number" min={1} value={hwForm.sessionsRequired} onChange={(e) => setHwForm({ ...hwForm, sessionsRequired: parseInt(e.target.value) || 1 })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Study focus (optional)</label>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                    Leave unchecked to focus on any assigned CardSet — the student's normal queue.
                  </p>
                  {assignments && assignments.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {assignments.map((a) => (
                        <label key={a.cardSet.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                          <input
                            type="checkbox"
                            checked={hwForm.cardSetIds.includes(a.cardSet.id)}
                            onChange={(e) => {
                              const ids = e.target.checked
                                ? [...hwForm.cardSetIds, a.cardSet.id]
                                : hwForm.cardSetIds.filter((id) => id !== a.cardSet.id)
                              setHwForm({ ...hwForm, cardSetIds: ids })
                            }}
                          />
                          {a.cardSet.name} ({a.cardSet._count.cards} cards)
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No CardSets assigned to this class yet.</p>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowHw(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </form>
            </Modal>
          )}
          {hw ? (
            <div className="card" style={{ maxWidth: 440 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Active Requirement</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => { setFormError(null); setHwForm({ sessionsRequired: hw.sessionsRequired, cardSetIds: hw.cardSets.map((cs) => cs.id) }); setShowHw(true) }}>Edit</button>
              </div>
              <table className="table">
                <tbody>
                  <tr><td>Requirement</td><td><strong>{hw.sessionsRequired} session{hw.sessionsRequired !== 1 ? 's' : ''} of {hw.minCardsPerSession} cards per {hw.periodDays === 7 ? 'week' : `${hw.periodDays} days`}</strong></td></tr>
                  <tr><td>Study focus</td><td><strong>{hw.cardSets.length > 0 ? hw.cardSets.map((cs) => cs.name).join(', ') : 'Any assigned cardsets'}</strong></td></tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: 16, fontSize: 14 }}>No homework requirement set for this class.</p>
              <button className="btn btn-primary" onClick={() => { setFormError(null); setHwForm({ sessionsRequired: 2, cardSetIds: [] }); setShowHw(true) }}>Set Requirement</button>
            </div>
          )}
        </div>
      )}

      {/* Stats tab */}
      {tab === 'stats' && id && <ClassStatsPanel classId={id} />}
    </div>
  )
}
