import { useState, useRef, FormEvent, ChangeEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, ApiError, uploadFile } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'
import { CardImportHelpModal } from '../../components/CardImportHelpModal'

interface Card {
  id: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null
}
interface CardSet {
  id: string
  name: string
  description: string | null
  status: 'PRIVATE' | 'DEPARTMENTAL'
  teacher?: { user: { name: string } }
  subjectGrade?: { name: string }
  cards: Card[]
}

type CardFormData = { word: string; pos: string; definitionL2: string; definitionL1: string; exampleSentence: string }
const emptyForm: CardFormData = { word: '', pos: '', definitionL2: '', definitionL1: '', exampleSentence: '' }

interface CsvRowError { row: number; word?: string; error: string }

function validateCsvRows(rows: Record<string, string>[]): CsvRowError[] {
  const errors: CsvRowError[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.word?.trim()) {
      errors.push({ row: i + 1, error: 'word is required' })
      continue
    }
    if (!r.definition_l2?.trim() && !r.definition_l1?.trim()) {
      errors.push({ row: i + 1, word: r.word, error: 'at least one definition (definition_l2 or definition_l1) is required' })
    }
  }
  return errors
}

async function parseCsvFile(file: File): Promise<{ rows: Record<string, string>[] } | { parseError: string }> {
  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { parseError: 'CSV must have a header row and at least one data row.' }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  if (!headers.includes('word')) return { parseError: 'CSV is missing a "word" column header.' }

  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    // Basic CSV split — handles quoted fields
    const values = lines[i].match(/("(?:[^"]|"")*"|[^,]*)/g)?.map((v) =>
      v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v
    ) ?? []
    const row: Record<string, string> = {}
    headers.forEach((h, j) => { row[h] = (values[j] ?? '').trim() })
    rows.push(row)
  }
  return { rows }
}

