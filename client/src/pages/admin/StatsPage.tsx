import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
import { api } from '../../utils/api'

interface ClassRollupRow {
  classId: string
  className: string
  subjectGradeId: string
  subjectGradeName: string
  enrolledCount: number
  homeworkCompletionPct: number | null
  studentAddedCount: number
  accuracyRate: number | null
  reviewsThisWeek: number
}

interface RollupResponse {
  rows: ClassRollupRow[]
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}%`
}

export default function AdminStatsPage() {
  const { data: rollup, loading: rollupLoading, error: rollupError } = useApi<RollupResponse>(
    () => api.get('/admin/class-rollup'),
  )

  const grouped = (rollup?.rows ?? []).reduce<Record<string, ClassRollupRow[]>>((acc, row) => {
    (acc[row.subjectGradeName] ??= []).push(row)
    return acc
  }, {})

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Classes Overview</h1>
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        One row per class. Homework % and Student Additions link to more detail; Accuracy and
        Reviews are shown for the last 30 days / this week respectively.
      </p>

      {rollupLoading && <div className="spinner" />}
      {rollupError && <div className="alert alert-danger">{rollupError}</div>}
      {rollup && (
        <div className="card" style={{ marginBottom: 32 }}>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Students</th>
                <th>Homework Met</th>
                <th>Student Additions</th>
                <th>Accuracy (30d)</th>
                <th>Reviews This Week</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(grouped).length === 0 && (
                <tr><td colSpan={6} className="table-empty">No classes yet.</td></tr>
              )}
              {Object.entries(grouped).map(([subjectGradeName, rows]) => (
                <Fragment key={subjectGradeName}>
                  <tr>
                    <td colSpan={6} style={{ fontWeight: 700, background: 'var(--color-surface-alt, rgba(0,0,0,0.03))' }}>
                      {subjectGradeName}
                    </td>
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.classId}>
                      <td><Link to={`/admin/classes/${row.classId}`}>{row.className}</Link></td>
                      <td>{row.enrolledCount}</td>
                      <td>
                        {row.homeworkCompletionPct === null
                          ? '—'
                          : <Link to={`/admin/classes/${row.classId}?tab=homework`}>{pct(row.homeworkCompletionPct)}</Link>}
                      </td>
                      <td>
                        <Link to={`/admin/stats/student-additions?classId=${row.classId}`}>{row.studentAddedCount}</Link>
                      </td>
                      <td>{row.accuracyRate === null ? '—' : pct(row.accuracyRate * 100)}</td>
                      <td>{row.reviewsThisWeek}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  )
}
