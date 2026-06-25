import { useState, useEffect, FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'

interface Department {
  id: string
  name: string
  definitionL2Label: string | null
  definitionL1Label: string | null
}

const DEFAULT_L2_LABEL = 'L2 Definition'
const DEFAULT_L1_LABEL = 'L1 Definition'

export default function DepartmentSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: dept, loading, error } = useApi<Department>(() => api.get(`/admin/departments/${id}`), [id])

  const [name, setName] = useState('')
  const [definitionL2Label, setDefinitionL2Label] = useState('')
  const [definitionL1Label, setDefinitionL1Label] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!dept) return
    setName(dept.name)
    setDefinitionL2Label(dept.definitionL2Label ?? '')
    setDefinitionL1Label(dept.definitionL1Label ?? '')
  }, [dept])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    setSaved(false)
    try {
      await api.patch(`/admin/departments/${id}`, {
        name,
        definitionL2Label,
        definitionL1Label,
      })
      setSaved(true)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="spinner" />
  if (error) return <div className="alert alert-danger">{error}</div>

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link to="/admin/departments" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← Departments</Link>
        <div className="page-header" style={{ marginTop: 8 }}>
          <h1 className="page-title">{dept?.name} — Settings</h1>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <form onSubmit={handleSave}>
          {formError && <div className="alert alert-danger">{formError}</div>}
          {saved && <div className="alert alert-success">Settings saved.</div>}

          <div className="form-group">
            <label className="form-label">Name</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '20px 0' }} />

          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
            Override the labels shown for L2/L1 definitions throughout Vanilla — in admin, teacher, and
            student views — for cards belonging to this department. Leave blank to use the default label.
          </p>

          <div className="form-group">
            <label className="form-label">L2 Definition label</label>
            <input
              className="form-input"
              value={definitionL2Label}
              onChange={(e) => setDefinitionL2Label(e.target.value)}
              placeholder={DEFAULT_L2_LABEL}
            />
          </div>

          <div className="form-group">
            <label className="form-label">L1 Definition label</label>
            <input
              className="form-input"
              value={definitionL1Label}
              onChange={(e) => setDefinitionL1Label(e.target.value)}
              placeholder={DEFAULT_L1_LABEL}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/departments')}>
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
