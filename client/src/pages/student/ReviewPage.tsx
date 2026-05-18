import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'

interface SessionCard {
  instanceId: string
  cardId: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null
  state: string
}

interface SessionResponse {
  sessionId: string
  cards: SessionCard[]
  totalCards: number
}

type Phase = 'idle' | 'loading' | 'reviewing' | 'done' | 'empty'

const GRADE_LABELS: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }
const GRADE_COLORS: Record<number, string> = {
  1: 'var(--color-danger)',
  2: 'var(--color-warning)',
  3: 'var(--color-accent-alt)',
  4: 'var(--color-accent-alt)',
}

export default function ReviewPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startTime, setStartTime] = useState<number>(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [sessionResult, setSessionResult] = useState<{ cardsReviewed: number; accuracyRate: number | null } | null>(null)
  // Cards graded < 3 this session, for "Keep Studying" re-drill
  const [weakCards, setWeakCards] = useState<SessionCard[]>([])

  if (!active) { navigate('/student'); return null }

  const startSession = async () => {
    setPhase('loading')
    setError(null)
    setWeakCards([])
    try {
      const data = await api.post<SessionResponse>('/students/review/start', { enrollmentId: active.enrollmentId })
      if (data.cards.length === 0) {
        setPhase('empty')
        return
      }
      setSession(data)
      setCardIndex(0)
      setFlipped(false)
      setCompletedCount(0)
      setSessionResult(null)
      setStartTime(Date.now())
      setPhase('reviewing')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to start session')
      setPhase('idle')
    }
  }

  const keepStudying = () => {
    if (weakCards.length === 0) return
    const fakeSession: SessionResponse = {
      sessionId: session?.sessionId ?? '',
      cards: weakCards,
      totalCards: weakCards.length,
    }
    setSession(fakeSession)
    setCardIndex(0)
    setFlipped(false)
    setCompletedCount(0)
    setSessionResult(null)
    setWeakCards([])
    setStartTime(Date.now())
    setPhase('reviewing')
  }

  const gradeCard = async (grade: number) => {
    if (!session || grading) return
    setGrading(true)
    const responseTimeMs = Date.now() - startTime
    try {
      const result = await api.post<{ requeue: boolean }>('/students/review/grade', {
        sessionId: session.sessionId,
        instanceId: session.cards[cardIndex].instanceId,
        grade,
        responseTimeMs,
      })

      const newCompleted = completedCount + 1

      // Track weak cards (grade < 3) for "Keep Studying" — deduplicated by instanceId
      if (grade < 3) {
        const card = session.cards[cardIndex]
        setWeakCards((prev) =>
          prev.some((c) => c.instanceId === card.instanceId) ? prev : [...prev, card]
        )
      }

      // Build the new cards array synchronously so all derived values use the same snapshot
      const newCards = result.requeue
        ? [...session.cards, session.cards[cardIndex]]
        : session.cards

      const nextIndex = cardIndex + 1

      if (nextIndex >= newCards.length) {
        // Finished all cards — finish session
        await finishSession(session.sessionId, newCompleted)
      } else {
        if (result.requeue) {
          setSession({ ...session, cards: newCards })
        }
        setCardIndex(nextIndex)
        setFlipped(false)
        setStartTime(Date.now())
        setCompletedCount(newCompleted)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to grade card')
    } finally {
      setGrading(false)
    }
  }

  const finishSession = useCallback(async (sessionId: string, reviewed?: number) => {
    try {
      const result = await api.post<{ cardsReviewed: number; accuracyRate: number | null }>('/students/review/finish', { sessionId })
      setSessionResult(result)
      setPhase('done')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to finish session')
    }
  }, [])

  const handleFinishEarly = async () => {
    if (!session || !confirm('End session now? Your progress so far will be saved.')) return
    await finishSession(session.sessionId)
  }

  const currentCard = session?.cards[cardIndex]

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {/* Idle */}
      {phase === 'idle' && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <img src="/Vanilla-deck.png" alt="" style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 16 }} />
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Study Session</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 32, fontSize: 15 }}>
            Class: <strong>{active.className}</strong>
          </p>
          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
          <button className="btn btn-primary btn-lg" onClick={startSession}>Start Session</button>
        </div>
      )}

      {/* Loading */}
      {phase === 'loading' && <div className="loading-center"><div className="spinner" /></div>}

      {/* Empty — no due cards */}
      {phase === 'empty' && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <img src="/Vanilla-deck.png" alt="" style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 16 }} />
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>All caught up!</h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            No cards are due right now. Come back later!
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {weakCards.length > 0 && (
              <button className="btn btn-primary" onClick={keepStudying}>
                Keep Studying ({weakCards.length} weak {weakCards.length === 1 ? 'card' : 'cards'})
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => navigate('/student/stats')}>View Stats</button>
          </div>
        </div>
      )}

      {/* Reviewing */}
      {phase === 'reviewing' && currentCard && (
        <div>
          {/* Progress */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
            <span>{cardIndex + 1} / {session!.cards.length}</span>
            <button className="btn btn-secondary btn-sm" onClick={handleFinishEarly}>Finish Early</button>
          </div>
          <div className="progress-bar" style={{ marginBottom: 24 }}>
            <div className="progress-fill" style={{ width: `${(cardIndex / session!.cards.length) * 100}%` }} />
          </div>

          {/* Card */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 32px)',
              textAlign: 'center',
              cursor: flipped ? 'default' : 'pointer',
              minHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
            onClick={() => !flipped && setFlipped(true)}
          >
            {/* Front */}
            <div style={{ fontSize: 'clamp(24px, 7vw, 36px)', fontWeight: 700, marginBottom: 8, wordBreak: 'break-word' }}>{currentCard.word}</div>
            {currentCard.pos && (
              <div style={{ fontSize: 14, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{currentCard.pos}</div>
            )}

            {/* Back */}
            {flipped && (
              <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border)', paddingTop: 20, width: '100%' }}>
                {currentCard.definitionL2 && (
                  <p style={{ fontSize: 17, marginBottom: 8 }}>{currentCard.definitionL2}</p>
                )}
                {currentCard.definitionL1 && (
                  <p style={{ fontSize: 15, color: 'var(--color-text-muted)', marginBottom: 8 }}>{currentCard.definitionL1}</p>
                )}
                {currentCard.exampleSentence && (
                  <p style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--color-text-muted)', marginTop: 12 }}>
                    "{currentCard.exampleSentence}"
                  </p>
                )}
              </div>
            )}

            {!flipped && (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 24 }}>Tap to reveal</p>
            )}
          </div>

          {/* Grade buttons — 2×2 grid so all four fit on 375px */}
          {flipped && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 24 }}>
              {[1, 2, 3, 4].map((g) => (
                <button
                  key={g}
                  className="btn"
                  style={{
                    background: GRADE_COLORS[g],
                    color: 'var(--color-vanilla)',
                    fontSize: 15,
                    padding: '14px 8px',
                    justifyContent: 'center',
                  }}
                  disabled={grading}
                  onClick={() => gradeCard(g)}
                >
                  {GRADE_LABELS[g]}
                </button>
              ))}
            </div>
          )}

          {error && <div className="alert alert-danger" style={{ marginTop: 16 }}>{error}</div>}
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <img src="/Vanilla-deck.png" alt="" style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 16 }} />
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Session Complete</h2>
          {sessionResult && (
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 24 }}>
              <div className="stat-block">
                <div className="stat-value">{sessionResult.cardsReviewed}</div>
                <div className="stat-label">Cards Reviewed</div>
              </div>
              <div className="stat-block">
                <div className="stat-value">
                  {sessionResult.accuracyRate !== null
                    ? `${Math.round(sessionResult.accuracyRate * 100)}%`
                    : '—'}
                </div>
                <div className="stat-label">Accuracy</div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {weakCards.length > 0 && (
              <button className="btn btn-primary" onClick={keepStudying}>
                Keep Studying ({weakCards.length} weak {weakCards.length === 1 ? 'card' : 'cards'})
              </button>
            )}
            <button className="btn btn-secondary" onClick={startSession}>New Session</button>
            <button className="btn btn-secondary" onClick={() => navigate('/student/stats')}>View Stats</button>
          </div>
        </div>
      )}
    </div>
  )
}
