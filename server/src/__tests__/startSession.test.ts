import { describe, it, expect, vi } from 'vitest'
import { startSession } from '../services/review.service'

const now = new Date('2026-10-04T08:00:00Z')
function card(id: string, state = 'REVIEW', dueOffset = -1, setId = 'focus') {
  return {
    id, deckId: 'deck', cardId: `card-${id}`, state,
    due: new Date(now.getTime() + dueOffset * 60_000), createdAt: now,
    stability: 1, difficulty: 1, lapses: 0, reps: state === 'NEW' ? 0 : 1,
    card: { id: `card-${id}`, word: id, cardSetId: setId,
      cardSet: { assignments: [{ priority: 1 }] } },
  }
}
function makePrisma(cards: ReturnType<typeof card>[], minimum = 10, introducedToday = 0) {
  const prisma = {
    enrollment: { findUnique: vi.fn().mockResolvedValue({
      id: 'enrollment', studentId: 'student', classId: 'class', archivedAt: null,
      deck: { id: 'deck', fsrsParams: { newCardsPerDay: 10 } },
    }) },
    homeworkRequirement: { findFirst: vi.fn().mockResolvedValue({
      minCardsPerSession: minimum, cardSets: [{ cardSetId: 'focus' }],
    }) },
    reviewSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'session' }),
    },
    reviewEvent: {
      groupBy: vi.fn().mockResolvedValue(Array.from({ length: introducedToday }, (_, i) => ({ cardInstanceId: `introduced-${i}` }))),
      findFirst: vi.fn().mockResolvedValue({ reviewedAt: now }),
    },
    cardInstance: {
      findFirst: vi.fn().mockResolvedValue(cards.find((c) => c.state === 'NEW') ?? null),
      findMany: vi.fn(async ({ where, orderBy, take }) => {
        let matches = cards.filter((c) => c.deckId === where.deckId
          && (typeof where.state === 'string' ? c.state === where.state : where.state.in.includes(c.state))
          && (!where.due || c.due <= where.due.lte)
          && (!where.id || !where.id.notIn.includes(c.id))
          && (!where.card || where.card.cardSetId.in.includes(c.card.cardSetId)))
        if (orderBy) matches = matches.sort((a, b) => a.due.getTime() - b.due.getTime() || a.id.localeCompare(b.id))
        return take === undefined ? matches : matches.slice(0, take)
      }),
    },
  }
  return prisma
}
async function queue(prisma: ReturnType<typeof makePrisma>, cardSetIds?: string[]) {
  const result = await startSession(prisma as any, 'student', 'enrollment', now, { cardSetIds })
  if ('error' in result) throw new Error(result.error)
  return result
}

describe('startSession minimum queue', () => {
  it('fills six due cards with the four soonest upcoming cards', async () => {
    const due = Array.from({ length: 6 }, (_, i) => card(`due-${i}`))
    const future = [card('later', 'REVIEW', 100), ...Array.from({ length: 4 }, (_, i) => card(`soon-${i}`, 'REVIEW', i + 1))]
    const prisma = makePrisma([...due, ...future])
    const result = await queue(prisma)
    expect(result.cards.map((c) => c.instanceId)).toEqual([...due.map((c) => c.id), 'soon-0', 'soon-1', 'soon-2', 'soon-3'])
    expect(prisma.cardInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ due: 'asc' }, { id: 'asc' }] }))
  })

  it('fills from homework CardSets before other deck cards, even if others are due sooner', async () => {
    const due = Array.from({ length: 6 }, (_, i) => card(`due-${i}`))
    const result = await queue(makePrisma([...due, card('focus-later', 'REVIEW', 100),
      ...Array.from({ length: 4 }, (_, i) => card(`other-${i}`, 'REVIEW', i + 1, 'other'))]))
    expect(result.cards.slice(6).map((c) => c.instanceId)).toEqual(['focus-later', 'other-0', 'other-1', 'other-2'])
  })

  it('honors a manually selected focus for upcoming cards', async () => {
    const due = Array.from({ length: 6 }, (_, i) => card(`due-${i}`, 'REVIEW', -1, 'manual'))
    const result = await queue(makePrisma([...due, card('manual-later', 'REVIEW', 100, 'manual'), card('homework-sooner', 'REVIEW', 1)]), ['manual'])
    expect(result.cards[6].instanceId).toBe('manual-later')
    expect(result.cards[7].instanceId).toBe('homework-sooner')
  })

  it('recycles a tiny deck only after all distinct cards', async () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`due-${i}`))
    const result = await queue(makePrisma(cards))
    expect(result.cards.map((c) => c.instanceId)).toEqual([...cards.map((c) => c.id), 'due-0', 'due-1', 'due-2', 'due-3'])
  })

  it('starts a ten-review session when nothing is due but learned cards exist', async () => {
    const result = await queue(makePrisma([card('future', 'REVIEW', 100)]))
    expect(result.cards).toHaveLength(10)
    expect(result.cards.every((c) => c.instanceId === 'future')).toBe(true)
    expect(result.sessionId).toBe('session')
  })

  it('preserves longer natural queues and the due-card cap', async () => {
    const cards = Array.from({ length: 25 }, (_, i) => card(`due-${i}`))
    const result = await queue(makePrisma(cards))
    expect(result.cards).toHaveLength(20)
    expect(new Set(result.cards.map((c) => c.instanceId)).size).toBe(20)
  })

  it('respects the daily new-card allowance while filling with learned cards', async () => {
    const cards = [...Array.from({ length: 12 }, (_, i) => card(`new-${i}`, 'NEW')),
      ...Array.from({ length: 8 }, (_, i) => card(`future-${i}`, 'REVIEW', i + 1))]
    const result = await queue(makePrisma(cards, 10, 8))
    expect(result.cards).toHaveLength(10)
    expect(result.cards.filter((c) => c.state === 'NEW')).toHaveLength(2)
  })

  it('uses a higher stored homework minimum when necessary', async () => {
    const result = await queue(makePrisma([card('only')], 15))
    expect(result.cards).toHaveLength(15)
  })

  it('still offers extra new words when the daily allowance is exhausted and none are learned', async () => {
    const prisma = makePrisma([card('new', 'NEW')], 10, 10)
    const result = await queue(prisma)
    expect(result.cards).toEqual([])
    expect(result.emptyReason).toBe('capped')
    expect(prisma.reviewSession.create).not.toHaveBeenCalled()
  })

  it('falls back when the selected focus is empty but new cards exist elsewhere', async () => {
    const result = await queue(makePrisma([card('new', 'NEW', -1, 'other')]), ['focus'])
    expect(result.cards).toHaveLength(10)
    expect(result.cards.every((c) => c.instanceId === 'new')).toBe(true)
  })

  it('returns an empty result for an empty deck, including the legacy review-ahead option', async () => {
    const prisma = makePrisma([])
    const result = await startSession(prisma as any, 'student', 'enrollment', now, { reviewAhead: true })
    expect(result).toMatchObject({ cards: [], emptyReason: 'exhausted', sessionId: '' })
    expect(prisma.reviewSession.create).not.toHaveBeenCalled()
  })
})
