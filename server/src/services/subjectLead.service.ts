import { PrismaClient } from '@prisma/client'

export class SubjectLeadError extends Error {}

export async function updateSubjectGradeLead(
  db: PrismaClient,
  subjectGradeId: string,
  data: { name?: string; departmentId?: string; leadTeacherId?: string | null },
) {
  return db.$transaction(async (tx) => {
    // Serialize appointment changes so the audit previous-lead value is accurate.
    await tx.$queryRaw`SELECT id FROM "SubjectGrade" WHERE id = ${subjectGradeId} FOR UPDATE`
    const { leadTeacherId, ...fields } = data
    const previous = await tx.subjectGradeLead.findUnique({ where: { subjectGradeId } })
    if (leadTeacherId !== undefined) {
      if (leadTeacherId === null) {
        await tx.subjectGradeLead.deleteMany({ where: { subjectGradeId } })
      } else {
        const membership = await tx.teacherSubjectGrade.findUnique({
          where: { teacherId_subjectGradeId: { teacherId: leadTeacherId, subjectGradeId } },
        })
        if (!membership)
          throw new SubjectLeadError('Choose a teacher already assigned to this Subject/Grade.')
        await tx.subjectGradeLead.upsert({
          where: { subjectGradeId },
          create: { subjectGradeId, teacherId: leadTeacherId },
          update: { teacherId: leadTeacherId },
        })
      }
    }
    const group = await tx.subjectGrade.update({ where: { id: subjectGradeId }, data: fields })
    return { group, previousTeacherId: previous?.teacherId ?? null }
  })
}
