import { PrismaClient } from '@prisma/client'
import { createClassWithMembership } from './class.service'

export interface BatchTeacherResult {
  teacherId: string
  teacherName: string | null
  status: 'added' | 'already_assigned' | 'not_found'
}

/**
 * Bulk-add teachers to a Subject Grade in one call. Mirrors the existing
 * POST /teachers/:id/subject-grades route (one teacher, many SubjectGrades)
 * in the other direction — one SubjectGrade, many teachers. Unknown teacher
 * ids and already-assigned teachers are reported per-row rather than
 * aborting the whole batch.
 */
export async function batchAddTeachers(
  prisma: PrismaClient,
  subjectGradeId: string,
  teacherIds: string[],
): Promise<BatchTeacherResult[]> {
  const teachers = await prisma.teacher.findMany({
    where: { id: { in: teacherIds } },
    include: { user: { select: { name: true } } },
  })
  const existing = await prisma.teacherSubjectGrade.findMany({
    where: { subjectGradeId, teacherId: { in: teacherIds } },
    select: { teacherId: true },
  })
  const alreadyAssigned = new Set(existing.map((e) => e.teacherId))

  const toCreate = teacherIds.filter((id) => teachers.some((t) => t.id === id) && !alreadyAssigned.has(id))
  if (toCreate.length > 0) {
    await prisma.teacherSubjectGrade.createMany({
      data: toCreate.map((teacherId) => ({ teacherId, subjectGradeId })),
      skipDuplicates: true,
    })
  }

  return teacherIds.map((id) => {
    const teacher = teachers.find((t) => t.id === id)
    if (!teacher) return { teacherId: id, teacherName: null, status: 'not_found' }
    if (alreadyAssigned.has(id)) return { teacherId: id, teacherName: teacher.user.name, status: 'already_assigned' }
    return { teacherId: id, teacherName: teacher.user.name, status: 'added' }
  })
}

export interface BatchClassRow {
  name: string
  teacherId: string
}

export interface BatchClassResult {
  name: string
  status: 'created' | 'error'
  error?: string
  classId?: string
}

/** Bulk-create classes and automatically add their teachers to the SubjectGrade. */
export async function batchAddClasses(
  prisma: PrismaClient,
  subjectGradeId: string,
  rows: BatchClassRow[],
): Promise<BatchClassResult[]> {
  const teacherIds = [...new Set(rows.map((r) => r.teacherId))]
  const validTeacherIds = new Set(
    (await prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true },
    })).map((t) => t.id),
  )

  const results: BatchClassResult[] = []
  for (const row of rows) {
    if (!validTeacherIds.has(row.teacherId)) {
      results.push({ name: row.name, status: 'error', error: 'Teacher not found' })
      continue
    }
    try {
      const cls = await createClassWithMembership(prisma, { name: row.name, teacherId: row.teacherId, subjectGradeId })
      results.push({ name: row.name, status: 'created', classId: cls.id })
    } catch (err: any) {
      results.push({ name: row.name, status: 'error', error: err?.message ?? 'Unknown error' })
    }
  }
  return results
}
