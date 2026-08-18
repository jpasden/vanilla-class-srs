import { describe, it, expect, vi } from 'vitest'
import {
  getCalendarWeekBounds,
  getTodayBounds,
  getPeriodBounds,
  hasMetTodaysQuota,
  getAutoStudyFocus,
  countQualifyingDays,
  DEFAULT_MIN_CARDS_PER_SESSION,
  DEFAULT_PERIOD_DAYS,
} from '../services/homework.service'

describe('getCalendarWeekBounds', () => {
  it('anchors to the most recent Monday 00:00 when now is mid-week', () => {
    // Wednesday 2026-08-19 14:30
    const now = new Date(2026, 7, 19, 14, 30)
    const { periodStart, periodEnd } = getCalendarWeekBounds(now)
    expect(periodStart).toEqual(new Date(2026, 7, 17, 0, 0, 0, 0)) // Monday
    expect(periodEnd).toEqual(new Date(2026, 7, 24, 0, 0, 0, 0)) // next Monday
  })

  it('treats Monday 00:00:00.000 itself as the start of that week, not the previous one', () => {
    const now = new Date(2026, 7, 17, 0, 0, 0, 0) // exactly Monday midnight
    const { periodStart, periodEnd } = getCalendarWeekBounds(now)
    expect(periodStart).toEqual(new Date(2026, 7, 17, 0, 0, 0, 0))
    expect(periodEnd).toEqual(new Date(2026, 7, 24, 0, 0, 0, 0))
  })

  it('treats Sunday 23:59:59.999 as still within that same week', () => {
    const now = new Date(2026, 7, 23, 23, 59, 59, 999) // Sunday, end of week
    const { periodStart, periodEnd } = getCalendarWeekBounds(now)
    expect(periodStart).toEqual(new Date(2026, 7, 17, 0, 0, 0, 0))
    expect(periodEnd).toEqual(new Date(2026, 7, 24, 0, 0, 0, 0))
  })

  it('handles Sunday correctly (getDay() === 0, the trickiest case for a Monday-anchor)', () => {
    const now = new Date(2026, 7, 23, 9, 0) // Sunday morning
    const { periodStart } = getCalendarWeekBounds(now)
    expect(periodStart).toEqual(new Date(2026, 7, 17, 0, 0, 0, 0))
  })
})

describe('getTodayBounds', () => {
  it('returns today 00:00 to tomorrow 00:00', () => {
    const now = new Date(2026, 7, 19, 14, 30)
    const { dayStart, dayEnd } = getTodayBounds(now)
    expect(dayStart).toEqual(new Date(2026, 7, 19, 0, 0, 0, 0))
    expect(dayEnd).toEqual(new Date(2026, 7, 20, 0, 0, 0, 0))
  })
})

describe('getPeriodBounds', () => {
  it('uses calendar-week bounds for the default periodDays', () => {
    const now = new Date(2026, 7, 19, 14, 30)
    const result = getPeriodBounds({ activeFrom: new Date(2026, 0, 1), periodDays: DEFAULT_PERIOD_DAYS }, now)
    expect(result.periodStart).toEqual(new Date(2026, 7, 17, 0, 0, 0, 0))
  })

  it('falls back to anchored math for a non-default periodDays', () => {
    const activeFrom = new Date(2026, 7, 1, 0, 0, 0, 0)
    const now = new Date(2026, 7, 5, 0, 0, 0, 0) // 4 days after a 3-day-period anchor
    const result = getPeriodBounds({ activeFrom, periodDays: 3 }, now)
    // periodsComplete = floor(4 days / 3 days) = 1 -> periodStart = activeFrom + 3 days
    expect(result.periodStart).toEqual(new Date(2026, 7, 4, 0, 0, 0, 0))
    expect(result.periodEnd).toEqual(new Date(2026, 7, 7, 0, 0, 0, 0))
  })
})

describe('hasMetTodaysQuota', () => {
  function makePrisma(count: number) {
    return { reviewSession: { count: vi.fn().mockResolvedValue(count) } }
  }

  it('is true when at least one qualifying session ended today', async () => {
    const prisma = makePrisma(1)
    const result = await hasMetTodaysQuota(prisma as any, 'deck-1', 20, new Date(2026, 7, 19, 14))
    expect(result).toBe(true)
    expect(prisma.reviewSession.count).toHaveBeenCalledWith({
      where: {
        deckId: 'deck-1',
        endedAt: { gte: new Date(2026, 7, 19, 0, 0, 0, 0), lt: new Date(2026, 7, 20, 0, 0, 0, 0) },
        cardsReviewed: { gte: 20 },
      },
    })
  })

  it('is false when no qualifying session exists today', async () => {
    const prisma = makePrisma(0)
    const result = await hasMetTodaysQuota(prisma as any, 'deck-1', 20, new Date())
    expect(result).toBe(false)
  })
})

