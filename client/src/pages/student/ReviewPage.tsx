import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'

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
  emptyReason?: 'capped' | 'exhausted'
}

type StudyFocus =
  | null
  | { mode: 'all' }
  | { mode: 'assigned'; cardSetIds: string[]; cardSetNames: string[] }

interface WeeklyGoal {
  sessionsRequired: number
  minCardsPerSession: number
  periodDays: number
  sessionsCompleted: number
  daysRemaining: number
  cardSetFocus: StudyFocus
  justFinishedSessionCounted?: boolean | null
}

interface StatsSummary {
  weeklyGoal: WeeklyGoal | null
  deckCardSets: { id: string; name: string }[]
  personalCardSet: { id: string; cardCount: number } | null
}

type Phase = 'idle' | 'loading' | 'reviewing' | 'done'

const GRADE_LABELS: Record<number, string> = {
  1: "I don't know it.",
  2: 'I almost forgot it.',
  3: 'I know it.',
  4: "It's so easy.",
}
const GRADE_COLORS: Record<number, string> = {
  1: 'var(--color-danger)',
  2: 'var(--color-warning)',
  3: 'var(--color-accent-alt)',
  4: 'var(--color-info)',
}

// Each grade swipes off in its own diagonal direction (~30°), with "Again"/"Easy" thrown
// harder & faster than "Hard"/"Good" — approved in demos/anim-demo/next-card-final-2.html.
const SWIPE_DIRECTION: Record<number, { sx: 1 | -1; sy: 1 | -1; intense: boolean }> = {
  1: { sx: -1, sy: 1, intense: true },   // Again: left-down
  2: { sx: -1, sy: -1, intense: false }, // Hard: left-up
  3: { sx: 1, sy: -1, intense: false },  // Good: right-up
  4: { sx: 1, sy: 1, intense: true },    // Easy: right-down
}

const CONFETTI_COLORS = ['#E8698A', '#6BAF92', '#5B9BD5', '#D4900A', '#C45C3A']

const ENCOURAGEMENT: Record<'great' | 'good' | 'rough', string[]> = {
  great: ['Nailed it! 🎯', 'Outstanding work! 🌟', "You're on fire! 🔥", 'Flawless round! 💎', 'Incredible focus! 🧠✨'],
  good: ['Solid work. 👍', 'Nice progress! 📈', "You're getting there. 🚀", 'Good effort! 💪', 'Steady improvement! 🌱'],
  rough: ["Keep going — you'll get there. 🌤️", 'Practice makes progress. 📚', 'Every review counts. ✅', "Don't give up — you've got this. 💛", "Tomorrow's a new chance. 🌅"],
}

