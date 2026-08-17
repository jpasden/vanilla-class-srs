import { describe, it, expect, vi } from 'vitest'
import { rollbackOrphanedAssignment, removeAssignment } from '../services/assignment.service'

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
