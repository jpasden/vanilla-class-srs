import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

interface Department {
  id: string
  name: string
  _count: { subjectGrades: number }
}

export default function AdminDepartmentsPage() {
  const navigate = useNavigate()
  const [showArchived, setShowArchived] = useState(false)
  const { data: depts, loading, error, reload } = useApi<Department[]>(
    () => api.get(`/admin/departments${showArchived ? '?archived=true' : ''}`),
    [showArchived],
  )
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [name, setName] = useState('')
  const [archiving, setArchiving] = useState<Department | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const openCreate = () => { setName(''); setFormError(null); setShowCreate(true) }
  const openEdit = (d: Department) => { setEditing(d); setName(d.name); setFormError(null) }
  const closeModal = () => { setShowCreate(false); setEditing(null) }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await api.patch(`/admin/departments/${editing.id}`, { name })
      } else {
        await api.post('/admin/departments', { name })
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
      await api.delete(`/admin/departments/${archiving.id}`)
      setArchiving(null)
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUnarchive = async (d: Department) => {
    try { await api.post(`/admin/departments/${d.id}/unarchive`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  const modal = (showCreate || editing) && (
    <Modal title={editing ? 'Edit Department' : 'New Department'} onClose={closeModal}>
      <form onSubmit={handleSave}>
        {formError && <div className="alert alert-danger">{formError}</div>}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="modal-footer" style={{ justifyContent: editing ? 'space-between' : 'flex-end' }}>
          {editing && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/admin/departments/${editing.id}/settings`)}
            >
              Settings
            </button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )

  return (
    <div>
      {modal}
      {archiving && (
        <Modal title="Archive department" onClose={() => setArchiving(null)}>
          <p>
            Archive <strong>{archiving.name}</strong>? It has {archiving._count.subjectGrades} subject
            grade{archiving._count.subjectGrades !== 1 ? 's' : ''} underneath it.
          </p>
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            This cascades: its subject grades and every class under them are archived too. Nothing is
            deleted — students keep their decks and review history, and you can restore this later
            from Show Archived.
          </div>
          {formError && <div className="alert alert-danger" style={{ marginTop: 12 }}>{formError}</div>}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setArchiving(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={saving} onClick={handleArchive}>{saving ? 'Archiving…' : 'Archive'}</button>
          </div>
        </Modal>
      )}
      <div className="page-header">
        <h1 className="page-title">Departments</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
          {!showArchived && <button className="btn btn-primary" onClick={openCreate}>+ New Department</button>}
        </div>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {depts && (
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Subject Grades</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {depts.length === 0 && (
              <tr><td colSpan={3} className="table-empty">{showArchived ? 'No archived departments.' : 'No departments yet.'}</td></tr>
            )}
            {depts.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d._count.subjectGrades}</td>
                <td>
                  {showArchived ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleUnarchive(d)}>Unarchive</button>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(d)} style={{ marginRight: 6 }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => { setFormError(null); setArchiving(d) }}>Archive</button>
                    </>
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