function accuracyTier(accuracyRate: number | null): 'great' | 'good' | 'rough' {
  if (accuracyRate === null) return 'good'
  if (accuracyRate >= 0.9) return 'great'
  if (accuracyRate >= 0.7) return 'good'
  return 'rough'
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

export default function ReviewPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [flipAnimClass, setFlipAnimClass] = useState('')
  const [flipStyle, setFlipStyle] = useState<{ '--tilt'?: string; '--drift'?: string; '--dur'?: string }>({})
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startTime, setStartTime] = useState<number>(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [sessionResult, setSessionResult] = useState<{ cardsReviewed: number; accuracyRate: number | null; weeklyGoal: WeeklyGoal | null } | null>(null)
  const [headline, setHeadline] = useState('')
  const [confirmFinish, setConfirmFinish] = useState(false)
  // Cards graded < 3 this session, for "Keep Studying" re-drill
  const [weakCards, setWeakCards] = useState<SessionCard[]>([])
  // Drives the grade-direction swipe-out / next-card-in animation
  const [cardAnim, setCardAnim] = useState<{ exitStyle: CSSProperties; exitMs: number } | null>(null)
  const [cardEntering, setCardEntering] = useState(false)
  const [showGradeInfo, setShowGradeInfo] = useState(false)
  // Set when a review-start attempt comes back with zero cards, so we can offer the right
  // next step (study more new words / review ahead of schedule) instead of a dead end.
  const [emptyReason, setEmptyReason] = useState<'capped' | 'exhausted' | null>(null)
  // Set when finishSession fails right after the last card is graded — the card is
  // already swiped away with nothing left to review, so rather than leave the student
  // staring at a stale card with no grade buttons, show an explicit retry affordance.
  const [finishPending, setFinishPending] = useState<{ sessionId: string; reviewed: number } | null>(null)
  const [finishing, setFinishing] = useState(false)
  const finishStageRef = useRef<HTMLDivElement>(null)
  // Synchronous double-submit guard for gradeCard — `grading` state alone isn't
  // enough, since disabled={grading} on the button doesn't take effect in the
  // DOM until the next render, leaving a window where a fast double-tap can
  // fire gradeCard twice for the same card before React re-renders.
  const gradingRef = useRef(false)

  // Drives the Study Focus dropdown. '' = All CardSets, '__homework__' = the
  // homework-assigned CardSet(s) as a group (may be more than one), or a
  // single CardSet id for a manual, one-CardSet override. A manual choice
  // only applies to the next session started — never persisted, re-derived
  // from the homework default on every load.
  const [selectedFocus, setSelectedFocus] = useState<string>('')
  const { data: summary, reload: reloadSummary } = useApi<StatsSummary>(
    () => active
      ? api.get<StatsSummary>(`/students/stats/summary?enrollmentId=${active.enrollmentId}`)
      : Promise.resolve({ weeklyGoal: null, deckCardSets: [], personalCardSet: null }),
    [active?.enrollmentId],
  )

  useEffect(() => {
    const focus = summary?.weeklyGoal?.cardSetFocus
    setSelectedFocus(focus?.mode === 'assigned' ? '__homework__' : '')
  }, [summary])

  if (!active) { navigate('/student'); return null }

  const flipCard = () => {
    if (flipped) return
    const mag = rand(0, 5)
    const tilt = Math.random() > 0.5 ? mag : -mag
    const drift = rand(-4, 4)
    setFlipStyle({ '--tilt': `${tilt.toFixed(2)}deg`, '--drift': `${drift.toFixed(1)}px`, '--dur': '0.42s' })
    setFlipAnimClass('review-pop-flip-fwd')
    setFlipped(true)
    setTimeout(() => setFlipAnimClass(''), 420)
  }

  const startSession = async (options: { bypassNewCardCap?: boolean; reviewAhead?: boolean } = {}) => {
    setPhase('loading')
    setError(null)
    setEmptyReason(null)
    setWeakCards([])
    const focus = summary?.weeklyGoal?.cardSetFocus
    const cardSetIds =
      selectedFocus === '__homework__' && focus?.mode === 'assigned' ? focus.cardSetIds
      : selectedFocus && selectedFocus !== '__homework__' ? [selectedFocus]
      : undefined
    try {
      const data = await api.post<SessionResponse>('/students/review/start', {
        enrollmentId: active.enrollmentId,
        cardSetIds,
        ...options,
      })
      if (data.cards.length === 0) {
        // Nothing to study — surface a modal offering the right next step rather than a dead end.
        setEmptyReason(data.emptyReason ?? 'exhausted')
        setPhase('idle')
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

  const keepStudying = async () => {
    if (weakCards.length === 0 || !active) return
    setPhase('loading')
    setError(null)
    try {
      const data = await api.post<SessionResponse>('/students/review/restudy', {
        enrollmentId: active.enrollmentId,
        instanceIds: weakCards.map((c) => c.instanceId),
      })
      setSession(data)
      setCardIndex(0)
      setFlipped(false)
      setCompletedCount(0)
      setSessionResult(null)
      setWeakCards([])
      setStartTime(Date.now())
      setPhase('reviewing')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to start restudy session')
      setPhase('done')
    }
  }

  const gradeCard = async (grade: number) => {
    if (!session || gradingRef.current) return
    gradingRef.current = true
    setGrading(true)
    const responseTimeMs = Date.now() - startTime

    // Swipe the card off in its grade's direction — approved in
    // demos/anim-demo/next-card-final-2.html. Fires immediately as feedback,
    // independent of how long the grade API call takes.
    const dir = SWIPE_DIRECTION[grade]
    const angleDeg = rand(26, 34)
    const radians = (angleDeg * Math.PI) / 180
    const distPct = dir.intense ? rand(135, 165) : rand(95, 120)
    const exitMs = (dir.intense ? rand(0.2, 0.26) : rand(0.3, 0.38)) * 1000
    const rotDeg = dir.intense ? rand(10, 18) : rand(3, 8)
    const dx = dir.sx * Math.cos(radians) * distPct
    const dy = dir.sy * Math.sin(radians) * distPct * 0.6
    const rotSigned = dir.sx * rotDeg
    setCardAnim({
      exitStyle: {
        transform: `translate(${dx.toFixed(1)}%, ${dy.toFixed(1)}%) rotate(${rotSigned.toFixed(1)}deg)`,
        opacity: 0,
        transition: `transform ${exitMs}ms ease, opacity ${exitMs}ms ease`,
      },
      exitMs,
    })

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
      const isLastCard = nextIndex >= newCards.length

      // Let the swipe-out finish playing before swapping in the next card (or finishing).
      setTimeout(async () => {
        setCardAnim(null)
        if (isLastCard) {
          await finishSession(session.sessionId, newCompleted)
        } else {
          if (result.requeue) {
            setSession({ ...session, cards: newCards })
          }
          setCardIndex(nextIndex)
          setFlipped(false)
          setFlipAnimClass('')
          setFlipStyle({})
          setStartTime(Date.now())
          setCompletedCount(newCompleted)
          setCardEntering(true)
          setTimeout(() => setCardEntering(false), 300)
        }
      }, exitMs)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to grade card')
      setCardAnim(null)
    } finally {
      gradingRef.current = false
      setGrading(false)
    }
  }

  const finishSession = useCallback(async (sessionId: string, reviewed?: number) => {
    setFinishing(true)
    try {
      const result = await api.post<{ cardsReviewed: number; accuracyRate: number | null; weeklyGoal: WeeklyGoal | null }>('/students/review/finish', { sessionId })
      setSessionResult(result)
      setHeadline(pickRandom(ENCOURAGEMENT[accuracyTier(result.accuracyRate)]))
      setPhase('done')
      setFinishPending(null)
      reloadSummary()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to finish session')
      setFinishPending({ sessionId, reviewed: reviewed ?? 0 })
    } finally {
      setFinishing(false)
    }
  }, [reloadSummary])

  const handleFinishEarly = () => setConfirmFinish(true)

  const currentCard = session?.cards[cardIndex]

  // Confetti that falls and settles on the ground (piles up, doesn't fade away) —
  // approved in demos/anim-demo/finish-final-2.html.
  useEffect(() => {
    if (phase !== 'done') return
    const stage = finishStageRef.current
    if (!stage) return
    stage.querySelectorAll('.review-confetti-piece').forEach((el) => el.remove())
    const stageHeight = stage.clientHeight || 320
    const groundY = stageHeight - 14
    const pieces: HTMLDivElement[] = []
    for (let i = 0; i < 55; i++) {
      const piece = document.createElement('div')
      piece.className = 'review-confetti-piece'
      const startX = Math.random() * 100
      const restX = Math.max(2, Math.min(98, startX + (Math.random() - 0.5) * 8))
      const size = 7 + Math.random() * 4
      const isCircle = Math.random() > 0.5
      piece.style.width = `${size}px`
      piece.style.height = `${isCircle ? size : size * 1.7}px`
      piece.style.borderRadius = isCircle ? '50%' : '2px'
      piece.style.background = pickRandom(CONFETTI_COLORS)
      piece.style.left = `${startX}%`
      piece.style.top = '-10px'
      const fallDur = 0.9 + Math.random() * 0.6
      const delay = Math.random() * 0.35
      const finalRot = Math.round((Math.random() - 0.5) * 100)
      piece.style.transition = `top ${fallDur}s cubic-bezier(0.3,0.6,0.7,1) ${delay}s, left ${fallDur}s ease ${delay}s, transform ${fallDur}s ease ${delay}s`
      stage.appendChild(piece)
      pieces.push(piece)
      requestAnimationFrame(() => {
        piece.style.top = `${groundY - size}px`
        piece.style.left = `${restX}%`
        piece.style.transform = `rotate(${finalRot}deg)`
      })
    }
    return () => { pieces.forEach((p) => p.remove()) }
  }, [phase, completedCount])

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {showGradeInfo && (
        <Modal title="How grading works" onClose={() => setShowGradeInfo(false)}>
          <p style={{ marginBottom: 12 }}>
            As you review your own vocabulary, your answer here is feedback to the app — it decides when
            you'll see this word again. Answering honestly (even when you don't know a word) helps you
            learn faster, since the app can focus your time on the words you actually need to practice.
          </p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li><strong>I don't know it.</strong> — You'll see this word again very soon, often later in this same session.</li>
            <li><strong>I almost forgot it.</strong> — You'll see it again sooner than usual, since it's still shaky.</li>
            <li><strong>I know it.</strong> — You'll see it again after a normal, gradually increasing gap.</li>
            <li><strong>It's so easy.</strong> — You'll see it again after an even longer gap, since you've clearly got it.</li>
          </ul>
        </Modal>
      )}

      {/* Idle */}
      {phase === 'idle' && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <img src="/Vanilla-deck.png" alt="" style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 16 }} />
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 12 }}>Study Session</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 32, fontSize: 'var(--text-base)' }}>
            Class: <strong>{active.className}</strong>
          </p>
          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
          <button className="btn btn-primary btn-lg" onClick={() => startSession()}>Start Reviewing</button>

          <div style={{ maxWidth: 320, margin: '24px auto 0', textAlign: 'left' }}>
            {summary && (
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Study Focus</label>
                <select className="form-select" value={selectedFocus} onChange={(e) => setSelectedFocus(e.target.value)}>
                  <option value="">All CardSets</option>
                  {summary.personalCardSet && (
                    <option value={summary.personalCardSet.id}>
                      Cards I added ({summary.personalCardSet.cardCount})
                    </option>
                  )}
                  {summary.weeklyGoal?.cardSetFocus?.mode === 'assigned' && (
                    <option value="__homework__">
                      Homework: {summary.weeklyGoal.cardSetFocus.cardSetNames.join(', ')}
                    </option>
                  )}
                  {summary.deckCardSets.map((cs) => (
                    <option key={cs.id} value={cs.id}>{cs.name}</option>
                  ))}
                </select>
              </div>
            )}

            {summary?.weeklyGoal && (
              <>
                <p style={{ fontSize: 'var(--text-base)', textAlign: 'center' }}>
                  <strong>
                    {summary.weeklyGoal.sessionsCompleted >= summary.weeklyGoal.sessionsRequired ? '🎉 ' : ''}
                    {summary.weeklyGoal.sessionsCompleted} of {summary.weeklyGoal.sessionsRequired} session
                    {summary.weeklyGoal.sessionsRequired !== 1 ? 's' : ''} done this week
                  </strong>
                  {' — '}{summary.weeklyGoal.minCardsPerSession} cards each.
                </p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
                  It only takes about 5 minutes for each review session. You got this!
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {phase === 'loading' && <div className="loading-center"><div className="spinner" /></div>}

      {/* Nothing to study right now — offer the right next step instead of a dead end */}
      {phase === 'idle' && emptyReason && (
        <Modal title="You're all caught up!" onClose={() => setEmptyReason(null)}>
          {emptyReason === 'capped' ? (
            <p style={{ marginBottom: 16 }}>
              You're all caught up on reviews, and you've reached today's new-word limit. Want to study
              more anyway?
            </p>
          ) : (
            <p style={{ marginBottom: 16 }}>
              You're all caught up — no new words left to learn either! You can still review your
              already-learned words ahead of schedule if you'd like.
            </p>
          )}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setEmptyReason(null)}>Maybe Later</button>
            {emptyReason === 'capped' ? (
              <button className="btn btn-primary" onClick={() => startSession({ bypassNewCardCap: true })}>
                Study More New Words
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => startSession({ reviewAhead: true })}>
                Review Early
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Reviewing */}
      {phase === 'reviewing' && currentCard && (
        <div>
          {/* Progress */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            <span>{cardIndex + 1} / {session!.cards.length}</span>
            {finishPending ? null : confirmFinish ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>End session?</span>
                <button className="btn btn-danger btn-sm" disabled={grading} onClick={async () => { await finishSession(session!.sessionId); setConfirmFinish(false) }}>End</button>
                <button className="btn btn-secondary btn-sm" disabled={grading} onClick={() => setConfirmFinish(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={handleFinishEarly}>Finish Early</button>
            )}
          </div>
          <div className="progress-bar" style={{ marginBottom: 24 }}>
            <div className="progress-fill" style={{ width: `${((cardIndex + 1) / session!.cards.length) * 100}%` }} />
          </div>

          {finishPending ? (
            /* The last card was already graded and swiped away — nothing left to
               review — but submitting the finished session failed (e.g. a dropped
               connection). Show an explicit retry instead of leaving the student
               staring at the stale, already-swiped card with no grade buttons. */
            <div className="review-flip-outer" style={{ height: 260 }}>
              <div
                className="review-flip-face"
                style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12,
                  padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 32px)', textAlign: 'center',
                  height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)', gap: 16,
                }}
              >
                <p style={{ fontSize: 'var(--text-base)' }}>
                  You finished all your cards, but we couldn't save your results — check your connection and try again.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={finishing}
                  onClick={() => finishSession(finishPending.sessionId, finishPending.reviewed)}
                >
                  {finishing ? 'Retrying…' : 'Try Again'}
                </button>
              </div>
            </div>
          ) : (
          <>
          {/* Card — 3D pop-flip with a slight random tilt/drift on each flip (demos/anim-demo/flip-final.html),
              swiped off in a grade-specific diagonal direction when graded (demos/anim-demo/next-card-final-2.html) */}
          <div
            className="review-flip-outer"
            style={{ height: 260, ...(cardAnim ? cardAnim.exitStyle : {}) }}
          >
            <div
              className={`review-flip-inner ${flipAnimClass} ${!flipAnimClass && flipped ? 'is-flipped-still' : ''} ${cardEntering ? 'review-card-enter' : ''}`}
              style={{ height: '100%', ...flipStyle }}
              onClick={flipCard}
            >
              {/* Front */}
              <div
                className="review-flip-face"
                style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12,
                  padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 32px)', textAlign: 'center', cursor: flipped ? 'default' : 'pointer',
                  height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ fontSize: 'clamp(24px, 7vw, 36px)', fontWeight: 700, marginBottom: 8, wordBreak: 'break-word' }}>{currentCard.word}</div>
                {currentCard.pos && (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{currentCard.pos}</div>
                )}
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 24 }}>Tap to reveal</p>
              </div>

              {/* Back */}
              <div
                className="review-flip-face back"
                style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12,
                  padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 32px)', textAlign: 'center',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)', overflowY: 'auto',
                }}
              >
                {currentCard.definitionL2 && (
                  <p style={{ fontSize: 'var(--text-lg)', marginBottom: 8 }}>{currentCard.definitionL2}</p>
                )}
                {currentCard.definitionL1 && (
                  <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginBottom: 8 }}>{currentCard.definitionL1}</p>
                )}
                {currentCard.exampleSentence && (
                  <p style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--color-text-muted)', marginTop: 12 }}>
                    "{currentCard.exampleSentence}"
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Grade buttons — vertically stacked, full width */}
          {flipped && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>How well do you know this?</span>
                <button
                  type="button"
                  onClick={() => setShowGradeInfo(true)}
                  aria-label="More information about these options"
                  style={{
                    width: 16, height: 16, borderRadius: '50%', border: 'none', padding: 0,
                    background: 'var(--color-info)', color: 'var(--color-vanilla)',
                    fontSize: 10, fontWeight: 700, lineHeight: '16px', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ?
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {[1, 2, 3, 4].map((g) => (
                  <button
                    key={g}
                    className="btn"
                    style={{
                      background: GRADE_COLORS[g],
                      color: 'var(--color-vanilla)',
                      fontSize: 'var(--text-base)',
                      padding: '14px 16px',
                      width: '100%',
                      justifyContent: 'center',
                    }}
                    disabled={grading}
                    onClick={() => gradeCard(g)}
                  >
                    {GRADE_LABELS[g]}
                  </button>
                ))}
              </div>
            </>
          )}
          </>
          )}

          {error && <div className="alert alert-danger" style={{ marginTop: 16 }}>{error}</div>}
        </div>
      )}

      {/* Done — confetti settles on the ground + drawn checkmark + big glowing stat numbers +
          randomly-picked encouragement headline, approved in demos/anim-demo/finish-final-2.html.
          (That demo's personal-best ribbon and streak counter are not wired in yet — no
          backend data source for either exists; see project memory for the follow-up.) */}
      {phase === 'done' && (
        <div ref={finishStageRef} className="review-finish-stage" style={{ minHeight: 320, padding: '32px 16px' }}>
          <svg className="review-check-svg" viewBox="0 0 80 80" key={`check-${completedCount}`}>
            <circle className="review-check-circle draw" cx="40" cy="40" r="32" />
            <path className="review-check-mark draw" d="M24 41 L35 52 L57 28" />
          </svg>
          <h2 className="review-reward-title">{headline}</h2>
          {sessionResult && (
            <div className="review-big-stats">
              <div>
                <span
                  key={`stat-a-${completedCount}`}
                  className="review-big-stat-value review-shake-glow-settle"
                  style={{ '--glow-color': pickRandom(CONFETTI_COLORS) } as CSSProperties}
                >
                  {sessionResult.cardsReviewed}
                </span>
                <div className="review-big-stat-label">Cards Reviewed</div>
              </div>
              <div>
                <span
                  key={`stat-b-${completedCount}`}
                  className="review-big-stat-value review-shake-glow-settle"
                  style={{ '--glow-color': pickRandom(CONFETTI_COLORS), animationDelay: '0.1s' } as CSSProperties}
                >
                  {sessionResult.accuracyRate !== null ? `${Math.round(sessionResult.accuracyRate * 100)}%` : '—'}
                </span>
                <div className="review-big-stat-label">Accuracy</div>
              </div>
            </div>
          )}
          {sessionResult?.weeklyGoal && (
            <div style={{ marginTop: 8, position: 'relative', zIndex: 2 }}>
              <p style={{ fontSize: 'var(--text-base)', textAlign: 'center' }}>
                {sessionResult.weeklyGoal.sessionsCompleted >= sessionResult.weeklyGoal.sessionsRequired
                  ? <>🎉 Homework done for this week — {sessionResult.weeklyGoal.sessionsCompleted}/{sessionResult.weeklyGoal.sessionsRequired} sessions.</>
                  : <>{sessionResult.weeklyGoal.sessionsCompleted} of {sessionResult.weeklyGoal.sessionsRequired} sessions done this week.</>}
              </p>
              {sessionResult.weeklyGoal.justFinishedSessionCounted === false && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 4 }}>
                  (You need to space your reviews out more for them to count for the assignment. Best to wait about 24 hours.)
                </p>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16, position: 'relative', zIndex: 2 }}>
            {weakCards.length > 0 && (
              <button className="btn btn-primary" onClick={keepStudying}>
                Keep Studying ({weakCards.length} weak {weakCards.length === 1 ? 'card' : 'cards'})
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => startSession()}>Keep Reviewing</button>
            <button className="btn btn-secondary" onClick={() => navigate('/student/stats')}>View Stats</button>
          </div>
        </div>
      )}
    </div>
  )
}
