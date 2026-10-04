import { useState } from 'react'
import { Link } from 'react-router-dom'
import ClassStatsPanel from './ClassStatsPanel'
import { useApi } from '../../hooks/useApi'
import { api } from '../../utils/api'

export default function ReadOnlyClassPage({ classId }: { classId: string }) {
  const [tab, setTab] = useState('students')
  const { data: cls, error } = useApi<{
    name: string
    teacherName: string
    subjectGrade: { id: string; name: string }
  }>(() => api.get(`/teachers/classes/${classId}`), [classId])
  const { data: students } = useApi<
    {
      id: string
      student: { id: string; user: { name: string; email: string } }
      deck: { _count: { instances: number } } | null
    }[]
  >(() => api.get(`/teachers/classes/${classId}/students`), [classId])
  const { data: assignments } = useApi<{ id: string; type: string; cardSet: { name: string } }[]>(
    () => api.get(`/teachers/classes/${classId}/assignments`),
    [classId],
  )
  const { data: hw } = useApi<{
    sessionsRequired: number
    minCardsPerSession: number
    periodDays: number
    cardSets: { name: string }[]
  } | null>(() => api.get(`/teachers/classes/${classId}/homework`), [classId])
  if (error) return <div className="alert alert-danger">{error}</div>
  return (
    <div>
      <Link to={`/teacher/leadership/${cls?.subjectGrade.id ?? ''}`}>← Subject Leadership</Link>
      <h1 className="page-title">{cls?.name}</h1>
      <p>
        {cls?.subjectGrade.name} · Teacher: {cls?.teacherName} · Read-only oversight
      </p>
      <div className="tabs">
        {['students', 'assignments', 'homework', 'stats'].map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'students' && (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Email</th>
                <th>Cards</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {students?.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link
                      to={`/teacher/classes/${classId}/students/${e.student.id}/stats`}
                      state={{ studentName: e.student.user.name }}
                    >
                      {e.student.user.name}
                    </Link>
                  </td>
                  <td>{e.student.user.email}</td>
                  <td>{e.deck?._count.instances ?? 0}</td>
                  <td>
                    <Link to={`/teacher/classes/${classId}/students/${e.student.id}/deck`}>Full Deck</Link> ·{' '}
                    <Link to={`/teacher/classes/${classId}/students/${e.student.id}`}>Personal Cards</Link>
                  </td>
                </tr>
              ))}
              {students?.length === 0 && (
                <tr>
                  <td colSpan={4}>No students enrolled.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'assignments' && (
        <div className="card">
          <h2>Assigned CardSets</h2>
          {assignments?.map((a) => (
            <p key={a.id}>
              {a.cardSet.name} · {a.type}
            </p>
          ))}
          {assignments?.length === 0 && <p>No assignments.</p>}
        </div>
      )}
      {tab === 'homework' && (
        <div className="card">
          {hw ? (
            <>
              <p>
                {hw.sessionsRequired} sessions per {hw.periodDays} days · {hw.minCardsPerSession} cards per
                session
              </p>
              <p>Focus: {hw.cardSets.map((s) => s.name).join(', ') || 'Any assigned cardsets'}</p>
            </>
          ) : (
            <p>No active homework requirement.</p>
          )}
        </div>
      )}
      {tab === 'stats' && <ClassStatsPanel classId={classId} />}
    </div>
  )
}
