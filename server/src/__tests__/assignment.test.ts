import { describe, it, expect, vi } from 'vitest'
import { rollbackOrphanedAssignment } from '../services/assignment.service'

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
