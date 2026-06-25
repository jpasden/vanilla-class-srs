/**
 * Resolves the effective department-scoped label overrides for L2/L1 definitions.
 * Falls back to the plain defaults when no override is set, or when no department
 * can be determined for the given context (should be rare — see resolver notes).
 */
import { PrismaClient } from '@prisma/client'

export const DEFAULT_DEFINITION_L2_LABEL = 'L2 Definition'
export const DEFAULT_DEFINITION_L1_LABEL = 'L1 Definition'

export interface DefinitionLabels {
  definitionL2Label: string
  definitionL1Label: string
}

function effectiveLabels(dept: { definitionL2Label: string | null; definitionL1Label: string | null } | null): DefinitionLabels {
  return {
    definitionL2Label: dept?.definitionL2Label?.trim() || DEFAULT_DEFINITION_L2_LABEL,
    definitionL1Label: dept?.definitionL1Label?.trim() || DEFAULT_DEFINITION_L1_LABEL,
  }
}

/**
 * Resolves a teacher's "primary" department — used only for PRIVATE CardSets, which
 * have no subjectGradeId of their own. A teacher can belong to multiple SubjectGrades
 * (and thus multiple departments); pick deterministically by departmentId ascending
 * since TeacherSubjectGrade has no ordering/primary flag.
 */
async function resolveTeacherPrimaryDepartmentId(prisma: PrismaClient, teacherId: string): Promise<string | null> {
  const membership = await prisma.teacherSubjectGrade.findFirst({
    where: { teacherId },
    include: { subjectGrade: { select: { departmentId: true } } },
    orderBy: { subjectGrade: { departmentId: 'asc' } },
  })
  return membership?.subjectGrade.departmentId ?? null
}

/**
 * Resolves effective labels for a CardSet (admin/teacher cardset detail views).
 * DEPARTMENTAL sets resolve via their subjectGrade. PRIVATE sets have no
 * subjectGradeId, so fall back to the owning teacher's primary department.
 */
export async function labelsForCardSet(
  prisma: PrismaClient,
  cardSet: { subjectGradeId: string | null; teacherId: string | null },
): Promise<DefinitionLabels> {
  let departmentId: string | null = null

  if (cardSet.subjectGradeId) {
    const sg = await prisma.subjectGrade.findUnique({
      where: { id: cardSet.subjectGradeId },
      select: { departmentId: true },
    })
    departmentId = sg?.departmentId ?? null
  } else if (cardSet.teacherId) {
    departmentId = await resolveTeacherPrimaryDepartmentId(prisma, cardSet.teacherId)
  }

  if (!departmentId) return effectiveLabels(null)
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { definitionL2Label: true, definitionL1Label: true },
  })
  return effectiveLabels(dept)
}

/**
 * Resolves effective labels for a classroom context (student-facing pages: deck,
 * review, optional sets). Always goes via the student's own enrollment -> class ->
 * subjectGrade -> department, regardless of whether the specific card is
 * TEACHER_ASSIGNED, OPTIONAL, or STUDENT_ADDED (self-added cards have no department
 * of their own, but the student is still studying within this classroom context).
 */
export async function labelsForClass(prisma: PrismaClient, classId: string): Promise<DefinitionLabels> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { subjectGrade: { select: { departmentId: true } } },
  })
  if (!cls) return effectiveLabels(null)
  const dept = await prisma.department.findUnique({
    where: { id: cls.subjectGrade.departmentId },
    select: { definitionL2Label: true, definitionL1Label: true },
  })
  return effectiveLabels(dept)
}
