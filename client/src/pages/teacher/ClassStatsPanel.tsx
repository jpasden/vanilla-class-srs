import React, { useState } from 'react'
import { api } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { SimpleBarChart, AccuracyLineChart } from '../../components/Charts'

interface StatsData {
  classId: string
  className: string
  masteryMatrix: {
    students: { studentId: string; name: string; email: string }[]
    cards: { id: string; word: string; cardSetId: string }[]
    cells: Record<string, Record<string, { reps: number; correctReps: number; accuracy: number | null }>>
  }
  studentLeaderboard: { studentId: string; name: string; totalReps: number; accuracyRate: number | null }[]
  accuracyFlags: { studentId: string; name: string; accuracyRate: number | null; flag: string | null }[]
  cardLeaderboard: { cardId: string; word: string; avgAccuracy: number | null; reviewedByCount: number; enrolledCount: number; isProblemWord: boolean }[]
  recentStudentAdditions: { studentId: string; studentName: string; word: string; definitionL1: string | null; definitionL2: string | null; addedAt: string }[]
  optionalCardSetAdoption: { cardSetId: string; cardSetName: string; adoptedCount: number; totalEnrolled: number; adoptedStudentIds: string[] }[]
  dailyChart: { date: string; cardsReviewed: number }[]
  forecastDaily: { date: string; due: number }[]
  accuracyTrend: { date: string; accuracy: number | null }[]
  overdueByStudent: { studentId: string; name: string; overdueCount: number }[]
  deckGrowthDaily: { date: string; newCards: number }[]
  homeworkCompliance: {
    requirement: { sessionsRequired: number; minCardsPerSession: number; periodDays: number; daysRemaining: number }
    summary: string
    students: { studentId: string; name: string; sessionsCompleted: number; sessionsRequired?: number; status: string }[]
  } | null
}

type StatsTab = 'matrix' | 'leaderboard' | 'cards' | 'activity' | 'compliance' | 'additions'

function accuracyColor(accuracy: number | null): string {
  if (accuracy === null) return 'var(--color-border)'
  if (accuracy >= 0.8) return 'var(--color-accent-alt)'
  if (accuracy >= 0.5) return 'var(--color-warning)'
  return 'var(--color-accent)'
}

