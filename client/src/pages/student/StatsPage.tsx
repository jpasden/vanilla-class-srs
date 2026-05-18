import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { useEnrollment } from '../../utils/enrollment'

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

/** GitHub-style streak heatmap — one cell per day for last N weeks */
function StreakHeatmap({ daily }: { daily: { date: string; cardsReviewed: number }[] }) {
  const maxCards = Math.max(...daily.map((d) => d.cardsReviewed), 1)
  // Arrange into weeks (columns) × days (rows, Mon=0…Sun=6)
  const weeks: { date: string; cardsReviewed: number }[][] = []
  let week: { date: string; cardsReviewed: number }[] = []

  // Pad start so week 0 starts on correct day of week
  const firstDate = daily.length > 0 ? new Date(daily[0].date + 'T00:00:00') : new Date()
  const firstDow = (firstDate.getDay() + 6) % 7 // Mon=0
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
        {/* Day-of-week labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap, marginRight: 4 }}>
          {dayLabels.map((l, i) => (
            <div key={i} style={{ height: cellSize, width: 12, fontSize: 10, color: 'var(--color-text-muted)', lineHeight: `${cellSize}px` }}>{l}</div>
          ))}
        </div>
        {/* Weeks as columns */}
        {weeks.map((w, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap }}>
            {w.map((d, di) => (
              <div
                key={di}
                title={d.date ? `${d.date}: ${d.cardsReviewed} cards` : ''}
                style={{
                  width: cellSize, height: cellSize,
                  borderRadius: 2,
                  background: cellColor(d.cardsReviewed, d.date),
                }}
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

export default function StudentStatsPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const eid = active?.enrollmentId

  const { data: summary, loading: sumLoad } = useApi<Summary>(
    () => api.get(`/students/stats/summary?enrollmentId=${eid}`),
    [eid]
  )
  const { data: daily } = useApi<{ date: string; cardsReviewed: number }[]>(
    () => api.get(`/students/stats/daily?enrollmentId=${eid}&days=90`),
    [eid]
  )
  const { data: accuracy } = useApi<{ date: string; accuracy: number | null }[]>(
    () => api.get(`/students/stats/accuracy?enrollmentId=${eid}`),
    [eid]
  )
  const { data: sessions, loading: sessLoad } = useApi<Session[]>(
    () => api.get(`/students/stats/sessions?enrollmentId=${eid}`),
    [eid]
  )
  const { data: forecast } = useApi<{ daily: { date: string; due: number }[]; cumulative: { days7: number; days14: number; days30: number } }>(
    () => api.get(`/students/stats/forecast?enrollmentId=${eid}`),
    [eid]
  )
  const { data: growth } = useApi<{ date: string; newCards: number }[]>(
    () => api.get(`/students/stats/growth?enrollmentId=${eid}&days=30`),
    [eid]
  )

  if (!active) { navigate('/student'); return null }

  const bd = summary?.deckBreakdown
  const totalCards = bd ? bd.NEW + bd.LEARNING + bd.REVIEW + bd.RELEARNING : 0

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">My Stats</h1>
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
              {/* Streak */}
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

              {/* Deck breakdown */}
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

              {/* Weekly goal */}
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
                  {/* In-app alert — §20 */}
                  {summary.weeklyGoal.daysRemaining <= 2 &&
                    summary.weeklyGoal.sessionsCompleted < summary.weeklyGoal.sessionsRequired && (
                    <div className="alert alert-warning" style={{ marginTop: 12 }}>
                      You have {summary.weeklyGoal.sessionsRequired - summary.weeklyGoal.sessionsCompleted} session(s) remaining this period.
                      Minimum: {summary.weeklyGoal.sessionsRequired}. Only {summary.weeklyGoal.daysRemaining} day(s) left!
                    </div>
                  )}
                </div>
              )}

              {/* Study streak heatmap — §21.2 */}
              {daily && daily.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Study Streak Calendar</h2>
                  <StreakHeatmap daily={daily} />
                </div>
              )}

              {/* Due forecast */}
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

              {/* Daily activity */}
              {daily && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Cards Reviewed Per Day</h2>
                  <SimpleBarChart data={daily.slice(-30).map((d) => ({ label: d.date.slice(5), value: d.cardsReviewed }))} />
                </div>
              )}

              {/* Deck growth — §21.2 */}
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

      {/* Rolling 7-day accuracy trend — §21.2 */}
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

function SimpleBarChart({ data, color = 'var(--color-accent)' }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const showLabel = (i: number) => i % Math.ceil(data.length / 8) === 0
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 2, minWidth: 'max-content', paddingBottom: 52 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', flex: '0 0 auto', width: 14, height: 100, position: 'relative' }}>
            <div
              title={`${d.label}: ${d.value}`}
              style={{
                width: 12,
                height: Math.max(2, (d.value / max) * 100),
                background: color,
                borderRadius: '2px 2px 0 0',
                opacity: d.value === 0 ? 0.2 : 1,
              }}
            />
            {showLabel(i) && (
              <div style={{
                position: 'absolute',
                top: 104,
                left: 0,
                fontSize: 9,
                color: 'var(--color-text-muted)',
                transform: 'rotate(-45deg)',
                transformOrigin: 'left top',
                whiteSpace: 'nowrap',
              }}>
                {d.label}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Simple SVG line chart for rolling accuracy trend */
function AccuracyLineChart({ data }: { data: { date: string; accuracy: number | null }[] }) {
  const W = 600
  const H = 160
  const PAD = { top: 10, right: 10, bottom: 24, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const points = data
    .map((d, i) => ({ x: i, y: d.accuracy, date: d.date }))
    .filter((p) => p.y !== null) as { x: number; y: number; date: string }[]

  if (points.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No accuracy data yet.</p>
  }

  const n = data.length
  const toSvgX = (i: number) => PAD.left + (i / (n - 1)) * innerW
  const toSvgY = (v: number) => PAD.top + (1 - v) * innerH

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toSvgX(p.x)},${toSvgY(p.y)}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, overflow: 'visible' }}>
      {/* Grid lines at 25%, 50%, 75%, 100% */}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={PAD.left} y1={toSvgY(v)} x2={W - PAD.right} y2={toSvgY(v)}
            stroke="var(--color-border)" strokeWidth={1}
          />
          <text x={PAD.left - 4} y={toSvgY(v) + 4} textAnchor="end" fontSize={10} fill="var(--color-text-muted)">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {/* Line */}
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
      {/* Dots */}
      {points.map((p, i) => (
        <circle key={i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={3} fill="var(--color-accent)">
          <title>{p.date}: {pct(p.y)}</title>
        </circle>
      ))}
      {/* X-axis labels (every ~7th point) */}
      {data.filter((_, i) => i % Math.ceil(n / 6) === 0).map((d, i) => (
        <text key={i} x={toSvgX(data.findIndex((dd) => dd.date === d.date))} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--color-text-muted)">
          {d.date.slice(5)}
        </text>
      ))}
    </svg>
  )
}
