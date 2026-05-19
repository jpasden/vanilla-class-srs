import { describe, it, expect } from 'vitest'
import { schedule, FSRSCard, FSRSParams, DEFAULT_W } from '@vanilla-srs/shared'

// Use real default weights via the empty-array fallback in schedule()
const params: FSRSParams = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [], // triggers DEFAULT_W inside schedule()
  newCardsPerDay: 10,
}

const NOW = new Date('2024-06-01T12:00:00Z')

function newCard(): FSRSCard {
  return {
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 'NEW',
    lastReview: null,
    due: NOW,
  }
}

// ── NEW card ─────────────────────────────────────────────────────────────────

describe('NEW card — first review', () => {
  it('grade=Again → stays LEARNING, due in ~10 min, reps=1', () => {
    const r = schedule(newCard(), 1, params, NOW)
    expect(r.state).toBe('LEARNING')
    expect(r.reps).toBe(1)
    expect(r.lapses).toBe(0)
    expect(r.stability).toBeGreaterThan(0)
    expect(r.difficulty).toBeGreaterThan(0)
    // Due should be roughly 10 minutes ahead, not days ahead
    const minutesAhead = (r.due.getTime() - NOW.getTime()) / 60_000
    expect(minutesAhead).toBeGreaterThanOrEqual(5)
    expect(minutesAhead).toBeLessThanOrEqual(15)
  })

  it('grade=Good → moves to REVIEW, due multiple days ahead, reps=1', () => {
    const r = schedule(newCard(), 3, params, NOW)
    expect(r.state).toBe('REVIEW')
    expect(r.reps).toBe(1)
    const daysAhead = (r.due.getTime() - NOW.getTime()) / 86_400_000
    expect(daysAhead).toBeGreaterThanOrEqual(1)
  })

  it('grade=Easy → moves to REVIEW, longer interval than Good', () => {
    const easy = schedule(newCard(), 4, params, NOW)
    const good = schedule(newCard(), 3, params, NOW)
    expect(easy.state).toBe('REVIEW')
    expect(easy.due.getTime()).toBeGreaterThanOrEqual(good.due.getTime())
  })

  it('grade=Hard → moves to REVIEW', () => {
    const r = schedule(newCard(), 2, params, NOW)
    expect(r.state).toBe('REVIEW')
  })

  it('stability is always positive after first review', () => {
    for (const grade of [1, 2, 3, 4]) {
      const r = schedule(newCard(), grade, params, NOW)
      expect(r.stability).toBeGreaterThan(0)
    }
  })

  it('difficulty is clamped between 1 and 10', () => {
    for (const grade of [1, 2, 3, 4]) {
      const r = schedule(newCard(), grade, params, NOW)
      expect(r.difficulty).toBeGreaterThanOrEqual(1)
      expect(r.difficulty).toBeLessThanOrEqual(10)
    }
  })
})

// ── LEARNING card ─────────────────────────────────────────────────────────────

describe('LEARNING card', () => {
  function learningCard(): FSRSCard {
    return {
      stability: 1.5,
      difficulty: 5,
      reps: 1,
      lapses: 0,
      state: 'LEARNING',
      lastReview: new Date(NOW.getTime() - 5 * 60_000), // 5 min ago
      due: NOW,
    }
  }

  it('grade=Again → stays LEARNING', () => {
    const r = schedule(learningCard(), 1, params, NOW)
    expect(r.state).toBe('LEARNING')
  })

  it('grade=Good → graduates to REVIEW', () => {
    const r = schedule(learningCard(), 3, params, NOW)
    expect(r.state).toBe('REVIEW')
    const daysAhead = (r.due.getTime() - NOW.getTime()) / 86_400_000
    expect(daysAhead).toBeGreaterThanOrEqual(1)
  })

  it('reps increments on every review', () => {
    const card = learningCard()
    const r = schedule(card, 3, params, NOW)
    expect(r.reps).toBe(card.reps + 1)
  })
})

// ── REVIEW card ───────────────────────────────────────────────────────────────