function pct(v: number | null) {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

export default function ClassStatsPanel({ classId }: { classId: string }) {
  const [days, setDays] = useState(30)
  const { data: stats, loading, error, reload } = useApi<StatsData>(
    () => api.get(`/teachers/classes/${classId}/stats?days=${days}`),
    [classId, days]
  )
  const [tab, setTab] = useState<StatsTab>('leaderboard')
  const [expandedAdoption, setExpandedAdoption] = useState<Set<string>>(new Set())

  const statsBar = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
      <label style={{ fontSize: 13 }}>
        Lookback:&nbsp;
        <select className="form-select" style={{ width: 'auto', display: 'inline-block' }} value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
      <button className="btn btn-secondary btn-sm" onClick={reload}>Refresh</button>
    </div>
  )

  if (loading) return <div className="spinner" />
  if (error) return <div className="alert alert-danger">{error}</div>
  if (!stats) return null

  return (
    <div>
      {statsBar}
      <div className="tabs">
        {([
          ['leaderboard', 'Leaderboard'],
          ['activity', 'Activity'],
          ['compliance', 'Compliance'],
          ['cards', 'Card Stats'],
          ['additions', 'Student Additions'],
          ['matrix', 'Mastery Matrix'],
        ] as [StatsTab, string][]).map(([t, label]) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {/* Mastery Matrix — §14.1 */}
      {tab === 'matrix' && (
        <div style={{ overflowX: 'auto' }}>
          {stats.masteryMatrix.cards.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No card data yet.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 'max-content' }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left', position: 'sticky', left: 0, background: 'white', zIndex: 1 }}>Student</th>
                  {stats.masteryMatrix.cards.map((c) => (
                    <th key={c.id} style={{ padding: '4px 8px', fontWeight: 500, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.word}>
                      {c.word}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.masteryMatrix.students.map((s) => (
                  <tr key={s.studentId}>
                    <td style={{ padding: '6px 12px', position: 'sticky', left: 0, background: 'var(--color-surface)', fontWeight: 500 }}>{s.name}</td>
                    {stats.masteryMatrix.cards.map((c) => {
                      const cell = stats.masteryMatrix.cells[s.studentId]?.[c.id]
                      const reps = cell?.reps ?? 0
                      const acc = cell?.accuracy ?? null
                      const size = reps === 0 ? 8 : Math.min(8 + reps * 2, 24)
                      return (
                        <td key={c.id} style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <div title={`${s.name} · ${c.word}: ${pct(acc)} (${reps} reps)`}
                            style={{
                              width: size, height: size,
                              borderRadius: '50%',
                              background: reps === 0 ? 'var(--color-border)' : accuracyColor(acc),
                              display: 'inline-block',
                            }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12 }}>
            Circle color: green ≥80% · yellow ≥50% · red &lt;50% · grey = not reviewed. Size ∝ reps.
          </p>
        </div>
      )}

      {/* Student Leaderboard — §14.2 + §14.3 */}
      {tab === 'leaderboard' && (
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>#</th><th>Student</th><th>Total Reps</th><th>Accuracy</th><th>Flag</th></tr></thead>
          <tbody>
            {stats.studentLeaderboard.length === 0 && <tr><td colSpan={5} className="table-empty">No data.</td></tr>}
            {stats.studentLeaderboard.map((s, i) => {
              const flag = stats.accuracyFlags.find((f) => f.studentId === s.studentId)?.flag
              return (
                <tr key={s.studentId}>
                  <td style={{ color: 'var(--color-text-muted)' }}>{i + 1}</td>
                  <td>{s.name}</td>
                  <td>{s.totalReps}</td>
                  <td>{pct(s.accuracyRate)}</td>
                  <td>
                    {flag === 'suspiciously_high' && <span className="badge badge-yellow">Suspiciously high</span>}
                    {flag === 'very_low' && <span className="badge badge-red">Very low</span>}
                    {!flag && <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {/* Card Leaderboard — §14.4 */}
      {tab === 'cards' && (
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Word</th><th>Avg Accuracy</th><th>Reviewed By</th><th>Enrolled</th><th>Problem?</th></tr></thead>
          <tbody>
            {stats.cardLeaderboard.length === 0 && <tr><td colSpan={5} className="table-empty">No data.</td></tr>}
            {stats.cardLeaderboard.map((c) => (
              <tr key={c.cardId}>
                <td style={{ fontWeight: c.isProblemWord ? 600 : 400 }}>{c.word}</td>
                <td style={{ color: accuracyColor(c.avgAccuracy) }}>{pct(c.avgAccuracy)}</td>
                <td>{c.reviewedByCount}</td>
                <td>{c.enrolledCount}</td>
                <td>{c.isProblemWord && <span className="badge badge-red">Problem word</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* Activity charts — §14.7 */}
      {tab === 'activity' && (() => {
        const studentNameById = Object.fromEntries(
          stats.masteryMatrix.students.map((s) => [s.studentId, s.name])
        )
        return (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Cards Reviewed Per Day</h3>
            <SimpleBarChart data={stats.dailyChart.map((d) => ({ label: d.date.slice(5), value: d.cardsReviewed }))} />

            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '24px 0 12px' }}>Due Card Forecast (next 30 days)</h3>
            <SimpleBarChart data={stats.forecastDaily.map((d) => ({ label: d.date.slice(5), value: d.due }))} color="var(--color-warning)" />

            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '24px 0 8px' }}>Rolling 7-Day Accuracy Trend (Class)</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Each point shows accuracy across the 7 days ending on that date, aggregated across all students.
            </p>
            {stats.accuracyTrend.some((d) => d.accuracy !== null)
              ? <AccuracyLineChart data={stats.accuracyTrend} />
              : <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>No review data yet.</p>}

            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '24px 0 8px' }}>Overdue Card Backlog</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Cards past their due date right now, per student.
            </p>
            {stats.overdueByStudent.length > 0
              ? <HorizontalBarTable rows={stats.overdueByStudent.map((s) => ({ name: s.name, value: s.overdueCount }))} />
              : <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>No students enrolled.</p>}

            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '24px 0 8px' }}>New Cards Added Per Day (Class)</h3>
            <SimpleBarChart data={stats.deckGrowthDaily.map((d) => ({ label: d.date.slice(5), value: d.newCards }))} color="var(--color-accent)" />

            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '24px 0 12px' }}>Optional CardSet Adoption</h3>
            {stats.optionalCardSetAdoption.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>No optional CardSets assigned.</p>
            ) : (
              <div className="table-scroll">
              <table className="table">
                <thead><tr><th>CardSet</th><th>Adopted</th><th>Total Enrolled</th><th></th></tr></thead>
                <tbody>
                  {stats.optionalCardSetAdoption.map((o) => {
                    const isExpanded = expandedAdoption.has(o.cardSetId)
                    return (
                      <React.Fragment key={o.cardSetId}>
                        <tr>
                          <td>{o.cardSetName}</td>
                          <td>{o.adoptedCount}</td>
                          <td>{o.totalEnrolled}</td>
                          <td>
                            {o.adoptedCount > 0 && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setExpandedAdoption((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(o.cardSetId)) next.delete(o.cardSetId)
                                  else next.add(o.cardSetId)
                                  return next
                                })}
                              >
                                {isExpanded ? 'Hide' : 'Show students'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={4} style={{ paddingLeft: 24, paddingTop: 4, paddingBottom: 8 }}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {o.adoptedStudentIds.map((sid) => (
                                  <span key={sid} className="badge badge-green" style={{ fontSize: 12 }}>
                                    {studentNameById[sid] ?? sid}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* Homework compliance — §14.8 */}
      {tab === 'compliance' && (
        <div>
          {!stats.homeworkCompliance ? (
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>No active homework requirement.</p>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16, display: 'inline-block' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary: {stats.homeworkCompliance.summary}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {stats.homeworkCompliance.requirement.sessionsRequired} sessions ·&nbsp;
                  min {stats.homeworkCompliance.requirement.minCardsPerSession} cards/session ·&nbsp;
                  {stats.homeworkCompliance.requirement.periodDays}-day period ·&nbsp;
                  {stats.homeworkCompliance.requirement.daysRemaining} days remaining
                </div>
              </div>
              <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Student</th><th>Sessions Done</th><th>Required</th><th>Status</th></tr></thead>
                <tbody>
                  {stats.homeworkCompliance.students.map((s) => (
                    <tr key={s.studentId}>
                      <td>{s.name}</td>
                      <td>{s.sessionsCompleted}</td>
                      <td>{s.sessionsRequired ?? stats.homeworkCompliance!.requirement.sessionsRequired}</td>
                      <td>
                        <span className={`badge badge-${s.status === 'MET' ? 'green' : s.status === 'AT_RISK' ? 'yellow' : 'red'}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Recent student additions — §14.5 */}
      {tab === 'additions' && (
        <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Student</th><th>Word</th><th>L2 Definition</th><th>Added</th></tr></thead>
          <tbody>
            {stats.recentStudentAdditions.length === 0 && <tr><td colSpan={4} className="table-empty">No student additions in this period.</td></tr>}
            {stats.recentStudentAdditions.map((a, i) => (
              <tr key={i}>
                <td>{a.studentName}</td>
                <td style={{ fontWeight: 500 }}>{a.word}</td>
                <td>{a.definitionL2 ?? a.definitionL1 ?? '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(a.addedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

// Horizontal bar table — used for overdue backlog
function HorizontalBarTable({ rows }: { rows: { name: string; value: number }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div style={{ fontSize: 13 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ width: 120, textAlign: 'right', color: 'var(--color-text-muted)', flexShrink: 0 }}>{r.name}</div>
          <div style={{ flex: 1, background: 'var(--color-pistachio)', borderRadius: 2, height: 12 }}>
            <div style={{
              width: `${(r.value / max) * 100}%`,
              height: '100%',
              background: r.value === 0 ? 'var(--color-border)' : 'var(--color-accent)',
              borderRadius: 2,
            }} />
          </div>
          <div style={{ width: 32, fontWeight: r.value > 0 ? 600 : 400, color: r.value > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
            {r.value}
          </div>
        </div>
      ))}
    </div>
  )
}

