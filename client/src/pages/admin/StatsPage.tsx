import { useApi } from '../../hooks/useApi'
import { api } from '../../utils/api'
import StudentAdditionsTable from '../../components/StudentAdditionsTable'

interface ClassOption { id: string; name: string }

export default function AdminStatsPage() {
  const { data: classes } = useApi<ClassOption[]>(() => api.get('/admin/classes'))

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Student-Added Cards</h1>
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        Every vocabulary card students have personally added to their own decks, across the
        whole school. Defaults to last week; filter by date range or a specific class, and
        export the current view as CSV.
      </p>
      <StudentAdditionsTable fetchUrl="/admin/student-additions" classOptions={classes ?? []} />
    </div>
  )
}
