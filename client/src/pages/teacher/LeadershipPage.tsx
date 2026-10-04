import { useState, useEffect } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { SimpleBarChart, AccuracyLineChart } from '../../components/Charts'
import StudentAdditionsTable from '../../components/StudentAdditionsTable'
import ClassStatsPanel from './ClassStatsPanel'

interface Group {
  id: string
  name: string
  department: { name: string }
  lead: { teacherId: string } | null
  teachers: { teacherId: string; teacher: { user: { name: string; email: string } } }[]
  classes: { id: string; name: string; teacherId: string }[]
}
interface StudentRow {
  enrollmentId: string
  studentId: string
  studentName: string
  classId: string
  className: string
  teacherName: string
  reviews: number
  accuracy: number | null
  cards: number
  overdue: number
  homeworkStatus: string | null
}
interface Report {
  range: { days: number; timeZone: string; first: string; today: string }
  summary: {
    classes: number
    students: number
    enrollments: number
    reviews: number
    accuracy: number | null
    sessions: number
    deckStates: Record<string, number>
    overdue: number
    homeworkMet: number
    homeworkEligible: number
    homeworkAtRisk: number
    homeworkNotMet: number
    withoutRequirement: number
  }
  classes: {
    classId: string
    className: string
    teacherName: string
    students: number
    reviews: number
    accuracy: number | null
    sessions: number
    homeworkMet: number
    homeworkEligible: number
    additions: number
  }[]
  daily: { date: string; reviews: number; growth: number; accuracy: number | null }[]
  forecast: { date: string; due: number }[]
  adoption: { cardSetId: string; name: string; adopted: number; eligible: number }[]
}
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)

