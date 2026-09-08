import { describe, it, expect, vi } from 'vitest'
import { closeSession } from '../services/review.service'

function makePrisma(events: { grade: number; reviewedAt: Date }[]) {
  return {
    reviewEvent: {
      findMany: vi.fn().mockResolvedValue(events),
    },
    reviewSession: {
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

describe('closeSession', () => {
  it('stamps endedAt from the last actual review, not the caller-supplied "now"', async () => {
    // The exact bug scenario: a student reviews Monday night, closes the tab
    // without hitting Finish, then opens the app again Thursday morning —
    // startSession silently closes the abandoned Monday session, calling
    // closeSession with Thursday's `now`. Without the fix, that Monday
    // study session would be misattributed to Thursday.
    const monday = new Date('2026-09-07T21:00:00Z')
    const mondayLater = new Date('2026-09-07T21:05:00Z')
    const thursdayNow = new Date('2026-09-10T07:00:00Z')

    const prisma = makePrisma([
      { grade: 3, reviewedAt: monday },
      { grade: 2, reviewedAt: mondayLater },
    ])

    await closeSession(prisma as any, 'session-1', thursdayNow)

    const call = prisma.reviewSession.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'session-1' })
    expect(call.data.endedAt).toEqual(mondayLater)
    expect(call.data.endedAt).not.toEqual(thursdayNow)
  })

  it('orders events explicitly rather than relying on query result order', async () => {
    const prisma = makePrisma([])
    await closeSession(prisma as any, 'session-1', new Date())
    expect(prisma.reviewEvent.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
      orderBy: { reviewedAt: 'asc' },
    })
  })

  it('falls back to "now" when the session has no events at all', async () => {
    const now = new Date('2026-09-10T07:00:00Z')
    const prisma = makePrisma([])

    await closeSession(prisma as any, 'session-1', now)

    const call = prisma.reviewSession.update.mock.calls[0][0]
    expect(call.data.endedAt).toEqual(now)
    expect(call.data.cardsReviewed).toBe(0)
    expect(call.data.accuracyRate).toBeNull()
  })

  it('computes cardsReviewed and accuracyRate from the events, unaffected by the endedAt fix', async () => {
    const prisma = makePrisma([
      { grade: 1, reviewedAt: new Date('2026-09-07T21:00:00Z') },
      { grade: 3, reviewedAt: new Date('2026-09-07T21:01:00Z') },
      { grade: 4, reviewedAt: new Date('2026-09-07T21:02:00Z') },
    ])

    await closeSession(prisma as any, 'session-1', new Date())

    const call = prisma.reviewSession.update.mock.calls[0][0]
    expect(call.data.cardsReviewed).toBe(3)
    expect(call.data.accuracyRate).toBeCloseTo(2 / 3)
  })
})
