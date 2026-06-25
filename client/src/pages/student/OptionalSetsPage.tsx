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
  added: boolean
}

interface BrowseCard {
  id: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null
}

interface BrowseCardsResponse {
  cards: BrowseCard[]
  definitionL2Label: string
  definitionL1Label: string
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
  const [justAdded, setJustAdded] = useState<Record<string, number>>({})
  const [browseSet, setBrowseSet] = useState<{ id: string; name: string } | null>(null)
  const [browseCards, setBrowseCards] = useState<BrowseCard[] | null>(null)
  const [browseLabels, setBrowseLabels] = useState<{ definitionL2Label: string; definitionL1Label: string }>({
    definitionL2Label: 'L2 Definition',
    definitionL1Label: 'L1 Definition',
  })
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)

  const handleBrowse = async (cs: OptionalSet) => {
    setBrowseSet({ id: cs.id, name: cs.name })
    setBrowseCards(null)
    setBrowseError(null)
    setBrowseLoading(true)
    try {
      const result = await api.get<BrowseCardsResponse>(`/students/deck/optional/${cs.id}/cards?enrollmentId=${active?.enrollmentId}`)
      setBrowseCards(result.cards)
      setBrowseLabels({ definitionL2Label: result.definitionL2Label, definitionL1Label: result.definitionL1Label })
    } catch (e) {
      setBrowseError(e instanceof ApiError ? e.message : 'Failed to load cards')
    } finally {
      setBrowseLoading(false)
    }
  }

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
        <div className="alert alert-info">No optional CardSets have been assigned to your class.</div>
      )}
      <div className="grid-2">
        {sets?.map((cs) => (
            <div key={cs.id} className="card">
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{cs.name}</div>
              {cs.description && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>{cs.description}</div>}
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>{cs._count.cards} cards</div>
                  {justAdded[cs.id] !== undefined ? (
                <div className="alert alert-success" style={{ margin: 0, padding: '6px 10px', fontSize: 13 }}>
                  Added {justAdded[cs.id]} card{justAdded[cs.id] !== 1 ? 's' : ''} to your deck!
                </div>
              ) : cs.added ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge badge-green">Already in your deck</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleBrowse(cs)}>Browse</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={adding === cs.id}
                    onClick={() => handleOptIn(cs.id)}
                  >
                    {adding === cs.id ? 'Adding…' : 'Add to Deck'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleBrowse(cs)}>Browse</button>
                </div>
              )}
            </div>
          ))}
      </div>
      {browseSet && (
        <div className="modal-overlay" onClick={() => setBrowseSet(null)}>
          <div className="modal" style={{ maxWidth: 700, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>{browseSet.name}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setBrowseSet(null)}>✕</button>
            </div>
            {browseLoading && <div className="spinner" />}
            {browseError && <div className="alert alert-danger">{browseError}</div>}
            {browseCards && (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Word</th>
                      <th>POS</th>
                      <th>{browseLabels.definitionL2Label}</th>
                      <th>{browseLabels.definitionL1Label}</th>
                      <th>Example</th>
                    </tr>
                  </thead>
                  <tbody>
                    {browseCards.length === 0 && (
                      <tr><td colSpan={5} className="table-empty">No cards in this set.</td></tr>
                    )}
                    {browseCards.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{c.word}</td>
                        <td style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{c.pos ?? '—'}</td>
                        <td>{c.definitionL2 ?? '—'}</td>
                        <td style={{ color: 'var(--color-text-muted)' }}>{c.definitionL1 ?? '—'}</td>
                        <td style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{c.exampleSentence ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
