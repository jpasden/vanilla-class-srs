import { describe, it, expect, vi } from 'vitest'
import { batchAddTeachers, batchAddClasses } from '../services/subjectGradeBatch.service'

function makeTeachersPrisma({
  teachers = [] as { id: string; user: { name: string } }[],
  alreadyAssignedIds = [] as string[],
} = {}) {
  return {
    teacher: {
      findMany: vi.fn().mockResolvedValue(teachers),
    },
    teacherSubjectGrade: {
      findMany: vi.fn().mockResolvedValue(alreadyAssignedIds.map((teacherId) => ({ teacherId }))),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
}

describe('batchAddTeachers', () => {
  it('adds every valid, not-yet-assigned teacher', async () => {
    const prisma = makeTeachersPrisma({
      teachers: [
        { id: 't1', user: { name: 'Amanda Huang' } },
        { id: 't2', user: { name: 'Dan Wu' } },
      ],
    })

    const results = await batchAddTeachers(prisma as any, 'sg-1', ['t1', 't2'])

    expect(results).toEqual([
      { teacherId: 't1', teacherName: 'Amanda Huang', status: 'added' },
      { teacherId: 't2', teacherName: 'Dan Wu', status: 'added' },
    ])
    expect(prisma.teacherSubjectGrade.createMany).toHaveBeenCalledWith({
      data: [
        { teacherId: 't1', subjectGradeId: 'sg-1' },
        { teacherId: 't2', subjectGradeId: 'sg-1' },
      ],
      skipDuplicates: true,
    })
  })

  it('reports already-assigned teachers without re-creating the row', async () => {
    const prisma = makeTeachersPrisma({
      teachers: [{ id: 't1', user: { name: 'Amanda Huang' } }],
      alreadyAssignedIds: ['t1'],
    })

    const results = await batchAddTeachers(prisma as any, 'sg-1', ['t1'])

    expect(results).toEqual([{ teacherId: 't1', teacherName: 'Amanda Huang', status: 'already_assigned' }])
    expect(prisma.teacherSubjectGrade.createMany).not.toHaveBeenCalled()
  })

  it('reports an unknown teacher id as not_found without throwing', async () => {
    const prisma = makeTeachersPrisma({ teachers: [] })

    const results = await batchAddTeachers(prisma as any, 'sg-1', ['ghost'])

    expect(results).toEqual([{ teacherId: 'ghost', teacherName: null, status: 'not_found' }])
    expect(prisma.teacherSubjectGrade.createMany).not.toHaveBeenCalled()
  })

  it('handles a mixed batch: added, already_assigned, and not_found together', async () => {
    const prisma = makeTeachersPrisma({
      teachers: [
        { id: 't1', user: { name: 'Amanda Huang' } },
        { id: 't2', user: { name: 'Dan Wu' } },
      ],
      alreadyAssignedIds: ['t2'],
    })

    const results = await batchAddTeachers(prisma as any, 'sg-1', ['t1', 't2', 'ghost'])

    expect(results).toEqual([
      { teacherId: 't1', teacherName: 'Amanda Huang', status: 'added' },
      { teacherId: 't2', teacherName: 'Dan Wu', status: 'already_assigned' },
      { teacherId: 'ghost', teacherName: null, status: 'not_found' },
    ])
    expect(prisma.teacherSubjectGrade.createMany).toHaveBeenCalledWith({
      data: [{ teacherId: 't1', subjectGradeId: 'sg-1' }],
      skipDuplicates: true,
    })
  })
})

function makeClassesPrisma({
  assignedTeacherIds = [] as string[],
  createImpl,
}: {
  assignedTeacherIds?: string[]
  createImpl?: (data: any) => Promise<{ id: string }>
} = {}) {
  return {
    teacherSubjectGrade: {
      findMany: vi.fn().mockResolvedValue(assignedTeacherIds.map((teacherId) => ({ teacherId }))),
    },
    class: {
      create: vi.fn().mockImplementation(
        createImpl ?? (({ data }: any) => Promise.resolve({ id: `class-${data.name}` })),
      ),
    },
  }
}

describe('batchAddClasses', () => {
  it('creates every row whose teacher is already assigned to the Subject Grade', async () => {
    const prisma = makeClassesPrisma({ assignedTeacherIds: ['t1', 't2'] })

    const results = await batchAddClasses(prisma as any, 'sg-1', [
      { name: '10AENG 1', teacherId: 't1' },
      { name: '10AENG 2', teacherId: 't2' },
    ])

    expect(results).toEqual([
      { name: '10AENG 1', status: 'created', classId: 'class-10AENG 1' },
      { name: '10AENG 2', status: 'created', classId: 'class-10AENG 2' },
    ])
    expect(prisma.class.create).toHaveBeenCalledTimes(2)
  })

  it('rejects a row whose teacher is not assigned to this Subject Grade, without aborting the rest of the batch', async () => {
    const prisma = makeClassesPrisma({ assignedTeacherIds: ['t1'] })

    const results = await batchAddClasses(prisma as any, 'sg-1', [
      { name: '10AENG 1', teacherId: 't1' },
      { name: '10AENG 2', teacherId: 'unassigned-teacher' },
    ])

    expect(results).toEqual([
      { name: '10AENG 1', status: 'created', classId: 'class-10AENG 1' },
      { name: '10AENG 2', status: 'error', error: 'Teacher is not assigned to this Subject Grade' },
    ])
    expect(prisma.class.create).toHaveBeenCalledTimes(1)
  })

  it('records a per-row error and continues if class creation throws', async () => {
    const prisma = makeClassesPrisma({
      assignedTeacherIds: ['t1'],
      createImpl: () => Promise.reject(new Error('DB exploded')),
    })

    const results = await batchAddClasses(prisma as any, 'sg-1', [{ name: '10AENG 1', teacherId: 't1' }])

    expect(results).toEqual([{ name: '10AENG 1', status: 'error', error: 'DB exploded' }])
  })
})
