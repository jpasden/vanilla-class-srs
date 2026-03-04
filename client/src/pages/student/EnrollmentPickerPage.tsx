import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { useEnrollment } from '../../utils/enrollment'

interface Enrollment {
  id: string
  class: {
    id: string
    name: string
    archivedAt: string | null
    subjectGrade: { id: string; name: string }
    teacher: { user: { name: string } }
  }
  deck: { id: string } | null
  student: { id: string }
}

export default function EnrollmentPickerPage() {
  const { data: enrollments, loading, error } = useApi<Enrollment[]>(() => api.get('/students/enrollments'))
  const { setActive } = useEnrollment()
  const navigate = useNavigate()

  const pick = (enr: Enrollment) => {
    setActive({
      enrollmentId: enr.id,
      className: enr.class.name,
      subjectGradeName: enr.class.subjectGrade.name,
    })
    navigate('/student/deck')
  }

  // Auto-pick if only one enrollment
  useEffect(() => {
    if (enrollments?.length === 1) {
      pick(enrollments[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollments])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Choose a Class</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>Select which class you want to study.</p>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {enrollments?.length === 0 && (
        <div className="alert alert-info">You are not enrolled in any classes yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {enrollments?.map((enr) => (
          <button
            key={enr.id}
            onClick={() => pick(enr)}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: '16px 20px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              display: 'block',
              width: '100%',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)' }}
          >
            <div style={{ fontWeight: 600, fontSize: 16 }}>{enr.class.name}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {enr.class.subjectGrade.name} · {enr.class.teacher.user.name}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
