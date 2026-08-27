import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../utils/api'
import { useApi } from '../hooks/useApi'
import { downloadCsv } from '../utils/csvExport'

export interface StudentAddition {
  cardInstanceId: string
  studentName: string
  className: string
  word: string
  definitionL1: string | null
  definitionL2: string | null
  addedAt: string
}

interface AdditionsResponse {
  additions: StudentAddition[]
  rangeStart: string
  rangeEnd: string
}

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Shared table for the "student-added cards" report — used by both the
 * teacher's per-class Stats tab and the admin's school-wide Stats page.
 * The two differ only in which endpoint they hit and whether a class
 * filter is shown; rendering and CSV export are identical.
 */
export default function StudentAdditionsTable({
  fetchUrl,
  classOptions,
}: {
  /** Base API path, e.g. "/teachers/classes/abc/student-additions" or "/admin/student-additions" */
  fetchUrl: string
  /** When provided, renders a class filter dropdown (admin use case). Omit for a single-class context. */
  classOptions?: { id: string; name: string }[]
}) {
  const [searchParams] = useSearchParams()
  // Lets a link like /admin/stats/student-additions?classId=abc pre-filter
  // this table on load (e.g. from the class rollup table's Student
  // Additions column) — read once on mount, not kept in sync with further
  // URL changes. The admin can still switch back to "All classes" here.
  const [classId, setClassId] = useState(searchParams.get('classId') ?? '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [sortAsc, setSortAsc] = useState(false)

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (start && end) { params.set('start', start); params.set('end', end) }
    if (classOptions && classId) params.set('classId', classId)
    const qs = params.toString()
    return qs ? `${fetchUrl}?${qs}` : fetchUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl, classId])

  const { data, loading, error, reload } = useApi<AdditionsResponse>(() => api.get<AdditionsResponse>(url), [url])

  // Pre-fill the date inputs from the server's default range on first load only —
  // once the user has a range in the fields (default or custom), further data
  // refreshes shouldn't overwrite what they've typed.
  useEffect(() => {
    if (data && !start && !end) {
      setStart(toDateInputValue(data.rangeStart))
      setEnd(toDateInputValue(data.rangeEnd))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const sorted = useMemo(() => {
    const rows = data?.additions ?? []
    return [...rows].sort((a, b) =>
      sortAsc ? a.addedAt.localeCompare(b.addedAt) : b.addedAt.localeCompare(a.addedAt)
    )
  }, [data, sortAsc])

  const handleExport = () => {
    downloadCsv(
      'student-added-cards.csv',
      ['Student', 'Class', 'Date Added', 'Word', 'L1 Definition', 'L2 Definition'],
      sorted.map((a) => [
        a.studentName,
        a.className,
        new Date(a.addedAt).toLocaleDateString(),
        a.word,
        a.definitionL1 ?? '',
        a.definitionL2 ?? '',
      ]),
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">From</label>
          <input type="date" className="form-input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">To</label>
          <input type="date" className="form-input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {classOptions && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Class</label>
            <select className="form-select" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">All classes</option>
              {classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <button className="btn btn-secondary" onClick={reload} disabled={loading}>Apply</button>
        <button className="btn btn-primary" onClick={handleExport} disabled={!data || sorted.length === 0}>
          Export CSV
        </button>
      </div>

      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {data && (
        <div className="card">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th style={{ cursor: 'pointer' }} onClick={() => setSortAsc((v) => !v)}>
                  Date Added {sortAsc ? '↑' : '↓'}
                </th>
                <th>Word</th>
                <th>L1 Definition</th>
                <th>L2 Definition</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="table-empty">No student-added cards in this range.</td></tr>
              )}
              {sorted.map((a) => (
                <tr key={a.cardInstanceId}>
                  <td>{a.studentName}</td>
                  <td>{a.className}</td>
                  <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(a.addedAt).toLocaleDateString()}</td>
                  <td style={{ fontWeight: 500 }}>{a.word}</td>
                  <td>{a.definitionL1 ?? '—'}</td>
                  <td>{a.definitionL2 ?? '—'}</td>
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
