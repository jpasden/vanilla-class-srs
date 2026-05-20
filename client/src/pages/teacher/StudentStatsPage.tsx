/**
 * Teacher read-only view of a student's "My Stats" page.
 * Identical to the student StatsPage but hits teacher-scoped API routes
 * and shows the student's name in the title.
 *
 * Route: /teacher/classes/:classId/students/:studentId/stats
 * Student name passed via router state: { studentName: string, enrollmentId: string }
 */

import { useState } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { api } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { SimpleBarChart, AccuracyLineChart } from '../../components/Charts'

interface Summary {
  deckBreakdown: { NEW: number; LEARNING: number; REVIEW: number; RELEARNING: number; dueToday: number }
  streak: { current: number; longest: number; mostCardsInDay: number }
  weeklyGoal: {
    sessionsRequired: number; minCardsPerSession: number; periodDays: number
    sessionsCompleted: number; daysRemaining: number
  } | null
}

interface Session {
  id: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  cardsReviewed: number
  accuracyRate: number | null
}

type Tab = 'overview' | 'accuracy' | 'sessions'

function pct(v: number | null) {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

function formatMs(ms: number | null) {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function StreakHeatmap({ daily }: { daily: { date: string; cardsReviewed: number }[] }) {
  const maxCards = Math.max(...daily.map((d) => d.cardsReviewed), 1)
  const weeks: { date: string; cardsReviewed: number }[][] = []
  let week: { date: string; cardsReviewed: number }[] = []

  const firstDate = daily.length > 0 ? new Date(daily[0].date + 'T00:00:00') : new Date()
  const firstDow = (firstDate.getDay() + 6) % 7
  for (let i = 0; i < firstDow; i++) week.push({ date: '', cardsReviewed: 0 })

  for (const d of daily) {
    week.push(d)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) weeks.push(week)

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const cellSize = 14
  const gap = 2

  function cellColor(cards: number, date: string) {
    if (!date) return 'transparent'
    if (cards === 0) return 'var(--color-border)'
    const intensity = Math.min(cards / maxCards, 1)
    if (intensity < 0.25) return 'rgba(107, 175, 146, 0.25)'
    if (intensity < 0.5)  return 'rgba(107, 175, 146, 0.5)'
    if (intensity < 0.75) return 'rgba(107, 175, 146, 0.75)'
    return 'var(--color-accent-alt)'
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: gap }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap, marginRight: 4 }}>
          {dayLabels.map((l, i) => (
            <div key={i} style={{ height: cellSize, width: 12, fontSize: 10, color: 'var(--color-text-muted)', lineHeight: `${cellSize}px` }}>{l}</div>
          ))}
        </div>
        {weeks.map((w, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap }}>
            {w.map((d, di) => (
              <div
                key={di}
                title={d.date ? `${d.date}: ${d.cardsReviewed} cards` : ''}
                style={{ width: cellSize, height: cellSize, borderRadius: 2, background: cellColor(d.cardsReviewed, d.date) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
        Less&nbsp;
        {['var(--color-border)', 'rgba(107,175,146,0.25)', 'rgba(107,175,146,0.5)', 'rgba(107,175,146,0.75)', 'var(--color-accent-alt)'].map((c, i) => (
          <span key={i} style={{ display: 'inline-block', width: 12, height: 12, background: c, borderRadius: 2, margin: '0 1px', verticalAlign: 'middle' }} />
        ))}
        &nbsp;More
      </div>
    </div>
  )
}

export default function TeacherStudentStatsPage() {
  const { classId, studentId } = useParams<{ classId: string; studentId: string }>()
  const location = useLocation()
  const { studentName } = (location.state as { studentName: string } | null) ?? { studentName: 'Student' }

  const [tab, setTab] = useState<Tab>('overview')
  const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)

  const base = `/teachers/classes/${classId}/students/${studentId}/stats`

  const { data: summary, loading: sumLoad } = useApi<Summary>(
    () => api.get(`${base}/summary?tz=${tz}`),
    [classId, studentId]
  )
  const { data: daily } = useApi<{ date: string; cardsReviewed: number }[]>(
    () => api.get(`${base}/daily?days=90&tz=${tz}`),
    [classId, studentId]
  )
  const { data: accuracy } = useApi<{ date: string; accuracy: number | null }[]>(
    () => api.get(`${base}/accuracy?tz=${tz}`),
    [classId, studentId]
  )
  const { data: sessions, loading: sessLoad } = useApi<Session[]>(
    () => api.get(`${base}/sessions`),
    [classId, studentId]
  )
  const { data: forecast } = useApi<{ daily: { date: string; due: number }[]; cumulative: { days7: number; days14: number; days30: number } }>(
    () => api.get(`${base}/forecast`),
    [classId, studentId]
  )
  const { data: growth } = useApi<{ date: string; newCards: number }[]>(
    () => api.get(`${base}/growth?days=30`),
    [classId, studentId]
  )

  const bd = summary?.deckBreakdown
  const totalCards = bd ? bd.NEW + bd.LEARNING + bd.REVIEW + bd.RELEARNING : 0

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <Link to={`/teacher/classes/${classId}`} style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          ← Class
        </Link>
      </div>
      <div className="page-header">
        <h1 className="page-title">My Stats ({studentName})</h1>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab${tab === 'accuracy' ? ' active' : ''}`} onClick={() => setTab('accuracy')}>Accuracy Trend</button>
        <button className={`tab${tab === 'sessions' ? ' active' : ''}`} onClick={() => setTab('sessions')}>Session Log</button>
      </div>

      {tab === 'overview' && (
        <div>
          {sumLoad && <div className="spinner" />}
          {summary && (
            <>
              <div className="grid-3" style={{ marginBottom: 20 }}>
                <div className="card stat-block">
                  <div className="stat-value" style={{ color: 'var(--color-primary)' }}>{summary.streak.current}</div>
                  <div className="stat-label">Current Streak (days)</div>
                </div>
                <div className="card stat-block">
                  <div className="stat-value">{summary.streak.longest}</div>
                  <div className="stat-label">Longest Streak</div>
                </div>
                <div className="card stat-block">
                  <div className="stat-value">{summary.streak.mostCardsInDay}</div>
                  <div className="stat-label">Best Day (cards)</div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 16 }}>Deck Breakdown</h2>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                  {[
                    { state: 'NEW', color: 'var(--color-text-muted)' },
                    { state: 'LEARNING', color: 'var(--color-warning)' },
                    { state: 'REVIEW', color: 'var(--color-accent-alt)' },
                    { state: 'RELEARNING', color: 'var(--color-accent)' },
                  ].map(({ state, color }) => (
                    <div key={state} style={{ textAlign: 'center', minWidth: 70 }}>
                      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color }}>{bd?.[state as keyof typeof bd] ?? 0}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{state}</div>
                    </div>
                  ))}
                  <div style={{ textAlign: 'center', minWidth: 70 }}>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-primary)' }}>{bd?.dueToday ?? 0}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Due Today</div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 70 }}>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{totalCards}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Total</div>
                  </div>
                </div>
              </div>

              {summary.weeklyGoal && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Weekly Goal</h2>
                  <p style={{ fontSize: 'var(--text-sm)', marginBottom: 8 }}>
                    {summary.weeklyGoal.sessionsCompleted} / {summary.weeklyGoal.sessionsRequired} sessions completed
                    &nbsp;·&nbsp; {summary.weeklyGoal.daysRemaining} day{summary.weeklyGoal.daysRemaining !== 1 ? 's' : ''} remaining
                  </p>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.min(100, (summary.weeklyGoal.sessionsCompleted / summary.weeklyGoal.sessionsRequired) * 100)}%`,
                        background: summary.weeklyGoal.sessionsCompleted >= summary.weeklyGoal.sessionsRequired
                          ? 'var(--color-success)'
                          : summary.weeklyGoal.daysRemaining <= 2 && summary.weeklyGoal.sessionsCompleted < summary.weeklyGoal.sessionsRequired
                            ? 'var(--color-warning)'
                            : 'var(--color-primary)',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 6 }}>
                    Min {summary.weeklyGoal.minCardsPerSession} cards/session · {summary.weeklyGoal.periodDays}-day period
                  </p>
                </div>
              )}

              {daily && daily.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Study Streak Calendar</h2>
                  <StreakHeatmap daily={daily} />
                </div>
              )}

              {forecast && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Due Card Forecast</h2>
                  <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                    {([7, 14, 30] as const).map((n) => (
                      <div key={n} className="stat-block">
                        <div className="stat-value" style={{ fontSize: 'var(--text-xl)' }}>
                          {forecast.cumulative[`days${n}` as 'days7' | 'days14' | 'days30']}
                        </div>
                        <div className="stat-label">{n} days</div>
                      </div>
                    ))}
                  </div>
                  <SimpleBarChart data={forecast.daily.map((d) => ({ label: d.date.slice(5), value: d.due }))} color="var(--color-warning)" />
                </div>
              )}

              {daily && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Cards Reviewed Per Day</h2>
                  <SimpleBarChart data={daily.slice(-30).map((d) => ({ label: d.date.slice(5), value: d.cardsReviewed }))} />
                </div>
              )}

              {growth && (
                <div className="card">
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>New Cards Added Per Day</h2>
                  <SimpleBarChart data={growth.map((d) => ({ label: d.date.slice(5), value: d.newCards }))} color="var(--color-accent)" />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'accuracy' && (
        <div>
          <div className="card">
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 4 }}>Rolling 7-Day Accuracy Rate</h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 16 }}>
              Each point shows accuracy across the 7 days ending on that date.
            </p>
            {accuracy && <AccuracyLineChart data={accuracy} />}
            {accuracy && (
              <div className="table-scroll">
                <table className="table" style={{ marginTop: 16, fontSize: 'var(--text-sm)' }}>
                  <thead><tr><th>Date</th><th>7-Day Accuracy</th></tr></thead>
                  <tbody>
                    {[...accuracy].reverse().map((d, i) => (
                      <tr key={i}>
                        <td>{d.date}</td>
                        <td style={{ color: d.accuracy === null ? 'var(--color-text-muted)' : d.accuracy >= 0.8 ? 'var(--color-accent-alt)' : d.accuracy >= 0.5 ? 'var(--color-warning)' : 'var(--color-accent)' }}>
                          {pct(d.accuracy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        <div>
          {sessLoad && <div className="spinner" />}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Duration</th><th>Cards</th><th>Accuracy</th></tr>
              </thead>
              <tbody>
                {sessions?.length === 0 && <tr><td colSpan={4} className="table-empty">No completed sessions yet.</td></tr>}
                {sessions?.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontSize: 13 }}>{new Date(s.startedAt).toLocaleString()}</td>
                    <td style={{ fontSize: 13 }}>{formatMs(s.durationMs)}</td>
                    <td>{s.cardsReviewed}</td>
                    <td>{pct(s.accuracyRate)}</td>
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
