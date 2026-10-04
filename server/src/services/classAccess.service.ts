import { PrismaClient, Role } from '@prisma/client'

/** Read access is scoped to a class; leadership never grants management. */
export async function classAccess(db: PrismaClient, userId: string, role: Role, classId: string) {
  const cls = await db.class.findUnique({
    where: { id: classId },
    include: {
      teacher: { include: { user: { select: { name: true } } } },
      subjectGrade: { include: { department: true, lead: true } },
    },
  })
  if (!cls || cls.archivedAt || cls.subjectGrade.archivedAt || cls.subjectGrade.department.archivedAt)
    return null
  const teacher = await db.teacher.findUnique({ where: { userId } })
  const canManage = role === Role.ADMIN || (role === Role.TEACHER && teacher?.id === cls.teacherId)
  const canView =
    canManage || (role === Role.TEACHER && !!teacher && cls.subjectGrade.lead?.teacherId === teacher.id)
  return canView ? { cls, canManage } : null
}

export async function ledSubjectGrades(db: PrismaClient, userId: string) {
  return db.subjectGrade.findMany({
    where: {
      archivedAt: null,
      department: { archivedAt: null },
      lead: { membership: { teacher: { userId } } },
    },
    select: { id: true, name: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })
}
