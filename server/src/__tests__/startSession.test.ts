import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startSession } from '../services/review.service'

const now = new Date('2026-10-04T08:00:00Z')
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => vi.useRealTimers())
function card(id: string, state = 'REVIEW', dueOffset = -1, setId = 'focus') {
  return {
    id, deckId: 'deck', cardId: `card-${id}`, state,
    due: new Date(now.getTime() + dueOffset * 60_000), createdAt: now,
    stability: 1, difficulty: 1, lapses: 0, reps: state === 'NEW' ? 0 : 1,
    card: { id: `card-${id}`, word: id, cardSetId: setId,
      cardSet: { isPersonal: false, assignments: [{ priority: 1 }] } },
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
      findFirst: vi.fn(async ({ where }) => cards.find((c) => c.deckId === where.deckId
        && c.state === where.state
        && (!where.card || where.card.cardSetId.in.includes(c.card.cardSetId))) ?? null),
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
    expect(result.cards).toHaveLength(10)
    expect(result.cards[7].instanceId).toBe('due-0')
    expect(result.cards.some((c) => c.instanceId === 'homework-sooner')).toBe(false)
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

  it('keeps an empty focus empty even when new cards exist elsewhere', async () => {
    const result = await queue(makePrisma([card('new', 'NEW', -1, 'other')]), ['focus'])
    expect(result).toMatchObject({ cards: [], emptyReason: 'exhausted', sessionId: '' })
  })

  it('returns an empty result for an empty deck, including the legacy review-ahead option', async () => {
    const prisma = makePrisma([])
    const result = await startSession(prisma as any, 'student', 'enrollment', now, { reviewAhead: true })
    expect(result).toMatchObject({ cards: [], emptyReason: 'exhausted', sessionId: '' })
    expect(prisma.reviewSession.create).not.toHaveBeenCalled()
  })
})


describe('strict study focus and personal priority', () => {
  it('re-studies only focused cards in review-date order after the daily cap', async () => {
    const result = await queue(makePrisma([
      card('later', 'REVIEW', 100, 'personal'),
      card('sooner', 'REVIEW', 10, 'personal'),
      card('outside-due', 'REVIEW', -100, 'other'),
      card('outside-new', 'NEW', -1, 'other'),
    ], 10, 10), ['personal'])
    expect(result.cards.map(c => c.instanceId)).toEqual(Array.from({ length: 10 }, (_, i) => i % 2 ? 'later' : 'sooner'))
  })

  it('offers a cap bypass within the focus instead of substituting learned cards', async () => {
    const prisma = makePrisma([card('personal-new', 'NEW', -1, 'personal'), card('outside', 'REVIEW')], 10, 10)
    expect(await queue(prisma, ['personal'])).toMatchObject({ cards: [], emptyReason: 'capped' })
    const result = await startSession(prisma as any, 'student', 'enrollment', now, {
      cardSetIds: ['personal'], bypassNewCardCap: true,
    })
    if ('error' in result) throw new Error(result.error)
    expect(result.cards).toHaveLength(10)
    expect(result.cards.every(c => c.instanceId === 'personal-new')).toBe(true)
  })

  it('does not report capped for an empty focus when new cards exist outside it', async () => {
    expect(await queue(makePrisma([card('outside', 'NEW', -1, 'other')], 10, 10), ['personal']))
      .toMatchObject({ cards: [], emptyReason: 'exhausted' })
  })

  it('supports multiple focused sets without admitting any other set', async () => {
    const result = await queue(makePrisma([
      card('a', 'REVIEW', -5, 'a'), card('b', 'REVIEW', 5, 'b'), card('outside', 'REVIEW', -10, 'other'),
    ]), ['a', 'b'])
    expect(new Set(result.cards.map(c => c.instanceId))).toEqual(new Set(['a', 'b']))
  })

  it('introduces personal new cards at priority 3 among assigned cards', async () => {
    const personal = card('personal', 'NEW', -1, 'personal')
    personal.card.cardSet.isPersonal = true
    personal.card.cardSet.assignments = []
    const assigned = Array.from({ length: 10 }, (_, i) => {
      const c = card(`assigned-${i}`, 'NEW')
      c.card.cardSet.assignments = [{ priority: i < 2 ? 2 : 4 }]
      return c
    })
    const result = await queue(makePrisma([...assigned, personal]))
    expect(result.cards).toHaveLength(10)
    expect(result.cards.slice(0, 4).map(c => c.instanceId)).toEqual(['assigned-0', 'assigned-1', 'personal', 'assigned-2'])
  })
})
