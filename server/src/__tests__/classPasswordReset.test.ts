import { describe, it, expect, vi } from 'vitest'
import { resetAllClassPasswords } from '../services/classPasswordReset.service'

function makePrisma(enrollments: { student: { user: { id: string; name: string } } }[]) {
  return {
    enrollment: {
      findMany: vi.fn().mockResolvedValue(enrollments),
    },
    user: {
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

describe('resetAllClassPasswords', () => {
  it('resets every actively-enrolled student and returns their new temp password', async () => {
    const prisma = makePrisma([
      { student: { user: { id: 'u1', name: 'Alice' } } },
      { student: { user: { id: 'u2', name: 'Bob' } } },
    ])

    const results = await resetAllClassPasswords(prisma as any, 'class-1')

    expect(prisma.enrollment.findMany).toHaveBeenCalledWith({
      where: { classId: 'class-1', archivedAt: null },
      include: { student: { include: { user: { select: { id: true, name: true } } } } },
    })
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.studentName)).toEqual(['Alice', 'Bob'])
    expect(prisma.user.update).toHaveBeenCalledTimes(2)
  })

  it('gives each student a different password, not a shared class-wide one', async () => {
    const prisma = makePrisma([
      { student: { user: { id: 'u1', name: 'Alice' } } },
      { student: { user: { id: 'u2', name: 'Bob' } } },
    ])
    const results = await resetAllClassPasswords(prisma as any, 'class-1')
    expect(results[0].tempPassword).not.toBe(results[1].tempPassword)
  })

  it('sets mustChangePassword true for every reset student', async () => {
    const prisma = makePrisma([{ student: { user: { id: 'u1', name: 'Alice' } } }])
    await resetAllClassPasswords(prisma as any, 'class-1')
    const call = prisma.user.update.mock.calls[0][0]
    expect(call.data.mustChangePassword).toBe(true)
    expect(call.where).toEqual({ id: 'u1' })
  })

  it('returns an empty array for a class with no active enrollments', async () => {
    const prisma = makePrisma([])
    const results = await resetAllClassPasswords(prisma as any, 'class-1')
    expect(results).toEqual([])
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})
