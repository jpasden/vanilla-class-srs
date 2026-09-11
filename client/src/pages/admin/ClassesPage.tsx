import React, { useState, useMemo, FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { useAuth } from '../../utils/auth'
import { Modal } from '../../components/Modal'

interface SubjectGrade { id: string; name: string; department: { name: string } }
interface Teacher { id: string; user: { id: string; name: string } }
interface Class {
  id: string; name: string
  teacher: { id: string; user: { name: string } }
  subjectGrade: { id: string; name: string }
  _count: { enrollments: number; assignments: number }
}

type SortKey = 'name' | 'subjectGrade' | 'assignments' | 'teacher' | 'enrollments'
type SortDir = 'asc' | 'desc'

// Default sort order (unsorted state): by name, matching the API's own
// default ordering — so "no sort applied yet" looks identical to before
// sorting existed.
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'name', dir: 'asc' }

function sortValue(c: Class, key: SortKey): string | number {
  switch (key) {
    case 'name': return c.name
    case 'subjectGrade': return c.subjectGrade.name
    case 'assignments': return c._count.assignments
    case 'teacher': return c.teacher.user.name
    case 'enrollments': return c._count.enrollments
  }
}

function toggleSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: 'asc' }
}

function sortClasses(classes: Class[], sort: { key: SortKey; dir: SortDir }): Class[] {
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...classes].sort((a, b) => {
    const av = sortValue(a, sort.key)
    const bv = sortValue(b, sort.key)
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av).localeCompare(String(bv)) * mul
  })
}

function SortableTh({
  label, sortKey, sort, onSort, style,
}: {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (key: SortKey) => void
  style?: React.CSSProperties
}) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none', ...style }} onClick={() => onSort(sortKey)}>
      {label} {active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )
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

  // "My Classes" — only meaningful if this admin also has a Teacher profile
  // (via "Add Admin as Teacher"). Resolved by matching the logged-in user's
  // id against the teacher list already being fetched above, rather than a
  // separate endpoint.
  const { user } = useAuth()
  const myTeacher = teachers?.find((t) => t.user.id === user?.sub)
  const { data: myClasses, loading: myClassesLoading } = useApi<Class[] | null>(
    () => (myTeacher ? api.get<Class[]>(`/admin/classes?teacherId=${myTeacher.id}`) : Promise.resolve(null)),
    [myTeacher?.id],
  )

  const [allSort, setAllSort] = useState(DEFAULT_SORT)
  const [mySort, setMySort] = useState(DEFAULT_SORT)
  const sortedClasses = useMemo(() => (classes ? sortClasses(classes, allSort) : classes), [classes, allSort])
  const sortedMyClasses = useMemo(() => (myClasses ? sortClasses(myClasses, mySort) : myClasses), [myClasses, mySort])

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
      {myTeacher && !showArchived && !subjectGradeId && !teacherId && (
        <div style={{ marginBottom: 32 }}>
          <div className="page-header">
            <h1 className="page-title">My Classes</h1>
          </div>
          {myClassesLoading && <div className="spinner" />}
          {sortedMyClasses && (
            <div className="card">
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <SortableTh label="Name" sortKey="name" sort={mySort} onSort={(k) => setMySort((s) => toggleSort(s, k))} />
                  <SortableTh label="Subject Grade" sortKey="subjectGrade" sort={mySort} onSort={(k) => setMySort((s) => toggleSort(s, k))} />
                  <SortableTh label="CardSets" sortKey="assignments" sort={mySort} onSort={(k) => setMySort((s) => toggleSort(s, k))} />
                  <SortableTh label="Teacher" sortKey="teacher" sort={mySort} onSort={(k) => setMySort((s) => toggleSort(s, k))} />
                  <SortableTh label="Students" sortKey="enrollments" sort={mySort} onSort={(k) => setMySort((s) => toggleSort(s, k))} />
                  <th style={{ width: 80 }}>Open</th>
                </tr>
              </thead>
              <tbody>
                {sortedMyClasses.length === 0 && <tr><td colSpan={6} className="table-empty">You have no classes of your own.</td></tr>}
                {sortedMyClasses.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/admin/classes/${c.id}`}>{c.name}</Link></td>
                    <td>{c.subjectGrade.name}</td>
                    <td>{c._count.assignments > 0 ? <Link to={`/admin/classes/${c.id}?tab=assignments`}>{c._count.assignments}</Link> : 0}</td>
                    <td>{c.teacher.user.name}</td>
                    <td>{c._count.enrollments}</td>
                    <td><Link to={`/admin/classes/${c.id}`} className="btn btn-secondary btn-sm">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </div>
          )}
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">All Classes{filterLabel ? ` - ${filterLabel}` : ''}{subjectGradeId || teacherId ? ' (filtered)' : ''}</h1>
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
      {sortedClasses && (
        <div className="card">
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <SortableTh label="Name" sortKey="name" sort={allSort} onSort={(k) => setAllSort((s) => toggleSort(s, k))} />
              <SortableTh label="Subject Grade" sortKey="subjectGrade" sort={allSort} onSort={(k) => setAllSort((s) => toggleSort(s, k))} />
              <SortableTh label="CardSets" sortKey="assignments" sort={allSort} onSort={(k) => setAllSort((s) => toggleSort(s, k))} />
              <SortableTh label="Teacher" sortKey="teacher" sort={allSort} onSort={(k) => setAllSort((s) => toggleSort(s, k))} />
              <SortableTh label="Students" sortKey="enrollments" sort={allSort} onSort={(k) => setAllSort((s) => toggleSort(s, k))} />
              <th style={{ width: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedClasses.length === 0 && <tr><td colSpan={6} className="table-empty">{showArchived ? 'No archived classes.' : 'No classes yet.'}</td></tr>}
            {sortedClasses.map((c) => (
              <tr key={c.id}>
                <td>{showArchived ? c.name : <Link to={`/admin/classes/${c.id}`}>{c.name}</Link>}</td>
                <td>{c.subjectGrade.name}</td>
                <td>{c._count.assignments > 0 ? <Link to={`/admin/classes/${c.id}?tab=assignments`}>{c._count.assignments}</Link> : 0}</td>
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