describe('countQualifyingDays', () => {
  function makePrisma(endedAtValues: (Date | null)[]) {
    return {
      reviewSession: {
        findMany: vi.fn().mockResolvedValue(endedAtValues.map((endedAt) => ({ endedAt }))),
      },
    }
  }

  it('counts two qualifying sessions on the same day as one', async () => {
    const prisma = makePrisma([
      new Date(2026, 7, 17, 23, 45), // Monday 11:45pm
      new Date(2026, 7, 17, 8, 0), // Monday 8:00am
    ])
    const result = await countQualifyingDays(
      prisma as any,
      'deck-1',
      20,
      new Date(2026, 7, 17),
      new Date(2026, 7, 24),
    )
    expect(result).toBe(1)
  })

  it('does not let an 11:45pm + 12:01am pair across midnight count as the same day', async () => {
    const prisma = makePrisma([
      new Date(2026, 7, 17, 23, 45), // Monday 11:45pm
      new Date(2026, 7, 18, 0, 1), // Tuesday 12:01am
    ])
    const result = await countQualifyingDays(
      prisma as any,
      'deck-1',
      20,
      new Date(2026, 7, 17),
      new Date(2026, 7, 24),
    )
    expect(result).toBe(2)
  })

  it('counts sessions spread across distinct days as that many days', async () => {
    const prisma = makePrisma([
      new Date(2026, 7, 17, 9, 0),
      new Date(2026, 7, 19, 9, 0),
      new Date(2026, 7, 21, 9, 0),
    ])
    const result = await countQualifyingDays(
      prisma as any,
      'deck-1',
      20,
      new Date(2026, 7, 17),
      new Date(2026, 7, 24),
    )
    expect(result).toBe(3)
  })

  it('returns 0 when there are no qualifying sessions', async () => {
    const prisma = makePrisma([])
    const result = await countQualifyingDays(
      prisma as any,
      'deck-1',
      20,
      new Date(2026, 7, 17),
      new Date(2026, 7, 24),
    )
    expect(result).toBe(0)
  })
})

describe('getAutoStudyFocus', () => {
  function makePrisma(hwReq: unknown, sessionCount = 0) {
    return {
      homeworkRequirement: { findFirst: vi.fn().mockResolvedValue(hwReq) },
      reviewSession: { count: vi.fn().mockResolvedValue(sessionCount) },
    }
  }

  it('returns null when there is no active homework requirement', async () => {
    const prisma = makePrisma(null)
    const result = await getAutoStudyFocus(prisma as any, 'class-1', 'deck-1')
    expect(result).toBeNull()
  })

  it('returns mode "all" when homework has no CardSet selection', async () => {
    const prisma = makePrisma({
      minCardsPerSession: DEFAULT_MIN_CARDS_PER_SESSION,
      cardSets: [],
    })
    const result = await getAutoStudyFocus(prisma as any, 'class-1', 'deck-1')
    expect(result).toEqual({ mode: 'all' })
  })

  it('returns mode "assigned" with CardSet ids/names when a selection exists and today\'s quota is not yet met', async () => {
    const prisma = makePrisma(
      {
        minCardsPerSession: DEFAULT_MIN_CARDS_PER_SESSION,
        cardSets: [
          { cardSetId: 'set-1', cardSet: { id: 'set-1', name: 'Unit 4' } },
          { cardSetId: 'set-2', cardSet: { id: 'set-2', name: 'Unit 5' } },
        ],
      },
      0,
    )
    const result = await getAutoStudyFocus(prisma as any, 'class-1', 'deck-1')
    expect(result).toEqual({
      mode: 'assigned',
      cardSetIds: ['set-1', 'set-2'],
      cardSetNames: ['Unit 4', 'Unit 5'],
    })
  })

  it('reverts to mode "all" once today\'s quota is already met, even with a CardSet selection', async () => {
    const prisma = makePrisma(
      {
        minCardsPerSession: DEFAULT_MIN_CARDS_PER_SESSION,
        cardSets: [{ cardSetId: 'set-1', cardSet: { id: 'set-1', name: 'Unit 4' } }],
      },
      1, // a qualifying session already happened today
    )
    const result = await getAutoStudyFocus(prisma as any, 'class-1', 'deck-1')
    expect(result).toEqual({ mode: 'all' })
  })
})
