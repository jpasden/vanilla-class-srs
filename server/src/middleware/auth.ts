import { Request, Response, NextFunction } from 'express'
import { Role } from '@prisma/client'
import { verifyAccessToken, JwtPayload } from '../services/auth.service'

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