export default function AdminCardSetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: cs, loading, reload } = useApi<CardSet>(() => api.get(`/admin/cardsets/${id}`), [id])
  const [editing, setEditing] = useState<Card | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<CardFormData>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // CSV import state
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csvErrors, setCsvErrors] = useState<CsvRowError[] | null>(null)
  const [csvSuccess, setCsvSuccess] = useState<number | null>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvParseError, setCsvParseError] = useState<string | null>(null)

  const openCreate = () => { setForm(emptyForm); setFormError(null); setCreating(true) }
  const openEdit = (c: Card) => {
    setEditing(c)
    setForm({ word: c.word, pos: c.pos ?? '', definitionL2: c.definitionL2 ?? '', definitionL1: c.definitionL1 ?? '', exampleSentence: c.exampleSentence ?? '' })
    setFormError(null)
  }
  const closeModal = () => { setEditing(null); setCreating(false) }

  const validate = (f: CardFormData) => {
    if (!f.word.trim()) return 'Word is required.'
    if (!f.definitionL2.trim() && !f.definitionL1.trim()) return 'At least one definition (L1 or L2) is required.'
    return null
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    const err = validate(form)
    if (err) { setFormError(err); return }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        word: form.word,
        pos: form.pos || undefined,
        definitionL2: form.definitionL2 || undefined,
        definitionL1: form.definitionL1 || undefined,
        exampleSentence: form.exampleSentence || undefined,
      }
      if (editing) {
        await api.patch(`/admin/cardsets/${id}/cards/${editing.id}`, payload)
      } else {
        await api.post(`/admin/cardsets/${id}/cards`, payload)
      }
      closeModal()
      reload()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (c: Card) => {
    if (!confirm(`Delete card "${c.word}"? This cannot be undone.`)) return
    try { await api.delete(`/admin/cardsets/${id}/cards/${c.id}`); reload() }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed') }
  }

  const handleCsvFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!csvInputRef.current) csvInputRef.current!.value = ''
    if (!file) return

    setCsvErrors(null)
    setCsvSuccess(null)
    setCsvParseError(null)

    const parsed = await parseCsvFile(file)
    if ('parseError' in parsed) {
      setCsvParseError(parsed.parseError)
      return
    }

    const errors = validateCsvRows(parsed.rows)
    if (errors.length > 0) {
      setCsvErrors(errors)
      return
    }

    // All valid — upload
    setCsvUploading(true)
    try {
      const result = await uploadFile<{ created: number }>(`/admin/cardsets/${id}/cards/import`, file)
      setCsvSuccess(result.created)
      reload()
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message)
          if (parsed.validationErrors) setCsvErrors(parsed.validationErrors)
          else setCsvParseError(parsed.error ?? 'Upload failed')
        } catch {
          setCsvParseError(err.message)
        }
      } else {
        setCsvParseError('Upload failed')
      }
    } finally {
      setCsvUploading(false)
      if (csvInputRef.current) csvInputRef.current.value = ''
    }
  }

  if (loading) return <div className="spinner" />

  return (
    <div>
      {(editing || creating) && (
        <Modal title={editing ? `Edit "${editing.word}"` : 'New Card'} onClose={closeModal}>
          <form onSubmit={handleSave}>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <div className="form-group">
              <label className="form-label">Word *</label>
              <input className="form-input" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Part of Speech</label>
              <input className="form-input" value={form.pos} onChange={(e) => setForm({ ...form, pos: e.target.value })} placeholder="noun, verb, adj…" />
            </div>
            <div className="form-group">
              <label className="form-label">Definition (L2 — target language)</label>
              <textarea className="form-textarea" value={form.definitionL2} onChange={(e) => setForm({ ...form, definitionL2: e.target.value })} rows={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Definition (L1 — native language)</label>
              <textarea className="form-textarea" value={form.definitionL1} onChange={(e) => setForm({ ...form, definitionL1: e.target.value })} rows={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Example Sentence</label>
              <textarea className="form-textarea" value={form.exampleSentence} onChange={(e) => setForm({ ...form, exampleSentence: e.target.value })} rows={2} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
      {showHelp && <CardImportHelpModal onClose={() => setShowHelp(false)} />}

      <div style={{ marginBottom: 20 }}>
        <Link to="/admin/cardsets" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← CardSets</Link>
        <div className="page-header" style={{ marginTop: 8 }}>
          <div>
            <h1 className="page-title">{cs?.name}</h1>
            {cs?.description && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{cs.description}</p>}
            <span className={`badge badge-${cs?.status === 'DEPARTMENTAL' ? 'blue' : 'gray'}`} style={{ marginTop: 4 }}>{cs?.status}</span>
            {' '}
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {cs?.status === 'DEPARTMENTAL' ? cs?.subjectGrade?.name : cs?.teacher?.user.name}
            </span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={openCreate}>+ Add Card</button>
        </div>
      </div>

      {/* CSV import section */}
      <div className="card" style={{ marginBottom: 24, maxWidth: 480 }}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Import word data by CSV</span>
          {' '}
          <button
            onClick={() => setShowHelp(true)}
            style={{ background: 'none', border: 'none', color: 'var(--color-link, #2563eb)', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}
          >
            How do I do this?
          </button>
        </div>

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={handleCsvFileChange}
        />
        <button
          className="btn btn-primary"
          disabled={csvUploading}
          onClick={() => {
            setCsvErrors(null)
            setCsvSuccess(null)
            setCsvParseError(null)
            csvInputRef.current?.click()
          }}
        >
          {csvUploading ? 'Uploading…' : 'Choose CSV file to import'}
        </button>

        {csvParseError && (
          <div className="alert alert-danger" style={{ marginTop: 12 }}>{csvParseError}</div>
        )}
        {csvErrors && csvErrors.length > 0 && (
          <div className="alert alert-danger" style={{ marginTop: 12 }}>
            <strong>Fix these errors in your CSV and try again:</strong>
            <ul style={{ marginTop: 6, paddingLeft: 20 }}>
              {csvErrors.map((e, i) => (
                <li key={i} style={{ marginBottom: 2 }}>
                  Row {e.row}{e.word ? ` ("${e.word}")` : ''}: {e.error}
                </li>
              ))}
            </ul>
            <p style={{ marginTop: 6, fontSize: 12, color: 'inherit' }}>
              The import was not saved. Fix all errors and re-upload.
            </p>
          </div>
        )}
        {csvSuccess !== null && (
          <div className="alert alert-success" style={{ marginTop: 12 }}>
            Imported {csvSuccess} card{csvSuccess !== 1 ? 's' : ''} successfully.
          </div>
        )}
      </div>

      {/* Cards table */}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Word</th><th>POS</th><th>L2 Definition</th><th>L1 Definition</th><th>Example</th>
              <th style={{ width: 100 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!cs?.cards.length && <tr><td colSpan={6} className="table-empty">No cards yet. Import a CSV or add cards one at a time.</td></tr>}
            {cs?.cards.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500 }}>{c.word}</td>
                <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{c.pos ?? '—'}</td>
                <td style={{ fontSize: 13 }}>{c.definitionL2 ?? '—'}</td>
                <td style={{ fontSize: 13 }}>{c.definitionL1 ?? '—'}</td>
                <td style={{ fontSize: 13 }}>{c.exampleSentence ?? '—'}</td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)} style={{ marginRight: 4 }}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
