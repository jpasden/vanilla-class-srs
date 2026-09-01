import { PrismaClient } from '@prisma/client'
import { generateTempPassword, hashPassword } from './auth.service'

export interface ClassPasswordResetResult {
  studentName: string
  tempPassword: string
}

/**
 * Reset the password for every actively-enrolled student in a class. Used
 * by both the teacher and admin "Reset All Passwords" actions — shared here
 * so the two surfaces can never drift in behavior.
 *
 * Each student gets their own random password — a shared class-wide reset
 * password would recreate the exact weakness this generator replaces.
 */
export async function resetAllClassPasswords(
  prisma: PrismaClient,
  classId: string,
): Promise<ClassPasswordResetResult[]> {
  const enrollments = await prisma.enrollment.findMany({
    where: { classId, archivedAt: null },
    include: { student: { include: { user: { select: { id: true, name: true } } } } },
  })

  return Promise.all(
    enrollments.map(async (e) => {
      const tempPassword = generateTempPassword()
      const passwordHash = await hashPassword(tempPassword)
      await prisma.user.update({
        where: { id: e.student.user.id },
        data: { passwordHash, mustChangePassword: true },
      })
      return { studentName: e.student.user.name, tempPassword }
    }),
  )
}
