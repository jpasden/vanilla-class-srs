import { useState } from 'react'
import { useLocation, useParams, Link } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
import { api } from '../../utils/api'

interface DeckData {
  studentName: string
  className: string
  total: number
  pageSize: number
  definitionL1Label: string
  definitionL2Label: string
  cardSets: { id: string; name: string }[]
  cards: {
    id: string
    word: string
    pos: string | null
    definitionL1: string | null
    definitionL2: string | null
    exampleSentence: string | null
    cardSet: { name: string }
    origin: string
    state: string
    due: string
    lastReview: string | null
    reps: number
    lapses: number
  }[]
}
export default function StudentDeckPage() {
  const { id, studentId } = useParams()
  const admin = useLocation().pathname.startsWith('/admin')
  const root = admin ? '/admin' : '/teacher',
    apiRoot = admin ? '/admin' : '/teachers'
  const [search, setSearch] = useState(''),
    [origin, setOrigin] = useState(''),
    [state, setState] = useState(''),
    [setId, setSetId] = useState(''),
    [page, setPage] = useState(1)
  const query = new URLSearchParams({ page: String(page) })
  if (search) query.set('search', search)
  if (origin) query.set('origin', origin)
  if (state) query.set('state', state)
  if (setId) query.set('cardSetId', setId)
  const { data, loading, error } = useApi<DeckData>(
    () => api.get(`${apiRoot}/classes/${id}/students/${studentId}/deck?${query}`),
    [id, studentId, admin, search, origin, state, setId, page],
  )
  const date = (v: string | null) => (v ? new Date(v).toLocaleString() : '—')
  return (
    <div>
      <Link to={`${root}/classes/${id}`}>← Class</Link>
      <h1 className="page-title">{data?.studentName ?? 'Student'}: Full Deck</h1>
      <p>{data?.className} · Read-only card content and learning progress</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <label>
          Find word{' '}
          <input
            className="form-input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <label>
          CardSet{' '}
          <select
            className="form-select"
            value={setId}
            onChange={(e) => {
              setSetId(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            {data?.cardSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origin{' '}
          <select
            className="form-select"
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            {['TEACHER_ASSIGNED', 'OPTIONAL', 'STUDENT_ADDED'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Learning state{' '}
          <select
            className="form-select"
            value={state}
            onChange={(e) => {
              setState(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            {['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="spinner" />}
      {!loading && !error && data && (
        <>
          <p>{data.total} cards · Definitions and examples include this student's overrides.</p>
          <div className="card table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Word / POS</th>
                  <th>{data.definitionL2Label}</th>
                  <th>{data.definitionL1Label}</th>
                  <th>Example</th>
                  <th>CardSet / Origin</th>
                  <th>State</th>
                  <th>Due</th>
                  <th>Last Review</th>
                  <th>Reps / Lapses</th>
                </tr>
              </thead>
              <tbody>
                {data.cards.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.word}
                      {c.pos && <small> ({c.pos})</small>}
                    </td>
                    <td>{c.definitionL2 ?? '—'}</td>
                    <td>{c.definitionL1 ?? '—'}</td>
                    <td>{c.exampleSentence ?? '—'}</td>
                    <td>
                      {c.cardSet.name}
                      <br />
                      <small>{c.origin}</small>
                    </td>
                    <td>{c.state}</td>
                    <td>{c.state === 'NEW' ? 'Not introduced' : date(c.due)}</td>
                    <td>{date(c.lastReview)}</td>
                    <td>
                      {c.reps} / {c.lapses}
                    </td>
                  </tr>
                ))}
                {data.cards.length === 0 && (
                  <tr>
                    <td colSpan={9}>No cards match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <button
              className="btn btn-secondary"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}
