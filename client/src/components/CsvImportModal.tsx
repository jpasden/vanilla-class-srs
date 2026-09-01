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
  /** If provided, shows a "Download sample CSV" button above the file picker. */
  templateCsv?: string
  templateFilename?: string
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
  needsConfirmation?: boolean
  detectedFormat?: { name: string; email: string }
}

export function CsvImportModal({ title, endpoint, onSuccess, onClose, templateHint, printLabel, templateCsv, templateFilename }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDownloadTemplate = () => {
    if (!templateCsv) return
    // Prepend a UTF-8 BOM so Excel correctly detects the encoding — without
    // it, Excel often mis-renders non-ASCII characters (e.g. Chinese names).
    const blob = new Blob(['﻿' + templateCsv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = templateFilename ?? 'vanilla-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const imported = result !== null && !result.validationErrors?.length && !result.error && !result.needsConfirmation

  const handleSubmit = async (confirmHeaderless = false) => {
    if (!file) return
    setLoading(true)
    setError(null)
    if (!confirmHeaderless) setResult(null)
    try {
      const path = confirmHeaderless ? `${endpoint}?confirmHeaderless=true` : endpoint
      const data = await uploadFile<ImportResult>(path, file)
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
      {templateCsv && (
        <div style={{ marginBottom: 16 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleDownloadTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 12l-4-4h2.5V2h3v6H12L8 12z"/>
              <path d="M2 14h12v-2H2v2z"/>
            </svg>
            Download sample CSV
          </button>
        </div>
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
      {result?.needsConfirmation && result.detectedFormat && (
        <div className="alert alert-info">
          <strong>No header row detected in your CSV file.</strong> We're assuming column 1 of
          your CSV file is the student's name and column 2 is their email, based on the first row:
          <div style={{ fontFamily: 'monospace', margin: '8px 0', fontSize: 13 }}>
            {result.detectedFormat.name} → {result.detectedFormat.email}
          </div>
          <p style={{ fontSize: 13 }}>
            If that looks right, click <strong>Import as shown</strong>. If your file actually
            has different columns (or a header we didn't recognize), click <strong>Cancel</strong> and
            add a header row: <code>name,email</code>.
          </p>
        </div>
      )}
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
        ) : result?.needsConfirmation ? (
          <>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={loading}
              onClick={() => handleSubmit(true)}
            >
              {loading ? 'Importing…' : 'Import as shown'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!file || loading}
              onClick={() => handleSubmit(false)}
            >
              {loading ? 'Uploading…' : 'Import'}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
