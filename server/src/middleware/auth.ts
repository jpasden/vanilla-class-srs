import { Request, Response, NextFunction } from 'express'
import { Role } from '@prisma/client'
import { verifyAccessToken, JwtPayload } from '../services/auth.service'
import prisma from '../lib/prisma'

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

/**
 * requireAuth — verifies the access_token cookie and attaches user to req.
 * Returns 401 if the token is missing or invalid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.access_token as string | undefined
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    req.user = verifyAccessToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}

/**
 * requireRole — factory that returns middleware enforcing one or more roles.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  }
}

// Convenience shorthands
export const requireAdmin   = requireRole(Role.ADMIN)
export const requireTeacher = requireRole(Role.TEACHER, Role.ADMIN) // admins can do teacher things
export const requireStudent = requireRole(Role.STUDENT)

/**
 * requirePasswordChanged — blocks every route in a router that mounts this
 * (after requireAuth) while the user's mustChangePassword flag is set.
 *
 * A temp-password login already sets full access/refresh cookies before
 * anything consults this flag, so without this guard a session that hasn't
 * rotated its password has complete API access — the only thing stopping it
 * today is a client-side React redirect. This does not prevent account
 * takeover (anyone who knows the current password can change it, which is
 * exactly what this permits); it caps the blast radius of a temp password
 * leaking to "can only change the password," reversible by the teacher in
 * seconds via Reset Password.
 *
 * The flag is not in the JWT (payload is only { sub, role }), so an
 * admin/teacher-triggered reset takes effect immediately rather than waiting
 * for the access token to expire. That costs one indexed lookup per request
 * to a protected router — deliberately not skipped as an optimization.
 *
 * This router mounts /change-password and /logout separately in auth.ts,
 * which never applies this guard, so nothing needs to be exempted here.
 */
export async function requirePasswordChanged(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { mustChangePassword: true },
  })
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (user.mustChangePassword) {
    res.status(403).json({ error: 'Password change required', mustChangePassword: true })
    return
  }
  next()
}
