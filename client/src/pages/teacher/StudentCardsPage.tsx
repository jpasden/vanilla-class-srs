/**
 * Teacher read-only view of a student's personal CardSet (spec §11).
 * Route: /teacher/classes/:classId/students/:studentId
 */
import { useParams, useLocation, Link } from 'react-router-dom'
import { api } from '../../utils/api'
import { useApi } from '../../hooks/useApi'

interface Card {
  id: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null
  createdAt: string
}

interface StudentCardsResponse {
  cards: Card[]
  definitionL2Label: string
  definitionL1Label: string
}

export default function TeacherStudentCardsPage() {
  const { id: classId, studentId } = useParams<{ id: string; studentId: string }>()
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const { data, loading, error } = useApi<StudentCardsResponse>(
    () => api.get(`${isAdmin ? '/admin' : '/teachers'}/classes/${classId}/students/${studentId}/cards`),
    [classId, studentId, isAdmin]
  )
  const cards = data?.cards

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link to={`${isAdmin ? '/admin' : '/teacher'}/classes/${classId}`} style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          ← Class
        </Link>
        <h1 className="page-title" style={{ marginTop: 4 }}>Student Personal Cards</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Read-only view of cards this student has added to their personal deck.
        </p>
      </div>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {cards?.length === 0 && (
        <div className="alert alert-info">This student has not added any personal cards yet.</div>
      )}
      {cards && cards.length > 0 && (
        <div className="card">
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Word</th>
              <th>POS</th>
              <th>{data?.definitionL2Label ?? 'L2 Definition'}</th>
              <th>{data?.definitionL1Label ?? 'L1 Definition'}</th>
              <th>Example Sentence</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500 }}>{c.word}</td>
                <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{c.pos ?? '—'}</td>
                <td style={{ fontSize: 13 }}>{c.definitionL2 ?? '—'}</td>
                <td style={{ fontSize: 13 }}>{c.definitionL1 ?? '—'}</td>
                <td style={{ fontSize: 13, fontStyle: 'italic' }}>{c.exampleSentence ?? '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
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
