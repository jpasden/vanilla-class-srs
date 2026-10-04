import { PrismaClient } from '@prisma/client'

/** Class ownership always includes membership of the class's SubjectGrade. */
export async function createClassWithMembership(
  prisma: PrismaClient,
  data: { name: string; teacherId: string; subjectGradeId: string },
) {
  return prisma.$transaction(async (tx) => {
    await tx.teacherSubjectGrade.upsert({
      where: { teacherId_subjectGradeId: { teacherId: data.teacherId, subjectGradeId: data.subjectGradeId } },
      create: { teacherId: data.teacherId, subjectGradeId: data.subjectGradeId },
      update: {},
    })
    return tx.class.create({ data })
  })
}

export async function updateClassWithMembership(
  prisma: PrismaClient,
  classId: string,
  data: { name?: string; teacherId?: string; archivedAt?: Date | null },
) {
  return prisma.$transaction(async (tx) => {
    const cls = await tx.class.update({ where: { id: classId }, data })
    await tx.teacherSubjectGrade.upsert({
      where: { teacherId_subjectGradeId: { teacherId: cls.teacherId, subjectGradeId: cls.subjectGradeId } },
      create: { teacherId: cls.teacherId, subjectGradeId: cls.subjectGradeId },
      update: {},
    })
    return cls
  })
}

/** Membership cannot be removed while it is required by an active class. */
export async function removeSubjectGradeMembership(prisma: PrismaClient, teacherId: string, subjectGradeId: string) {
  return prisma.$transaction(async (tx) => {
    if (await tx.subjectGradeLead.findFirst({ where: { teacherId, subjectGradeId } })) return false
    const activeClasses = await tx.class.count({ where: { teacherId, subjectGradeId, archivedAt: null } })
    if (activeClasses > 0) return false
    await tx.teacherSubjectGrade.deleteMany({ where: { teacherId, subjectGradeId } })
    return true
  })
}