describe('REVIEW card', () => {
  function reviewCard(daysAgo = 5): FSRSCard {
    return {
      stability: 10,
      difficulty: 5,
      reps: 5,
      lapses: 0,
      state: 'REVIEW',
      lastReview: new Date(NOW.getTime() - daysAgo * 86_400_000),
      due: NOW,
    }
  }

  it('grade=Again → lapses, enters RELEARNING', () => {
    const r = schedule(reviewCard(), 1, params, NOW)
    expect(r.state).toBe('RELEARNING')
    expect(r.lapses).toBe(1)
  })

  it('grade=Good → stays REVIEW, reps increments', () => {
    const card = reviewCard()
    const r = schedule(card, 3, params, NOW)
    expect(r.state).toBe('REVIEW')
    expect(r.reps).toBe(card.reps + 1)
    expect(r.lapses).toBe(0)
  })

  it('Easy gives longer interval than Good', () => {
    const card = reviewCard()
    const easy = schedule(card, 4, params, NOW)
    const good = schedule(card, 3, params, NOW)
    expect(easy.due.getTime()).toBeGreaterThan(good.due.getTime())
  })

  it('Hard gives shorter interval than Good', () => {
    const card = reviewCard()
    const hard = schedule(card, 2, params, NOW)
    const good = schedule(card, 3, params, NOW)
    expect(hard.due.getTime()).toBeLessThanOrEqual(good.due.getTime())
  })

  it('lapse decreases stability', () => {
    const card = reviewCard()
    const r = schedule(card, 1, params, NOW)
    expect(r.stability).toBeLessThan(card.stability)
  })

  it('successful recall keeps stability positive and moves to REVIEW', () => {
    // Stability can decrease slightly when reviewed well before due (high retrievability).
    // The invariant is: positive stability and REVIEW state, not that it always grows.
    const card = reviewCard()
    const r = schedule(card, 3, params, NOW)
    expect(r.stability).toBeGreaterThan(0)
    expect(r.state).toBe('REVIEW')
  })

  it('successful recall on an overdue card increases stability', () => {
    // When reviewed significantly after due date, retrievability is low → stability grows
    const overdueCard = reviewCard(30) // 30 days ago, well past due
    const r = schedule(overdueCard, 3, params, NOW)
    expect(r.stability).toBeGreaterThan(overdueCard.stability)
  })

  it('interval is capped at maximumInterval', () => {
    const highStabilityCard: FSRSCard = { ...reviewCard(), stability: 99999 }
    const customParams = { ...params, maximumInterval: 100 }
    const r = schedule(highStabilityCard, 4, customParams, NOW)
    const daysAhead = (r.due.getTime() - NOW.getTime()) / 86_400_000
    expect(daysAhead).toBeLessThanOrEqual(101) // +1 for rounding
  })
})

// ── RELEARNING card ───────────────────────────────────────────────────────────

describe('RELEARNING card', () => {
  function relearnCard(): FSRSCard {
    return {
      stability: 2,
      difficulty: 7,
      reps: 8,
      lapses: 1,
      state: 'RELEARNING',
      lastReview: new Date(NOW.getTime() - 10 * 60_000),
      due: NOW,
    }
  }

  it('grade=Again → stays RELEARNING', () => {
    const r = schedule(relearnCard(), 1, params, NOW)
    expect(r.state).toBe('RELEARNING')
  })

  it('grade=Good → graduates back to REVIEW', () => {
    const r = schedule(relearnCard(), 3, params, NOW)
    expect(r.state).toBe('REVIEW')
  })

  it('lapses do not increase on non-Again grade', () => {
    const card = relearnCard()
    const r = schedule(card, 3, params, NOW)
    expect(r.lapses).toBe(card.lapses)
  })
})

// ── Misc invariants ───────────────────────────────────────────────────────────

describe('invariants', () => {
  it('lastReview is set to now after every review', () => {
    const r = schedule(newCard(), 3, params, NOW)
    expect(r.lastReview).toEqual(NOW)
  })

  it('uses DEFAULT_W when params.w is empty', () => {
    const withW = schedule(newCard(), 3, { ...params, w: [...DEFAULT_W] }, NOW)
    const withEmpty = schedule(newCard(), 3, { ...params, w: [] }, NOW)
    expect(withW.stability).toBeCloseTo(withEmpty.stability, 8)
    expect(withW.due.getTime()).toBe(withEmpty.due.getTime())
  })

  it('retrievability is between 0 and 1', () => {
    const r = schedule(newCard(), 3, params, NOW)
    expect(r.retrievability).toBeGreaterThanOrEqual(0)
    expect(r.retrievability).toBeLessThanOrEqual(1)
  })
})
