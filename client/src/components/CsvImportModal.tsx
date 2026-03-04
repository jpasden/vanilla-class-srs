import { useState, useRef } from 'react'
import { Modal } from './Modal'
import { uploadFile, ApiError } from '../utils/api'

interface Props {
  title: string
  endpoint: string
  onSuccess: () => void
  onClose: () => void
  templateHint?: string
}

interface ImportResult {
  created?: number
  results?: { email?: string; status: string; error?: string; tempPassword?: string }[]
  validationErrors?: string[]
  error?: string
}

export function CsvImportModal({ title, endpoint, onSuccess, onClose, templateHint }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await uploadFile<ImportResult>(endpoint, file)
      setResult(data)
      if (!data.validationErrors?.length && !data.error) {
        setTimeout(onSuccess, 1500)
      }
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
      {result?.results && (
        <div>
          <p style={{ fontSize: 13, marginBottom: 8 }}>Enrollment results:</p>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Email</th><th>Status</th><th>Temp Password</th></tr></thead>
            <tbody>
              {result.results.map((r, i) => (
                <tr key={i}>
                  <td>{r.email ?? '—'}</td>
                  <td><span className={`badge badge-${r.status === 'enrolled' || r.status === 'already_enrolled' ? 'green' : 'red'}`}>{r.status}</span></td>
                  <td style={{ fontFamily: 'monospace' }}>{r.tempPassword ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!file || loading}
          onClick={handleSubmit}
        >
          {loading ? 'Uploading…' : 'Import'}
        </button>
      </div>
    </Modal>
  )
}
