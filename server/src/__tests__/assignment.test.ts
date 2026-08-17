import { describe, it, expect, vi } from 'vitest'
import { rollbackOrphanedAssignment, removeAssignment, syncNewCardsToAssignedDecks } from '../services/assignment.service'

function makePrisma(deleteResult: 'ok' | 'throws') {
  return {
    assignment: {
      delete: vi.fn().mockImplementation(() =>
        deleteResult === 'throws'
          ? Promise.reject(new Error('Record not found'))
          : Promise.resolve({ id: 'assign-1' }),
      ),
    },
  }
}

describe('rollbackOrphanedAssignment', () => {
  it('deletes the assignment when it exists', async () => {
    const prisma = makePrisma('ok')
    await rollbackOrphanedAssignment(prisma as any, 'assign-1')
    expect(prisma.assignment.delete).toHaveBeenCalledWith({ where: { id: 'assign-1' } })
  })

  it('does not throw when the assignment is already gone', async () => {
    const prisma = makePrisma('throws')
    await expect(rollbackOrphanedAssignment(prisma as any, 'assign-missing')).resolves.toBeUndefined()
  })
})

function makeRemoveAssignmentPrisma(instanceIds: string[]) {
  return {
    assignment: {
      findUnique: vi.fn().mockResolvedValue({ id: 'assign-1', cardSetId: 'set-1', classId: 'class-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'assign-1' }),
    },
    cardInstance: {
      findMany: vi.fn().mockResolvedValue(instanceIds.map((id) => ({ id }))),
      deleteMany: vi.fn().mockResolvedValue({ count: instanceIds.length }),
    },
    reviewEvent: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  }
}

describe('removeAssignment', () => {
  it('deletes review events, card instances, and the assignment when keepCards is false', async () => {
    const prisma = makeRemoveAssignmentPrisma(['inst-1', 'inst-2'])
    const result = await removeAssignment(prisma as any, 'assign-1', false)

    expect(result.cardsRemoved).toBe(2)
    expect(prisma.cardInstance.findMany).toHaveBeenCalledWith({
      where: {
        card: { cardSetId: 'set-1' },
        deck: { enrollment: { classId: 'class-1' } },
        origin: 'TEACHER_ASSIGNED',
      },
      select: { id: true },
    })
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('only deletes the assignment row when keepCards is true, leaving decks untouched', async () => {
    const prisma = makeRemoveAssignmentPrisma(['inst-1', 'inst-2'])
    const result = await removeAssignment(prisma as any, 'assign-1', true)

    expect(result.cardsRemoved).toBe(0)
    expect(prisma.assignment.delete).toHaveBeenCalledWith({ where: { id: 'assign-1' } })
    expect(prisma.cardInstance.findMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('is a no-op if the assignment no longer exists', async () => {
    const prisma = makeRemoveAssignmentPrisma([])
    prisma.assignment.findUnique = vi.fn().mockResolvedValue(null)

    const result = await removeAssignment(prisma as any, 'assign-missing', false)

    expect(result.cardsRemoved).toBe(0)
    expect(prisma.assignment.delete).not.toHaveBeenCalled()
  })
})

function makeSyncPrisma({
  mandatoryClassIds = [] as string[],
  enrollments = [] as { deck: { id: string } | null }[],
} = {}) {
  return {
    assignment: {
      findMany: vi.fn().mockResolvedValue(mandatoryClassIds.map((classId) => ({ classId }))),
    },
    enrollment: {
      findMany: vi.fn().mockResolvedValue(enrollments),
    },
    cardInstance: {
      createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })),
    },
  }
}

describe('syncNewCardsToAssignedDecks', () => {
  it('is a no-op when no cardIds are given', async () => {
    const prisma = makeSyncPrisma()
    const result = await syncNewCardsToAssignedDecks(prisma as any, 'set-1', [])
    expect(result.instancesCreated).toBe(0)
    expect(prisma.assignment.findMany).not.toHaveBeenCalled()
  })

  it('is a no-op when the CardSet has no MANDATORY assignment yet', async () => {
    const prisma = makeSyncPrisma({ mandatoryClassIds: [] })
    const result = await syncNewCardsToAssignedDecks(prisma as any, 'set-1', ['card-1'])
    expect(result.instancesCreated).toBe(0)
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled()
  })

  it('creates a CardInstance for every new card in every enrolled deck across all assigned classes', async () => {
    const prisma = makeSyncPrisma({
      mandatoryClassIds: ['class-1', 'class-2'],
      enrollments: [{ deck: { id: 'deck-1' } }, { deck: { id: 'deck-2' } }, { deck: { id: 'deck-3' } }],
    })

    const result = await syncNewCardsToAssignedDecks(prisma as any, 'set-1', ['card-1', 'card-2'])

    expect(result.instancesCreated).toBe(6) // 3 decks x 2 new cards
    expect(prisma.enrollment.findMany).toHaveBeenCalledWith({
      where: { classId: { in: ['class-1', 'class-2'] }, archivedAt: null },
      include: { deck: { select: { id: true } } },
    })
    const call = prisma.cardInstance.createMany.mock.calls[0][0]
    expect(call.skipDuplicates).toBe(true)
    expect(call.data).toHaveLength(6)
    expect(call.data[0].origin).toBe('TEACHER_ASSIGNED')
  })

  it('skips enrollments with no deck yet', async () => {
    const prisma = makeSyncPrisma({
      mandatoryClassIds: ['class-1'],
      enrollments: [{ deck: { id: 'deck-1' } }, { deck: null }],
    })

    const result = await syncNewCardsToAssignedDecks(prisma as any, 'set-1', ['card-1'])

    expect(result.instancesCreated).toBe(1)
  })
})
