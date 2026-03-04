import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useApi } from '../../hooks/useApi'
import { useEnrollment } from '../../utils/enrollment'

interface OptionalSet {
  id: string
  name: string
  description: string | null
  _count: { cards: number }
}

export default function OptionalSetsPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const { data: sets, loading, error, reload } = useApi<OptionalSet[]>(
    () => api.get(`/students/deck/optional?enrollmentId=${active?.enrollmentId}`),
    [active?.enrollmentId]
  )
  const [adding, setAdding] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  // Track recently added sets with the count for inline feedback before reload
  const [justAdded, setJustAdded] = useState<Record<string, number>>({})

  if (!active) { navigate('/student'); return null }

  const handleOptIn = async (cardSetId: string) => {
    setAdding(cardSetId)
    setAddError(null)
    try {
      const result = await api.post<{ ok: boolean; added: number }>(`/students/deck/optional/${cardSetId}?enrollmentId=${active.enrollmentId}`)
      // Show inline success before the set disappears from the list
      setJustAdded((prev) => ({ ...prev, [cardSetId]: result.added }))
      setTimeout(() => reload(), 1500)
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : 'Failed to opt in')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Optional CardSets</h1>
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        These CardSets are available for you to add to your deck. They are optional — your teacher has made them available but not required.
      </p>
      {loading && <div className="spinner" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {addError && <div className="alert alert-danger">{addError}</div>}
      {sets?.length === 0 && !loading && (
        <div className="alert alert-info">No optional CardSets available right now.</div>
      )}
      <div className="grid-2">
        {sets?.map((cs) => {
          const added = justAdded[cs.id]
          return (
            <div key={cs.id} className="card">
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{cs.name}</div>
              {cs.description && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>{cs.description}</div>}
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>{cs._count.cards} cards</div>
              {added !== undefined ? (
                <div className="alert alert-success" style={{ margin: 0, padding: '6px 10px', fontSize: 13 }}>
                  Added {added} card{added !== 1 ? 's' : ''} to your deck!
                </div>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={adding === cs.id}
                  onClick={() => handleOptIn(cs.id)}
                >
                  {adding === cs.id ? 'Adding…' : 'Add to Deck'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
