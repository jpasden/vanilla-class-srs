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

  it('defaults the qualifying threshold to 1 when there is no active HomeworkRequirement', async () => {
    const prisma = makePrisma({ minCardsPerSession: null })
    await computeStreakAndBestDay(prisma as any, 'deck-1', 'enr-1', UTC, new Date('2026-09-08T15:00:00Z'))
    expect(prisma.reviewSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cardsReviewed: { gte: 1 } }) }),
    )
  })
})
