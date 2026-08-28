import { describe, it, expect, vi } from 'vitest'
import { demoteAdmin, PROTECTED_ADMIN_USER_ID } from '../services/adminRoles.service'

function makePrisma({
  user = null as { id: string; role: string; teacherProfile: { id: string } | null } | null,
  adminCount = 2,
} = {}) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      count: vi.fn().mockResolvedValue(adminCount),
      update: vi.fn().mockImplementation(({ where, data }: any) =>
        Promise.resolve({ id: where.id, name: 'Some Admin', email: 'admin@example.com', role: data.role }),
      ),
    },
  }
}

describe('demoteAdmin', () => {
  it('refuses to demote the protected founding admin, without even querying the DB', async () => {
    const prisma = makePrisma()
    const result = await demoteAdmin(prisma as any, PROTECTED_ADMIN_USER_ID)
    expect(result).toEqual({ status: 'protected' })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns not_found when the target user does not exist', async () => {
    const prisma = makePrisma({ user: null })
    const result = await demoteAdmin(prisma as any, 'ghost-id')
    expect(result).toEqual({ status: 'not_found' })
  })

  it('returns not_found when the target user exists but is not an admin', async () => {
    const prisma = makePrisma({ user: { id: 't1', role: 'TEACHER', teacherProfile: null } })
    const result = await demoteAdmin(prisma as any, 't1')
    expect(result).toEqual({ status: 'not_found' })
  })

  it('refuses to demote the last remaining admin', async () => {
    const prisma = makePrisma({
      user: { id: 'a1', role: 'ADMIN', teacherProfile: null },
      adminCount: 1,
    })
    const result = await demoteAdmin(prisma as any, 'a1')
    expect(result).toEqual({ status: 'last_admin' })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('demotes to TEACHER when the admin still has a teacher profile', async () => {
    const prisma = makePrisma({
      user: { id: 'a1', role: 'ADMIN', teacherProfile: { id: 'teacher-1' } },
      adminCount: 2,
    })
    const result = await demoteAdmin(prisma as any, 'a1')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.user.role).toBe('TEACHER')
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { role: 'TEACHER' },
      select: { id: true, name: true, email: true, role: true },
    })
  })

  it('demotes to STUDENT when the admin has no teacher profile', async () => {
    const prisma = makePrisma({
      user: { id: 'a2', role: 'ADMIN', teacherProfile: null },
      adminCount: 2,
    })
    const result = await demoteAdmin(prisma as any, 'a2')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.user.role).toBe('STUDENT')
  })
})
