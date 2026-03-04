/**
 * FSRS v5 scheduling algorithm.
 * Implements the FSRS-5 formulas exactly as published.
 * Server-side only — no client state modification.
 */

import { DEFAULT_W } from './constants'

export type FSRSState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING'

export interface FSRSCard {
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: FSRSState
  lastReview: Date | null
  due: Date
}

export interface FSRSResult {
  stability: number
  difficulty: number
  retrievability: number
  reps: number
  lapses: number
  state: FSRSState
  due: Date
  lastReview: Date
}

export interface FSRSParams {
  requestRetention: number
  maximumInterval: number
  w: number[]
  newCardsPerDay: number
}

// ── Core math helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Retrievability R = e^(-t / (9 * S)), where t = elapsed days, S = stability */
function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.pow(0.9, elapsedDays / stability)
}

/**
 * Interval from stability and target retention r.
 * FSRS v5: I(r, S) = S * ln(r) / ln(0.9)
 * At r=0.9 (default): I = S * 1 = S days.
 */
function intervalFromStability(stability: number, requestRetention: number, maximumInterval: number): number {
  const raw = stability * Math.log(requestRetention) / Math.log(0.9)
  return clamp(Math.round(raw), 1, maximumInterval)
}

// ── Initial stability (NEW card first rating) ────────────────────────────────

/** S0(G) = w[G-1], for grade 1..4 */
function initialStability(w: number[], grade: number): number {
  return Math.max(w[grade - 1], 0.1)
}

/** D0(G) = w[4] - exp(w[5] * (G - 1)) + 1 */
function initialDifficulty(w: number[], grade: number): number {
  return clamp(w[4] - Math.exp(w[5] * (grade - 1)) + 1, 1, 10)
}

// ── Stability update formulas ────────────────────────────────────────────────

/**
 * Short-term stability (LEARNING/RELEARNING states — card not yet graduated).
 * S'r(D, S, R, G) = S * exp(w[17] * (G - 3 + w[18]))
 */
function shortTermStability(w: number[], s: number, grade: number): number {
  return s * Math.exp(w[17] * (grade - 3 + w[18]))
}

/**
 * Long-term stability after a successful review (grade >= 2, REVIEW state).
 * S'r(D, S, R, G) = S * exp(w[8]) * (11 - D) * S^(-w[9]) * (exp(w[10] * (1-R)) - 1) * modifier
 * where modifier = w[15] for Hard, w[16] for Easy, 1.0 for Good
 */
function recallStability(w: number[], d: number, s: number, r: number, grade: number): number {
  const hardPenalty = grade === 2 ? w[15] : 1
  const easyBonus = grade === 4 ? w[16] : 1
  return s * Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hardPenalty * easyBonus
}

/**
 * Stability after a lapse (grade = 1, REVIEW state → RELEARNING).
 * S'f(D, S, R) = w[11] * Math.pow(D, -w[12]) * (Math.pow(S+1, w[13]) - 1) * Math.exp(w[14] * (1-R))
 */
function lapseStability(w: number[], d: number, s: number, r: number): number {
  return Math.max(
    w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r)),
    0.1,
  )
}

// ── Difficulty update ────────────────────────────────────────────────────────

/**
 * Next difficulty.
 * D'(D, G) = D - w[6] * (G - 3)
 * then mean-reverted: D'' = w[7] * D0(4) + (1 - w[7]) * D'
 */
function nextDifficulty(w: number[], d: number, grade: number): number {
  const delta = -w[6] * (grade - 3)
  const d0_4 = initialDifficulty(w, 4) // anchor: Easy rating difficulty
  const raw = w[7] * d0_4 + (1 - w[7]) * (d + delta)
  return clamp(raw, 1, 10)
}

// ── Main scheduler ───────────────────────────────────────────────────────────

/**
 * Schedule a card review. Returns the new FSRS state.
 *
 * @param card  Current card state (stability, difficulty, reps, lapses, state, lastReview, due)
 * @param grade 1=Again, 2=Hard, 3=Good, 4=Easy
 * @param params FSRS deck parameters
 * @param now   Review timestamp (default: now)
 */
export function schedule(
  card: FSRSCard,
  grade: number,
  params: FSRSParams,
  now: Date = new Date(),
): FSRSResult {
  const w = params.w.length === 19 ? params.w : [...DEFAULT_W]
  const { requestRetention, maximumInterval } = params

  const elapsedDays = card.lastReview
    ? Math.max(0, (now.getTime() - card.lastReview.getTime()) / 86_400_000)
    : 0

  let s = card.stability
  let d = card.difficulty
  let reps = card.reps
  let lapses = card.lapses
  let state = card.state

  const r = state === 'NEW' || s <= 0 ? 0 : retrievability(elapsedDays, s)

  let newS: number
  let newD: number
  let newState: FSRSState
  let intervalDays: number

  if (state === 'NEW') {
    // First review: initialise stability and difficulty from grade
    newS = initialStability(w, grade)
    newD = initialDifficulty(w, grade)
    reps = 1

    if (grade === 1) {
      // Again on a new card: stay in LEARNING with 1 min
      newState = 'LEARNING'
      intervalDays = 0 // due immediately (re-queue in session, or 1 min for next)
    } else {
      // Hard/Good/Easy on new card: move to REVIEW
      newState = 'REVIEW'
      intervalDays = intervalFromStability(newS, requestRetention, maximumInterval)
    }
  } else if (state === 'LEARNING' || state === 'RELEARNING') {
    // Short-term stability update
    newD = nextDifficulty(w, d, grade)
    newS = shortTermStability(w, s, grade)
    reps += 1

    if (grade === 1) {
      newState = state // stays in LEARNING/RELEARNING
      intervalDays = 0 // re-due quickly
    } else {
      newState = 'REVIEW'
      intervalDays = intervalFromStability(newS, requestRetention, maximumInterval)
    }
  } else {
    // REVIEW state
    newD = nextDifficulty(w, d, grade)

    if (grade === 1) {
      // Lapse
      lapses += 1
      newS = lapseStability(w, d, s, r)
      newState = 'RELEARNING'
      intervalDays = 0 // re-queue; show again in session
    } else {
      // Successful recall
      newS = recallStability(w, d, s, r, grade)
      newState = 'REVIEW'
      intervalDays = intervalFromStability(newS, requestRetention, maximumInterval)
      reps += 1
    }
  }

  // Clamp stability
  newS = Math.max(newS, 0.1)

  const due = new Date(now)
  if (intervalDays <= 0) {
    due.setMinutes(due.getMinutes() + 10) // ~10 min for lapse/learning re-show
  } else {
    due.setDate(due.getDate() + intervalDays)
    // Normalise to start of day to avoid time-zone drift
    due.setHours(0, 0, 0, 0)
  }

  const newR = retrievability(intervalDays, newS)

  return {
    stability: newS,
    difficulty: newD,
    retrievability: newR,
    reps,
    lapses,
    state: newState,
    due,
    lastReview: now,
  }
}
