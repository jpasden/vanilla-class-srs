import { useState, useRef } from 'react'
import { Modal } from './Modal'
import { uploadFile, ApiError } from '../utils/api'
import { downloadPasswordSheet, printPasswordSlips } from '../utils/passwordSheet'

interface Props {
  title: string
  endpoint: string
  onSuccess: () => void
  onClose: () => void
  templateHint?: string
  /** Header shown on printed password slips — defaults to `title` if omitted. */
  printLabel?: string
}

interface EnrollRowResult {
  email?: string
  name?: string
  status: string
  error?: string
  tempPassword?: string
}

interface ImportResult {
  created?: number
  results?: EnrollRowResult[]
  validationErrors?: string[]
  error?: string
}

export function CsvImportModal({ title, endpoint, onSuccess, onClose, templateHint, printLabel }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const imported = result !== null && !result.validationErrors?.length && !result.error

  const handleSubmit = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await uploadFile<ImportResult>(endpoint, file)
      setResult(data)
    } catch (e) {
      if (e instanceof ApiError) {
        try {
          const parsed = JSON.parse(e.message)
          setResult(parsed)
        } catch {
          setError(e.message)
        }
      } else {
        setError('Upload failed')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {templateHint && (
        <div className="alert alert-info" style={{ fontSize: 13 }}>{templateHint}</div>
      )}
      <div className="form-group">
        <label className="form-label">Select CSV file</label>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="form-input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {result?.validationErrors && result.validationErrors.length > 0 && (
        <div className="alert alert-danger">
          <strong>Validation errors:</strong>
          <ul style={{ marginTop: 6, paddingLeft: 20 }}>
            {result.validationErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <p style={{ marginTop: 6, fontSize: 13 }}>Fix all errors and re-upload. Partial imports are not allowed.</p>
        </div>
      )}
      {result?.created !== undefined && (
        <div className="alert alert-success">Imported {result.created} card(s) successfully.</div>
      )}
      {result?.results && (() => {
        const withPasswords = result.results.filter((r): r is EnrollRowResult & { name: string; tempPassword: string } => !!r.tempPassword && !!r.name)
        return (
          <div>
            {withPasswords.length > 0 && (
              <div className="alert alert-success" style={{ marginBottom: 12 }}>
                <strong>{withPasswords.length} new student{withPasswords.length !== 1 ? 's' : ''} created</strong> — each
                gets their own one-time password below.
                <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-muted)' }}>
                  This is the only copy. Passwords are hashed on creation and can't be shown
                  again — a lost sheet means resetting those students one at a time from the
                  class page. Students must change their password on first login.
                </div>
              </div>
            )}
            <p style={{ fontSize: 13, marginBottom: 8 }}>Enrollment results:</p>
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Temporary password</th></tr></thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name ?? '—'}</td>
                    <td>{r.email ?? '—'}</td>
                    <td><span className={`badge badge-${r.status === 'enrolled' || r.status === 'already_enrolled' ? 'green' : 'red'}`}>{r.status}</span></td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {r.tempPassword ?? (r.status === 'already_enrolled' || r.status === 'enrolled' ? <span style={{ color: 'var(--color-text-muted)', fontFamily: 'inherit', fontWeight: 400 }}>already has an account</span> : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {withPasswords.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => downloadPasswordSheet(withPasswords.map((r) => ({ studentName: r.name, tempPassword: r.tempPassword })))}
                >
                  Download CSV
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => printPasswordSlips(withPasswords.map((r) => ({ studentName: r.name, tempPassword: r.tempPassword })), printLabel ?? title)}
                >
                  Print slips
                </button>
              </div>
            )}
          </div>
        )
      })()}
      <div className="modal-footer">
        {imported ? (
          <button className="btn btn-primary" onClick={onSuccess}>Done</button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!file || loading}
              onClick={handleSubmit}
            >
              {loading ? 'Uploading…' : 'Import'}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
