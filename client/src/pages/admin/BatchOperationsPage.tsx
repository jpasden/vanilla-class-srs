import { useState, FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'

interface SubjectGradeDetail {
  id: string
  name: string
  department: { id: string; name: string }
  teachers: { teacher: { id: string; user: { id: string; name: string; email: string } } }[]
  classes: { id: string; name: string; archivedAt: string | null }[]
}
interface Teacher { id: string; user: { id: string; name: string; email: string } }
interface CardSet {
  id: string; name: string; status: string
  teacher: { id: string; user: { name: string } } | null
  subjectGrade: { id: string; name: string } | null
  _count: { cards: number }
}

interface TeacherResult { teacherId: string; teacherName: string | null; status: 'added' | 'already_assigned' | 'not_found' }
interface ClassResult { name: string; status: 'created' | 'error'; error?: string; classId?: string }
interface ClassTarget { classId: string; className: string; enrollmentCount: number; totalInstances: number }
interface BatchAssignResponse {
  jobId: string | null
  needsStream: boolean
  skipped: { classId: string; className: string }[]
  classes: ClassTarget[]
}
interface ClassProgressLine { studentName: string; className: string; instancesCreated: number; completed: number; total: number }
interface ClassDoneResult { classId: string; className: string; assignmentId: string; expected: number; actual: number; verified: boolean }

export default function AdminBatchOperationsPage() {
  const { id } = useParams<{ id: string }>()
  const { data: sg, loading, error, reload } = useApi<SubjectGradeDetail>(() => api.get(`/admin/subject-grades/${id}`), [id])
  const { data: allTeachers } = useApi<Teacher[]>(() => api.get('/admin/teachers'))
  const { data: cardSets } = useApi<CardSet[]>(() => api.get('/admin/cardsets'))

  // ── Section A: batch add teachers ──────────────────────────────────────
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(new Set())
  const [teacherResults, setTeacherResults] = useState<TeacherResult[] | null>(null)
  const [teacherError, setTeacherError] = useState<string | null>(null)
  const [savingTeachers, setSavingTeachers] = useState(false)

  const assignedTeacherIds = new Set(sg?.teachers.map((t) => t.teacher.id) ?? [])
  const candidateTeachers = allTeachers?.filter((t) => !assignedTeacherIds.has(t.id)) ?? []

  const toggleTeacher = (teacherId: string) => {
    setSelectedTeacherIds((prev) => {
      const next = new Set(prev)
      if (next.has(teacherId)) next.delete(teacherId)
      else next.add(teacherId)
      return next
    })
  }

  const handleAddTeachers = async (e: FormEvent) => {
    e.preventDefault()
    if (selectedTeacherIds.size === 0) return
    setSavingTeachers(true)
    setTeacherError(null)
    setTeacherResults(null)
    try {
      const { results } = await api.post<{ results: TeacherResult[] }>(
        `/admin/subject-grades/${id}/teachers`,
        { teacherIds: [...selectedTeacherIds] },
      )
      setTeacherResults(results)
      setSelectedTeacherIds(new Set())
      reload()
    } catch (e) {
      setTeacherError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSavingTeachers(false)
    }
  }

  // ── Section B: batch add classes ───────────────────────────────────────
  const sgTeachers = sg?.teachers.map((t) => t.teacher) ?? []
  const [classRows, setClassRows] = useState<{ name: string; teacherId: string }[]>([{ name: '', teacherId: '' }])
  const [classResults, setClassResults] = useState<ClassResult[] | null>(null)
  const [classError, setClassError] = useState<string | null>(null)
  const [savingClasses, setSavingClasses] = useState(false)

  const updateClassRow = (i: number, field: 'name' | 'teacherId', value: string) => {
    setClassRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))
  }
  const addClassRow = () => setClassRows((prev) => [...prev, { name: '', teacherId: '' }])
  const removeClassRow = (i: number) => setClassRows((prev) => prev.filter((_, idx) => idx !== i))

  const handleAddClasses = async (e: FormEvent) => {
    e.preventDefault()
    const rows = classRows.filter((r) => r.name.trim() && r.teacherId)
    if (rows.length === 0) return
    setSavingClasses(true)
    setClassError(null)
    setClassResults(null)
    try {
      const { results } = await api.post<{ results: ClassResult[] }>(
        `/admin/subject-grades/${id}/classes`,
        { classes: rows },
      )
      setClassResults(results)
      setClassRows([{ name: '', teacherId: '' }])
      reload()
    } catch (e) {
      setClassError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSavingClasses(false)
    }
  }

  // ── Section C: batch assign CardSet ────────────────────────────────────
  const activeClasses = sg?.classes.filter((c) => !c.archivedAt) ?? []
  const scopedCardSets = cardSets?.filter(
    (cs) => cs.subjectGrade?.id === id || (cs.teacher && sgTeachers.some((t) => t.id === cs.teacher!.id)),
  ) ?? []

  const [assignForm, setAssignForm] = useState({ cardSetId: '', type: 'MANDATORY', priority: 0 })
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string> | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [savingAssign, setSavingAssign] = useState(false)
  const [skippedClasses, setSkippedClasses] = useState<{ classId: string; className: string }[] | null>(null)
  const [classProgress, setClassProgress] = useState<Map<string, { total: number; completed: number; result?: ClassDoneResult }>>(new Map())
  const [assignDone, setAssignDone] = useState(false)
  const [assignStreamError, setAssignStreamError] = useState(false)
  const [showAssignProgress, setShowAssignProgress] = useState(false)

  // Default the class multi-select to "all active classes in this Subject
  // Grade" once they've loaded, per the spec — computed lazily since sg
  // loads asynchronously.
  const effectiveSelectedClassIds = selectedClassIds ?? new Set(activeClasses.map((c) => c.id))

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) => {
      const base = prev ?? new Set(activeClasses.map((c) => c.id))
      const next = new Set(base)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }

  const handleBatchAssign = async (e: FormEvent) => {
    e.preventDefault()
    const classIds = [...effectiveSelectedClassIds]
    if (!assignForm.cardSetId || classIds.length === 0) return
    setSavingAssign(true)
    setAssignError(null)
    setSkippedClasses(null)
    try {
      const result = await api.post<BatchAssignResponse>(`/admin/subject-grades/${id}/batch-assign`, {
        cardSetId: assignForm.cardSetId,
        classIds,
        type: assignForm.type,
        priority: assignForm.priority,
      })
      setSkippedClasses(result.skipped)

      if (!result.needsStream || !result.jobId) {
        if (result.skipped.length > 0 && result.classes.length === 0) {
          setAssignError('Every selected class already has this CardSet assigned.')
        }
        return
      }

      const initial = new Map<string, { total: number; completed: number; result?: ClassDoneResult }>()
      for (const c of result.classes) initial.set(c.classId, { total: c.enrollmentCount, completed: 0 })
      setClassProgress(initial)
      setAssignDone(false)
      setAssignStreamError(false)
      setShowAssignProgress(true)

      const es = new EventSource(`/api/admin/subject-grades/batch-assign/${result.jobId}/progress`, { withCredentials: true })
      // progress events only carry className, not classId, so track which
      // class is currently streaming via classStarted and key progress off that.
      let currentClassId: string | null = null
      es.addEventListener('classStarted', (ev) => {
        const data = JSON.parse(ev.data) as { classId: string; className: string }
        currentClassId = data.classId
      })
      es.addEventListener('progress', (ev) => {
        if (!currentClassId) return
        const data = JSON.parse(ev.data) as ClassProgressLine
        setClassProgress((prev) => {
          const next = new Map(prev)
          const entry = next.get(currentClassId!) ?? { total: data.total, completed: 0 }
          next.set(currentClassId!, { ...entry, total: data.total, completed: data.completed })
          return next
        })
      })
      es.addEventListener('classDone', (ev) => {
        const data = JSON.parse(ev.data) as ClassDoneResult
        setClassProgress((prev) => {
          const next = new Map(prev)
          const entry = next.get(data.classId) ?? { total: data.expected, completed: data.expected }
          next.set(data.classId, { ...entry, result: data })
          return next
        })
      })
      es.addEventListener('done', () => {
        setAssignDone(true)
        es.close()
        reload()
      })
      es.onerror = () => {
        setAssignDone(true)
        setAssignStreamError(true)
        es.close()
        reload()
      }
    } catch (e) {
      setAssignError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSavingAssign(false)
    }
  }

  if (loading) return <div className="spinner" />
  if (error || !sg) return <div className="alert alert-danger">{error ?? 'Subject Grade not found'}</div>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Batch Operations (Admin) — {sg.name}</h1>
        <Link to="/admin/subject-grades" className="btn btn-secondary">Back to Subject Grades</Link>
      </div>

      {/* Section A — Batch Add Teachers */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Add Teachers</h2>
        {candidateTeachers.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>All teachers are already assigned to this Subject Grade.</p>
        ) : (
          <form onSubmit={handleAddTeachers}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, maxHeight: 240, overflowY: 'auto' }}>
              {candidateTeachers.map((t) => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={selectedTeacherIds.has(t.id)} onChange={() => toggleTeacher(t.id)} />
                  {t.user.name} <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{t.user.email}</span>
                </label>
              ))}
            </div>
            {teacherError && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{teacherError}</div>}
            <button type="submit" className="btn btn-primary" disabled={savingTeachers || selectedTeacherIds.size === 0}>
              {savingTeachers ? 'Adding…' : `Add ${selectedTeacherIds.size || ''} Teacher${selectedTeacherIds.size === 1 ? '' : 's'}`}
            </button>
          </form>
        )}
        {teacherResults && (
          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            {teacherResults.map((r) => (
              <li key={r.teacherId}>
                {r.teacherName ?? r.teacherId} —{' '}
                {r.status === 'added' ? 'added' : r.status === 'already_assigned' ? 'already assigned' : 'not found'}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Section B — Batch Add Classes */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Add Classes</h2>
        {sgTeachers.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Add at least one teacher to this Subject Grade first.</p>
        ) : (
          <form onSubmit={handleAddClasses}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {classRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="form-input"
                    placeholder="Class name (e.g. 10AENG 10)"
                    value={row.name}
                    onChange={(e) => updateClassRow(i, 'name', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <select
                    className="form-select"
                    value={row.teacherId}
                    onChange={(e) => updateClassRow(i, 'teacherId', e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Select teacher…</option>
                    {sgTeachers.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
                  </select>
                  {classRows.length > 1 && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeClassRow(i)}>✕</button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addClassRow}>+ Add Row</button>
            </div>
            {classError && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{classError}</div>}
            <button type="submit" className="btn btn-primary" disabled={savingClasses}>
              {savingClasses ? 'Creating…' : 'Create Classes'}
            </button>
          </form>
        )}
        {classResults && (
          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            {classResults.map((r, i) => (
              <li key={i} style={{ color: r.status === 'error' ? 'var(--color-danger)' : undefined }}>
                {r.name} — {r.status === 'created' ? 'created' : `error: ${r.error}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Section C — Batch Assign CardSet */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Assign CardSet to Classes</h2>
        {activeClasses.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Add at least one class to this Subject Grade first.</p>
        ) : scopedCardSets.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No CardSets belong to this Subject Grade or its teachers yet.</p>
        ) : (
          <form onSubmit={handleBatchAssign}>
            <div className="form-group">
              <label className="form-label">CardSet</label>
              <select
                className="form-select"
                value={assignForm.cardSetId}
                onChange={(e) => setAssignForm((f) => ({ ...f, cardSetId: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {scopedCardSets.map((cs) => (
                  <option key={cs.id} value={cs.id}>{cs.name} ({cs._count.cards} cards)</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select
                className="form-select"
                value={assignForm.type}
                onChange={(e) => setAssignForm((f) => ({ ...f, type: e.target.value }))}
              >
                <option value="MANDATORY">Mandatory</option>
                <option value="OPTIONAL">Optional</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Classes</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                {activeClasses.map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={effectiveSelectedClassIds.has(c.id)} onChange={() => toggleClass(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            {assignError && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{assignError}</div>}
            {skippedClasses && skippedClasses.length > 0 && (
              <div className="alert alert-info" style={{ marginBottom: 12 }}>
                Already assigned, skipped: {skippedClasses.map((c) => c.className).join(', ')}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={savingAssign || effectiveSelectedClassIds.size === 0}>
              {savingAssign ? 'Assigning…' : `Assign to ${effectiveSelectedClassIds.size} Class${effectiveSelectedClassIds.size === 1 ? '' : 'es'}`}
            </button>
          </form>
        )}
      </div>

      {showAssignProgress && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>{assignStreamError ? 'Connection lost' : assignDone ? 'Done' : 'Assigning…'}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...classProgress.entries()].map(([classId, p]) => (
              <div key={classId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{p.result ? (p.result.verified ? '✓' : '⚠') : '…'}</span>
                <span>
                  {sg.classes.find((c) => c.id === classId)?.name ?? classId}
                  {' '}
                  {p.result
                    ? p.result.verified
                      ? `— verified (${p.result.actual}/${p.result.expected})`
                      : `— MISMATCH: expected ${p.result.expected}, found ${p.result.actual}`
                    : `— ${p.completed}/${p.total} students`}
                </span>
              </div>
            ))}
          </div>
          {assignStreamError && (
            <div className="alert alert-danger" style={{ marginTop: 12 }}>
              Connection lost partway through. Check each class's CardSets tab and use the existing
              per-class Assign flow to finish any class not marked verified above.
            </div>
          )}
          {assignDone && (
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowAssignProgress(false)}>Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
