import { describe, it, expect, vi } from 'vitest'
import { computeStreakAndBestDay } from '../services/streak.service'

function makePrisma({
  minCardsPerSession = null as number | null,
  sessions = [] as { endedAt: Date; cardsReviewed: number }[],
} = {}) {
  return {
    homeworkRequirement: {
      findFirst: vi.fn().mockResolvedValue(minCardsPerSession !== null ? { minCardsPerSession } : null),
    },
    reviewSession: {
      findMany: vi.fn().mockResolvedValue(sessions),
    },
  }
}

const UTC = 'UTC'

describe('computeStreakAndBestDay', () => {
  it('groups sessions by local calendar day and sums cardsReviewed per day', async () => {
    const prisma = makePrisma({
      sessions: [
        { endedAt: new Date('2026-09-08T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-09-08T14:00:00Z'), cardsReviewed: 3 },
        { endedAt: new Date('2026-09-07T10:00:00Z'), cardsReviewed: 10 },
      ],
    })
    const result = await computeStreakAndBestDay(prisma as any, 'deck-1', 'enr-1', UTC, new Date('2026-09-08T15:00:00Z'))
    expect(result.cardsPerDay).toEqual({ '2026-09-08': 8, '2026-09-07': 10 })
    expect(result.mostCardsInDay).toBe(10)
  })

  it('computes current streak as consecutive days ending today', async () => {
    const prisma = makePrisma({
      sessions: [
        { endedAt: new Date('2026-09-08T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-09-07T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-09-06T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-09-03T10:00:00Z'), cardsReviewed: 5 }, // gap
      ],
    })
    const result = await computeStreakAndBestDay(prisma as any, 'deck-1', 'enr-1', UTC, new Date('2026-09-08T15:00:00Z'))
    expect(result.currentStreak).toBe(3)
  })

  it('still counts a streak ending yesterday if today has no session yet', async () => {
    const prisma = makePrisma({
      sessions: [
        { endedAt: new Date('2026-09-07T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-09-06T10:00:00Z'), cardsReviewed: 5 },
      ],
    })
    const result = await computeStreakAndBestDay(prisma as any, 'deck-1', 'enr-1', UTC, new Date('2026-09-08T15:00:00Z'))
    expect(result.currentStreak).toBe(2)
  })

  it('computes longest streak across all-time history, not just the current run', async () => {
    const prisma = makePrisma({
      sessions: [
        { endedAt: new Date('2026-09-08T10:00:00Z'), cardsReviewed: 5 }, // current run: 1 day
        { endedAt: new Date('2026-08-01T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-08-02T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-08-03T10:00:00Z'), cardsReviewed: 5 },
        { endedAt: new Date('2026-08-04T10:00:00Z'), cardsReviewed: 5 }, // 4-day run in August
      ],
    })
    const result = await computeStreakAndBestDay(prisma as any, 'deck-1', 'enr-1', UTC, new Date('2026-09-08T15:00:00Z'))
    expect(result.longest).toBe(4)
    expect(result.currentStreak).toBe(1)
  })

  it('uses the class HomeworkRequirement minCardsPerSession as the qualifying threshold', async () => {
    const prisma = makePrisma({ minCardsPerSession: 10 })
    await computeStreakAndBestDay(prisma as any, 'deck-1', 'enr-1', UTC, new Date('2026-09-08T15:00:00Z'))
    expect(prisma.reviewSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cardsReviewed: { gte: 10 } }) }),
    )
  })

  it('uses the supplied date even when the system clock is on another day', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const prisma = makePrisma({
        sessions: [{ endedAt: new Date('2026-09-08T10:00:00Z'), cardsReviewed: 5 }],
      })
      const result = await computeStreakAndBestDay(
        prisma as any, 'deck-1', 'enr-1', 'Asia/Shanghai', new Date('2026-09-08T15:00:00Z'),
      )
      expect(result.currentStreak).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['2026-09-08T15:59:59Z', 2], // 23:59 Shanghai, studied today
    ['2026-09-08T16:00:00Z', 2], // 00:00 Shanghai, yesterday's streak survives
    ['2026-09-09T15:59:59Z', 2], // 23:59 Shanghai, still no session today
    ['2026-09-09T16:00:00Z', 0], // 00:00 Shanghai, a whole day was missed
  ])('counts Shanghai calendar days at %s', async (now, expected) => {
    const prisma = makePrisma({
      sessions: [
        { endedAt: new Date('2026-09-07T16:30:00Z'), cardsReviewed: 5 }, // Sep 8, 00:30
        { endedAt: new Date('2026-09-07T15:30:00Z'), cardsReviewed: 5 }, // Sep 7, 23:30
      ],
    })
    const result = await computeStreakAndBestDay(
      prisma as any, 'deck-1', 'enr-1', 'Asia/Shanghai', new Date(now),
    )
    expect(result.currentStreak).toBe(expected)
    expect(result.longest).toBe(2)
    expect(result.cardsPerDay).toEqual({ '2026-09-07': 5, '2026-09-08': 5 })
  })

  it('includes a session just after Shanghai midnight across a year boundary', async () => {
    const prisma = makePrisma({
      sessions: [
        { endedAt: new Date('2026-12-31T16:01:00Z'), cardsReviewed: 5 }, // Jan 1
        { endedAt: new Date('2026-12-31T15:59:00Z'), cardsReviewed: 5 }, // Dec 31
        { endedAt: new Date('2026-12-30T10:00:00Z'), cardsReviewed: 5 }, // Dec 30
      ],
    })
    const result = await computeStreakAndBestDay(
      prisma as any, 'deck-1', 'enr-1', 'Asia/Shanghai', new Date('2026-12-31T16:02:00Z'),
    )
    expect(result.currentStreak).toBe(3)
    expect(result.longest).toBe(3)
    expect(result.cardsPerDay['2027-01-01']).toBe(5)
  })

  it('defaults the qualifying threshold to 1 when there is no active HomeworkRequirement', async () => {
    const prisma = makePrisma({ minCardsPerSession: null })
    await computeStreakAndBestDay(prisma as any, 'deck-1', 'enr-1', UTC, new Date('2026-09-08T15:00:00Z'))
    expect(prisma.reviewSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cardsReviewed: { gte: 1 } }) }),
    )
  })
})
