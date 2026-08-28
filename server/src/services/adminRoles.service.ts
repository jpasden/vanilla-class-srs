import { PrismaClient, Role } from '@prisma/client'

// The founding admin account — never demotable, by anyone, even another
// admin, even themself. A hardcoded ID rather than a DB flag is deliberate:
// it can't be unset by any code path in this app, only by a direct DB edit.
export const PROTECTED_ADMIN_USER_ID = '7dfe0eae-27a2-40bd-854f-344a65e4489d'

export type DemoteAdminResult =
  | { status: 'ok'; user: { id: string; name: string; email: string; role: Role } }
  | { status: 'protected' }
  | { status: 'not_found' }
  | { status: 'last_admin' }

/**
 * Demote an ADMIN back to TEACHER (if they still have a Teacher profile) or
 * STUDENT (if not) — mirrors the fallback used by the teacher-offboard route.
 * Refuses to demote the protected founding admin, and refuses to demote the
 * last remaining admin, so the system can never end up with zero admins.
 */
export async function demoteAdmin(prisma: PrismaClient, targetUserId: string): Promise<DemoteAdminResult> {
  if (targetUserId === PROTECTED_ADMIN_USER_ID) {
    return { status: 'protected' }
  }

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { teacherProfile: true },
  })
  if (!user || user.role !== Role.ADMIN) {
    return { status: 'not_found' }
  }

  const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } })
  if (adminCount <= 1) {
    return { status: 'last_admin' }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: user.teacherProfile ? Role.TEACHER : Role.STUDENT },
    select: { id: true, name: true, email: true, role: true },
  })
  return { status: 'ok', user: updated }
}
