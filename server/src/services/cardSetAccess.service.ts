import { Prisma } from '@prisma/client'

/** Libraries remain private unless a set is assigned to an accessible active class. */
export function teacherReadableCardSetWhere(teacherId: string): Prisma.CardSetWhereInput {
  return {
    archivedAt: null,
    isPersonal: false,
    OR: [
      { status: 'PRIVATE', teacherId },
      { status: 'DEPARTMENTAL', subjectGrade: { teachers: { some: { teacherId } } } },
      { assignments: { some: { class: {
        archivedAt: null,
        subjectGrade: { archivedAt: null, department: { archivedAt: null } },
        OR: [{ teacherId }, { subjectGrade: { lead: { teacherId } } }],
      } } } },
    ],
  }
}

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
