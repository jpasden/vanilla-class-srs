import { describe, it, expect, vi } from 'vitest'
import { createClassWithMembership, updateClassWithMembership, removeSubjectGradeMembership } from '../services/class.service'

function makePrisma() {
  const tx = {
    subjectGradeLead: { findFirst: vi.fn().mockResolvedValue(null) },
    teacherSubjectGrade: { upsert: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    class: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c1', teacherId: 'old', subjectGradeId: 'sg1', ...data })),
      count: vi.fn().mockResolvedValue(0),
    },
  }
  return { ...tx, $transaction: vi.fn().mockImplementation((run) => run(tx)) }
}

describe('class membership', () => {
  it('creates membership and class together, preserving any existing membership', async () => {
    const prisma = makePrisma()
    await createClassWithMembership(prisma as any, { name: 'English 10A', teacherId: 't1', subjectGradeId: 'sg1' })
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.teacherSubjectGrade.upsert).toHaveBeenCalledWith({
      where: { teacherId_subjectGradeId: { teacherId: 't1', subjectGradeId: 'sg1' } },
      create: { teacherId: 't1', subjectGradeId: 'sg1' }, update: {},
    })
    expect(prisma.class.create).toHaveBeenCalledOnce()
  })

  it('does not create a class if membership creation fails', async () => {
    const prisma = makePrisma()
    prisma.teacherSubjectGrade.upsert.mockRejectedValue(new Error('membership failed'))
    await expect(createClassWithMembership(prisma as any, { name: '10A', teacherId: 't1', subjectGradeId: 'sg1' })).rejects.toThrow('membership failed')
    expect(prisma.class.create).not.toHaveBeenCalled()
  })

  it('adds the new teacher to the class subject/grade on reassignment without removing the old teacher', async () => {
    const prisma = makePrisma()
    await updateClassWithMembership(prisma as any, 'c1', { teacherId: 'new' })
    expect(prisma.teacherSubjectGrade.upsert).toHaveBeenCalledWith({
      where: { teacherId_subjectGradeId: { teacherId: 'new', subjectGradeId: 'sg1' } },
      create: { teacherId: 'new', subjectGradeId: 'sg1' }, update: {},
    })
    expect(prisma.teacherSubjectGrade.deleteMany).not.toHaveBeenCalled()
  })

  it('restores membership when an archived class is restored', async () => {
    const prisma = makePrisma()
    await updateClassWithMembership(prisma as any, 'c1', { archivedAt: null })
    expect(prisma.class.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { archivedAt: null } })
    expect(prisma.teacherSubjectGrade.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { teacherId: 'old', subjectGradeId: 'sg1' },
    }))
  })

  it('blocks membership removal while a teacher has an active class there', async () => {
    const prisma = makePrisma()
    prisma.class.count.mockResolvedValue(1)
    expect(await removeSubjectGradeMembership(prisma as any, 't1', 'sg1')).toBe(false)
    expect(prisma.class.count).toHaveBeenCalledWith({ where: { teacherId: 't1', subjectGradeId: 'sg1', archivedAt: null } })
    expect(prisma.teacherSubjectGrade.deleteMany).not.toHaveBeenCalled()
  })

  it('allows membership removal once no active classes require it', async () => {
    const prisma = makePrisma()
    expect(await removeSubjectGradeMembership(prisma as any, 't1', 'sg1')).toBe(true)
    expect(prisma.teacherSubjectGrade.deleteMany).toHaveBeenCalledWith({ where: { teacherId: 't1', subjectGradeId: 'sg1' } })
  })
})