export default function LeadershipPage() {
  const { id } = useParams()
  const admin = useLocation().pathname.startsWith('/admin')
  const base = admin ? '/admin' : '/teachers',
    root = admin ? '/admin' : '/teacher'
  return id ? <GroupReport key={id} id={id} base={base} root={root} /> : <GroupList base={base} root={root} />
}
function GroupList({ base, root }: { base: string; root: string }) {
  const { data, loading, error, reload } = useApi<
    { id: string; name: string; department: { name: string } }[]
  >(() => api.get(`${base}/leadership`), [base])
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{root === '/admin' ? 'Subject/Grade Reports' : 'Subject Leadership'}</h1>
        <button className="btn btn-secondary" onClick={reload}>
          Refresh
        </button>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {data?.length === 0 && <p>No active Subject/Grades available for leadership.</p>}
      <div className="grid-2">
        {data?.map((g) => (
          <div className="card" key={g.id}>
            <h2>{g.name}</h2>
            <p>{g.department.name}</p>
            <Link className="btn btn-primary" to={`${root}/leadership/${g.id}`}>
              Open
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
function GroupReport({ id, base, root }: { id: string; base: string; root: string }) {
  const [params, setParams] = useSearchParams()
  const selected = params.get('class') ?? ''
  const parsedDays = Number(params.get('days') || 30)
  const days = [7, 14, 30, 60, 90].includes(parsedDays) ? parsedDays : 30
  const [tab, setTab] = useState('overview')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const url = `${base}/leadership/${id}`
  const { data: group, loading, error, reload } = useApi<Group>(() => api.get(url), [url])
  const {
    data: stats,
    error: statsError,
    loading: statsLoading,
    reload: reloadStats,
  } = useApi<Report>(() => api.get(`${url}/stats?days=${days}&tz=${encodeURIComponent(tz)}`), [url, days, tz])
  const select = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    value ? next.set(key, value) : next.delete(key)
    setParams(next)
  }
  if (loading) return <div className="spinner" />
  if (error || !group) return <div className="alert alert-danger">{error ?? 'Subject/Grade unavailable'}</div>
  const cls = group.classes.find((c) => c.id === selected)
  const lead = group.teachers.find((t) => t.teacherId === group.lead?.teacherId)
  return (
    <div>
      <Link to={`${root}/leadership`}>
        ← {root === '/admin' ? 'Subject/Grade Reports' : 'Subject Leadership'}
      </Link>
      <h1 className="page-title">{group.name}</h1>
      <p>
        {group.department.name} · SL: {lead?.teacher.user.name ?? 'Unassigned'}
      </p>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Teachers ({group.teachers.length})</h2>
        {group.teachers.length === 0 && <p>No teachers assigned.</p>}
        {group.teachers.map((t) => (
          <p key={t.teacherId}>
            <strong>{t.teacher.user.name}</strong>
            {t.teacherId === group.lead?.teacherId ? ' · SL' : ''} · {t.teacher.user.email} ·{' '}
            {group.classes.filter((c) => c.teacherId === t.teacherId).length} active classes
          </p>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <label>
          Report scope{' '}
          <select className="form-select" value={selected} onChange={(e) => select('class', e.target.value)}>
            <option value="">Entire Subject/Grade</option>
            {group.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {group.teachers.find((t) => t.teacherId === c.teacherId)?.teacher.user.name}
              </option>
            ))}
          </select>
        </label>
        {!selected && (
          <label>
            Lookback{' '}
            <select className="form-select" value={days} onChange={(e) => select('days', e.target.value)}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => {
            reload()
            reloadStats()
          }}
        >
          Refresh
        </button>
      </div>
      {selected ? (
        cls ? (
          <>
            <p>
              <Link to={`${root}/classes/${cls.id}`}>
                Open {cls.name}: roster, cards, assignments and homework
              </Link>
            </p>
            <ClassStatsPanel key={cls.id} classId={cls.id} basePath={base as '/admin' | '/teachers'} />
          </>
        ) : (
          <p className="alert alert-danger">This class is not part of this Subject/Grade.</p>
        )
      ) : (
        <>
          {statsError && <div className="alert alert-danger">{statsError}</div>}
          {statsLoading && <div className="spinner" />}
          {!statsLoading && !statsError && stats && (
            <>
              <p>
                {stats.range.first} – {stats.range.today} · {stats.range.timeZone}. Current homework/deck
                snapshots and future forecasts are labeled separately.
              </p>
              <div className="tabs">
                {[
                  ['overview', 'Overview'],
                  ['students', 'Students'],
                  ['activity', 'Activity'],
                  ['compliance', 'Compliance'],
                  ['cards', 'Card Stats'],
                  ['adoption', 'Optional Adoption'],
                  ['additions', 'Student Additions'],
                  ['matrix', 'Mastery Matrix'],
                ].map(([t, label]) => (
                  <button className={`tab${tab === t ? ' active' : ''}`} key={t} onClick={() => setTab(t)}>
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'overview' && (
                <>
                  <div className="grid-3" style={{ marginBottom: 20 }}>
                    {[
                      ['Unique students', stats.summary.students],
                      ['Active enrollments', stats.summary.enrollments],
                      ['Classes', stats.summary.classes],
                      ['Cards reviewed', stats.summary.reviews],
                      ['Accuracy', pct(stats.summary.accuracy)],
                      ['Completed sessions', stats.summary.sessions],
                    ].map(([label, value]) => (
                      <div className="card stat-block" key={label}>
                        <div className="stat-value">{value}</div>
                        <div className="stat-label">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="card table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Class</th>
                          <th>Teacher</th>
                          <th>Students</th>
                          <th>Homework met (current)</th>
                          <th>Additions</th>
                          <th>Accuracy</th>
                          <th>Cards reviewed</th>
                          <th>Sessions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.classes.map((c) => (
                          <tr key={c.classId}>
                            <td>
                              <Link to={`${root}/classes/${c.classId}`}>{c.className}</Link> ·{' '}
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => select('class', c.classId)}
                              >
                                Stats
                              </button>
                            </td>
                            <td>{c.teacherName}</td>
                            <td>{c.students}</td>
                            <td>
                              {c.homeworkEligible
                                ? `${c.homeworkMet}/${c.homeworkEligible}`
                                : 'No requirement'}
                            </td>
                            <td>{c.additions}</td>
                            <td>{pct(c.accuracy)}</td>
                            <td>{c.reviews}</td>
                            <td>{c.sessions}</td>
                          </tr>
                        ))}
                        {!stats.classes.length && (
                          <tr>
                            <td colSpan={8}>No active classes.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {(tab === 'students' || tab === 'compliance') && (
                <>
                  {tab === 'compliance' && (
                    <div className="card">
                      <h2>Current homework compliance</h2>
                      <p>
                        {stats.summary.homeworkMet} / {stats.summary.homeworkEligible} eligible enrollments
                        met their own class requirement ·{' '}
                        {pct(
                          stats.summary.homeworkEligible
                            ? stats.summary.homeworkMet / stats.summary.homeworkEligible
                            : null,
                        )}
                      </p>
                      <p>
                        At risk: {stats.summary.homeworkAtRisk} · Not met: {stats.summary.homeworkNotMet} · No
                        requirement: {stats.summary.withoutRequirement}
                      </p>
                      <p>Requirements and periods may differ between classes.</p>
                    </div>
                  )}
                  <StudentReport
                    url={`${url}/students?days=${days}&tz=${encodeURIComponent(tz)}`}
                    root={root}
                  />
                </>
              )}
              {tab === 'activity' && (
                <>
                  <div className="card">
                    <h2>Cards reviewed per day</h2>
                    <SimpleBarChart
                      data={stats.daily.map((d) => ({ label: d.date.slice(5), value: d.reviews }))}
                    />
                    <h2>Rolling seven-day accuracy</h2>
                    <AccuracyLineChart data={stats.daily} />
                    <h2>Cards added per day</h2>
                    <SimpleBarChart
                      data={stats.daily.map((d) => ({ label: d.date.slice(5), value: d.growth }))}
                    />
                  </div>
                  <div className="card">
                    <h2>Current deck states</h2>
                    <p>
                      {Object.entries(stats.summary.deckStates)
                        .map(([state, n]) => `${state}: ${n}`)
                        .join(' · ')}
                    </p>
                    <p>Overdue now: {stats.summary.overdue}</p>
                    <h2>Future due dates (current schedule)</h2>
                    <SimpleBarChart
                      data={stats.forecast.map((d) => ({ label: d.date.slice(5), value: d.due }))}
                    />
                  </div>
                </>
              )}
              {tab === 'adoption' && (
                <div className="card table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Optional CardSet</th>
                        <th>Adopted enrollments</th>
                        <th>Eligible enrollments</th>
                        <th>Adoption</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.adoption.map((a) => (
                        <tr key={a.cardSetId}>
                          <td>{a.name}</td>
                          <td>{a.adopted}</td>
                          <td>{a.eligible}</td>
                          <td>{pct(a.eligible ? a.adopted / a.eligible : null)}</td>
                        </tr>
                      ))}
                      {!stats.adoption.length && (
                        <tr>
                          <td colSpan={4}>No optional assignments.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {tab === 'cards' && (
                <CardStats url={`${url}/cards?days=${days}&tz=${encodeURIComponent(tz)}`} />
              )}
              {tab === 'additions' && (
                <StudentAdditionsTable fetchUrl={`${url}/student-additions`} timeZone={tz} />
              )}
              {tab === 'matrix' && <Matrix url={`${url}/matrix`} root={root} />}
            </>
          )}
        </>
      )}
    </div>
  )
}
function StudentReport({ url, root }: { url: string; root: string }) {
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [url])
  const { data, error, loading } = useApi<{ rows: StudentRow[]; total: number; pageSize: number }>(
    () => api.get(`${url}&page=${page}`),
    [url, page],
  )
  return (
    <>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {!loading && !error && data && (
        <>
          <StudentTable rows={data.rows} root={root} />
          <Pager page={page} total={data.total} size={data.pageSize} change={setPage} />
        </>
      )}
    </>
  )
}

function StudentTable({ rows, root }: { rows: StudentRow[]; root: string }) {
  return (
    <div className="card table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Class / Teacher</th>
            <th>Cards reviewed</th>
            <th>Accuracy</th>
            <th>Deck / Overdue</th>
            <th>Homework (current)</th>
            <th>Cards</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.enrollmentId}>
              <td>
                <Link
                  to={`${root}/classes/${s.classId}/students/${s.studentId}/stats`}
                  state={{ studentName: s.studentName }}
                >
                  {s.studentName}
                </Link>
              </td>
              <td>
                {s.className} / {s.teacherName}
              </td>
              <td>{s.reviews}</td>
              <td>{pct(s.accuracy)}</td>
              <td>
                {s.cards} / {s.overdue}
              </td>
              <td>{s.homeworkStatus ?? 'No requirement'}</td>
              <td>
                <Link to={`${root}/classes/${s.classId}/students/${s.studentId}/deck`}>Full Deck</Link>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={7}>No active enrollments.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
function Pager({
  page,
  total,
  size,
  change,
}: {
  page: number
  total: number
  size: number
  change: (p: number) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
      <button className="btn btn-secondary" disabled={page === 1} onClick={() => change(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {Math.max(1, Math.ceil(total / size))}
      </span>
      <button className="btn btn-secondary" disabled={page * size >= total} onClick={() => change(page + 1)}>
        Next
      </button>
    </div>
  )
}
function CardStats({ url }: { url: string }) {
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [url])
  const { data, loading, error } = useApi<{
    total: number
    pageSize: number
    rows: {
      cardId: string
      word: string
      cardSetName: string
      possessing: number
      reviewed: number
      reps: number
      accuracy: number | null
    }[]
  }>(() => api.get(`${url}&page=${page}`), [url, page])
  return (
    <>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {!loading && !error && data && (
        <>
          <p>
            Card accuracy is weighted by review events within the selected lookback. Possessing enrollments
            are counted currently.
          </p>
          <div className="card table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Card</th>
                  <th>CardSet</th>
                  <th>Accuracy</th>
                  <th>Reviews</th>
                  <th>Reviewed / Possessing</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.cardId}>
                    <td>{c.word}</td>
                    <td>{c.cardSetName}</td>
                    <td>{pct(c.accuracy)}</td>
                    <td>{c.reps}</td>
                    <td>
                      {c.reviewed} / {c.possessing}
                    </td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr>
                    <td colSpan={5}>No cards.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} size={data.pageSize} change={setPage} />
        </>
      )}
    </>
  )
}
function Matrix({ url, root }: { url: string; root: string }) {
  const [page, setPage] = useState(1),
    [cardPage, setCardPage] = useState(1)
  const { data, loading, error } = useApi<{
    total: number
    cardTotal: number
    cards: { id: string; word: string; cardSet: { name: string } }[]
    rows: {
      enrollmentId: string
      studentId: string
      classId: string
      name: string
      className: string
      cells: Record<string, { reps: number; accuracy: number | null }>
    }[]
  }>(() => api.get(`${url}?page=${page}&cardPage=${cardPage}`), [url, page, cardPage])
  return (
    <>
      <p>Lifetime mastery · one row per class enrollment. Cards with the same word remain separate.</p>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="card table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Student / Class</th>
                  {data.cards.map((c) => (
                    <th key={c.id} title={c.cardSet.name}>
                      {c.word}
                      <br />
                      <small>{c.cardSet.name}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.enrollmentId}>
                    <td>
                      <Link
                        to={`${root}/classes/${r.classId}/students/${r.studentId}/stats`}
                        state={{ studentName: r.name }}
                      >
                        {r.name}
                      </Link>
                      <br />
                      {r.className}
                    </td>
                    {data.cards.map((c) => (
                      <td key={c.id}>
                        {r.cells[c.id] ? `${pct(r.cells[c.id].accuracy)} (${r.cells[c.id].reps})` : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && <p>No active enrollments.</p>}
          </div>
          <p>Student rows</p>
          <Pager page={page} total={data.total} size={25} change={setPage} />
          <p>Card columns</p>
          <Pager page={cardPage} total={data.cardTotal} size={25} change={setCardPage} />
        </>
      )}
    </>
  )
}
