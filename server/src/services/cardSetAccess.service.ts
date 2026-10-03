import { Prisma } from '@prisma/client'

/** Same scope for the class picker and the teacher's assignment permission. */
export function classCardSetWhere(cls: { teacherId: string; subjectGradeId: string }): Prisma.CardSetWhereInput {
  return {
    archivedAt: null,
    isPersonal: false,
    OR: [
      { status: 'PRIVATE', teacherId: cls.teacherId },
      { status: 'DEPARTMENTAL', subjectGradeId: cls.subjectGradeId },
    ],
  }
}
