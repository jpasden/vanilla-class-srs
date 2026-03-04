import { Router, Request, Response } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import {
  hashPassword,
  comparePassword,
  setAuthCookies,
  clearAuthCookies,
  verifyRefreshToken,
  generateResetToken,
  hashResetToken,
} from '../services/auth.service'
import { sendPasswordResetEmail } from '../services/email.service'
import { requireAuth } from '../middleware/auth'

const router = Router()

// ─── POST /api/auth/login ────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

router.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
    return
  }

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })

  // Use constant-time compare even when user is not found to prevent timing attacks
  const dummyHash = '$2b$12$invalidhashpaddingtomatchbcryptlength000000000000000000'
  const hash = user?.passwordHash ?? dummyHash
  const valid = await comparePassword(password, hash)

  if (!user || !valid) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  setAuthCookies(res, user.id, user.role)

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  })
})

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

router.post('/logout', (_req: Request, res: Response) => {
  clearAuthCookies(res)
  res.json({ ok: true })
})

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────

router.post('/refresh', async (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token as string | undefined
  if (!token) {
    res.status(401).json({ error: 'No refresh token' })
    return
  }

  try {
    const payload = verifyRefreshToken(token)

    // Confirm user still exists and hasn't been deleted
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    setAuthCookies(res, user.id, user.role)
    res.json({ ok: true })
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' })
  }
})

// ─── POST /api/auth/change-password ─────────────────────────────────────────

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const parsed = ChangePasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
    return
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash)
  if (!valid) {
    res.status(400).json({ error: 'Current password is incorrect' })
    return
  }

  const newHash = await hashPassword(parsed.data.newPassword)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  })

  res.json({ ok: true })
})

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
})

router.post('/forgot-password', async (req: Request, res: Response) => {
  const parsed = ForgotPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    // Always return 200 to avoid leaking whether an email exists
    res.json({ ok: true })
    return
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })

  // Always respond 200 — don't leak whether the email is registered
  if (!user) {
    res.json({ ok: true })
    return
  }

  // Invalidate any existing unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  const { raw, tokenHash, expiresAt } = generateResetToken()

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  })

  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'
  const resetUrl = `${clientUrl}/reset-password?token=${raw}`
  await sendPasswordResetEmail(user.email, resetUrl)

  res.json({ ok: true })
})

// ─── POST /api/auth/reset-password ──────────────────────────────────────────

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
})

router.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = ResetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
    return
  }

  const { token: rawToken, newPassword } = parsed.data

  // Hash the raw token to look it up directly — O(1), no iteration needed
  const tokenHash = hashResetToken(rawToken)
  const matched = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  })

  if (!matched || matched.usedAt !== null || matched.expiresAt < new Date()) {
    res.status(400).json({ error: 'Invalid or expired reset token' })
    return
  }

  const newHash = await hashPassword(newPassword)

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: matched.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: matched.userId },
      data: { passwordHash: newHash, mustChangePassword: false },
    }),
  ])

  res.json({ ok: true })
})

export default router
