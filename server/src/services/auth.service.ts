import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { Response } from 'express'
import { Role } from '@prisma/client'

const BCRYPT_ROUNDS = 12
const ACCESS_TOKEN_TTL = '1h'
const REFRESH_TOKEN_TTL = '30d'
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60 // 1 hour

// ─── JWT ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string   // userId
  role: Role
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, requireEnv('JWT_SECRET'), { expiresIn: ACCESS_TOKEN_TTL })
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, requireEnv('JWT_REFRESH_SECRET'), { expiresIn: REFRESH_TOKEN_TTL })
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, requireEnv('JWT_SECRET')) as JwtPayload
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, requireEnv('JWT_REFRESH_SECRET')) as JwtPayload
}

// ─── Cookies ─────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production'

export function setAuthCookies(res: Response, userId: string, role: Role): void {
  const payload: JwtPayload = { sub: userId, role }
  const accessToken = signAccessToken(payload)
  const refreshToken = signRefreshToken(payload)

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60, // 1 hour
  })

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    path: '/api/auth/refresh',
  })
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token')
  res.clearCookie('refresh_token', { path: '/api/auth/refresh' })
}

// ─── Passwords ───────────────────────────────────────────────────────────────

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function generateTempPassword(teacherLastName: string, date?: Date): string {
  const d = date ?? new Date()
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '')
  const lastName = teacherLastName.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${dateStr}${lastName}`
}

// ─── Password reset tokens ───────────────────────────────────────────────────
//
// We use a two-layer approach:
//   - raw token: 32 cryptographically random bytes (64 hex chars) sent to the user
//   - tokenHash stored in DB: SHA-256 of the raw token (fast, for direct lookup)
//
// The raw token has 256 bits of entropy, making brute force infeasible.
// SHA-256 is sufficient here — we don't need bcrypt's slowness because the
// token is never derived from a low-entropy input like a password.

export function generateResetToken(): { raw: string; tokenHash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex')
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
  return { raw, tokenHash, expiresAt }
}

export function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}
