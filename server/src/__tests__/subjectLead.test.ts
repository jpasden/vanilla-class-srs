import { describe, it, expect, vi } from 'vitest'
import { classAccess } from '../services/classAccess.service'
import { SubjectLeadError, updateSubjectGradeLead } from '../services/subjectLead.service'

function accessDb(teacherId: string, leadTeacherId: string | null = 'lead') {
  return {
    teacher: { findUnique: vi.fn().mockResolvedValue({ id: teacherId }) },
    class: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: 'class',
          teacherId: 'owner',
          archivedAt: null,
          teacher: { user: { name: 'Owner' } },
          subjectGrade: {
            archivedAt: null,
            lead: leadTeacherId ? { teacherId: leadTeacherId } : null,
            department: { archivedAt: null },
          },
        }),
    },
  }
}
describe('scoped SL read permissions', () => {
  it('lets the SL view a colleague class without management rights', async () =>
    expect(await classAccess(accessDb('lead') as any, 'user', 'TEACHER', 'class')).toMatchObject({
      canManage: false,
    }))
  it('preserves owner and Admin management', async () => {
    expect(await classAccess(accessDb('owner') as any, 'user', 'TEACHER', 'class')).toMatchObject({
      canManage: true,
    })
    expect(await classAccess(accessDb('other') as any, 'user', 'ADMIN', 'class')).toMatchObject({
      canManage: true,
    })
  })
  it('denies unrelated teachers and students', async () => {
    expect(await classAccess(accessDb('other') as any, 'user', 'TEACHER', 'class')).toBeNull()
    expect(await classAccess(accessDb('lead') as any, 'user', 'STUDENT', 'class')).toBeNull()
  })
  it('uses current leadership rather than token-time permissions', async () =>
    expect(await classAccess(accessDb('lead', null) as any, 'user', 'TEACHER', 'class')).toBeNull())
  it('blocks access under an archived department', async () => {
    const db = accessDb('lead')
    const cls = await db.class.findUnique()
    cls.subjectGrade.department.archivedAt = new Date() as any
    expect(await classAccess(db as any, 'user', 'TEACHER', 'class')).toBeNull()
  })
})
function appointmentDb(member = true) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    teacherSubjectGrade: { findUnique: vi.fn().mockResolvedValue(member ? {} : null) },
    subjectGradeLead: {
      findUnique: vi.fn().mockResolvedValue({ teacherId: 'old' }),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    subjectGrade: { update: vi.fn().mockResolvedValue({ id: 'sg' }) },
  }
  return { ...tx, $transaction: vi.fn().mockImplementation((fn) => fn(tx)) }
}
describe('SL appointment', () => {
  it('rejects a nonmember without changing group or appointment', async () => {
    const db = appointmentDb(false)
    await expect(
      updateSubjectGradeLead(db as any, 'sg', { leadTeacherId: 'new', name: 'changed' }),
    ).rejects.toBeInstanceOf(SubjectLeadError)
    expect(db.subjectGrade.update).not.toHaveBeenCalled()
    expect(db.subjectGradeLead.upsert).not.toHaveBeenCalled()
  })
  it('replaces an appointment transactionally and retains the previous lead for audit', async () => {
    const db = appointmentDb()
    const result = await updateSubjectGradeLead(db as any, 'sg', { leadTeacherId: 'new' })
    expect(result.previousTeacherId).toBe('old')
    expect(db.subjectGradeLead.upsert).toHaveBeenCalledWith({
      where: { subjectGradeId: 'sg' },
      create: { subjectGradeId: 'sg', teacherId: 'new' },
      update: { teacherId: 'new' },
    })
  })
  it('allows clearing without removing membership', async () => {
    const db = appointmentDb()
    await updateSubjectGradeLead(db as any, 'sg', { leadTeacherId: null })
    expect(db.subjectGradeLead.deleteMany).toHaveBeenCalledWith({ where: { subjectGradeId: 'sg' } })
    expect(db.teacherSubjectGrade.findUnique).not.toHaveBeenCalled()
  })
})
