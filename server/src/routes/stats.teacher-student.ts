/**
 * Teacher read-only view of a single student's stats.
 * Mirrors stats.student.ts but auth is teacher-owns-class, not student-owns-deck.
 *
 * Mounted at /api/teachers/classes/:classId/students/:studentId/stats
 * (classId and studentId come from the parent router params)
 */

import { Request, Response } from 'express'
import { Role } from '@prisma/client'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { getPeriodBounds, getAutoStudyFocus, countQualifyingDays } from '../services/homework.service'

const router = asyncRouter({ mergeParams: true })
const p = (req: Request, key: string) => req.params[key] as string

// ── Helper: verify access and student is enrolled ─────────────────────────────
// Admins can view any class; teachers only classes they own.

async function getEnrollmentForTeacher(
  userId: string,
  userRole: Role,
  classId: string,
  studentId: string,
) {
  const cls = await prisma.class.findUnique({ where: { id: classId } })
  if (!cls || cls.archivedAt) return null

  if (userRole !== Role.ADMIN) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } })
    if (!teacher || cls.teacherId !== teacher.id) return null
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { classId, student: { id: studentId } },
    include: { deck: true, student: { include: { user: { select: { name: true } } } } },
  })
  return enrollment ?? null
}

function daysAgo(n: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

// ── GET /stats/summary ────────────────────────────────────────────────────────

router.get('/summary', async (req: Request, res: Response) => {
  const enrollment = await getEnrollmentForTeacher(req.user!.sub, req.user!.role, p(req, 'classId'), p(req, 'studentId'))
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }
  if (!enrollment.deck) { res.status(404).json({ error: 'Deck not found' }); return }

  const deckId = enrollment.deck.id
  const now = new Date()

  const instances = await prisma.cardInstance.findMany({
    where: { deckId },
    select: { state: true, due: true },
  })
  const breakdown = { NEW: 0, LEARNING: 0, REVIEW: 0, RELEARNING: 0, dueToday: 0 }
  for (const inst of instances) {
    breakdown[inst.state] = (breakdown[inst.state] ?? 0) + 1
    if (inst.state !== 'NEW' && inst.due <= now) breakdown.dueToday++
  }

  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { class: { enrollments: { some: { id: enrollment.id } } }, isActive: true },
  })
  const minCards = hwReq?.minCardsPerSession ?? 1

  const allSessions = await prisma.reviewSession.findMany({
    where: { deckId, endedAt: { not: null }, cardsReviewed: { gte: minCards } },
    orderBy: { endedAt: 'desc' },
    select: { endedAt: true, cardsReviewed: true },
  })

  const tz = (req.query.tz as string | undefined) || 'UTC'
  const toLocalDay = (date: Date) => {
    try { return date.toLocaleDateString('en-CA', { timeZone: tz }) } catch { return date.toISOString().slice(0, 10) }
  }

  const daySet = new Set<string>()
  const cardsPerDay: Record<string, number> = {}
  for (const s of allSessions) {
    if (!s.endedAt) continue
    const d = toLocalDay(s.endedAt)
    daySet.add(d)
    cardsPerDay[d] = (cardsPerDay[d] ?? 0) + s.cardsReviewed
  }

  let currentStreak = 0
  const checkDate = new Date()
  checkDate.setUTCHours(12, 0, 0, 0)
  const todayStr = toLocalDay(now)
  if (!daySet.has(todayStr)) checkDate.setUTCDate(checkDate.getUTCDate() - 1)
  while (true) {
    const key = toLocalDay(checkDate)
    if (!daySet.has(key)) break
    currentStreak++
    checkDate.setUTCDate(checkDate.getUTCDate() - 1)
  }

  const sortedDays = [...daySet].sort()
  let longest = 0
  let run = 0
  let prevDay: string | null = null
  for (const day of sortedDays) {
    if (prevDay) {
      const prev = new Date(prevDay + 'T12:00:00Z')
      const curr = new Date(day + 'T12:00:00Z')
      const diff = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
      run = diff === 1 ? run + 1 : 1
    } else {
      run = 1
    }
    if (run > longest) longest = run
    prevDay = day
  }

  const mostCardsInDay = Object.values(cardsPerDay).reduce((max, v) => Math.max(max, v), 0)

  let weeklyGoal = null
  if (hwReq) {
    const { periodStart: currentPeriodStart, periodEnd: currentPeriodEnd } = getPeriodBounds(hwReq, now)
    const sessionsCompleted = await countQualifyingDays(
      prisma,
      deckId,
      hwReq.minCardsPerSession,
      currentPeriodStart,
      currentPeriodEnd,
    )
    const daysRemaining = Math.max(0, Math.ceil((currentPeriodEnd.getTime() - now.getTime()) / 86_400_000))
    const cardSetFocus = await getAutoStudyFocus(prisma, enrollment.classId, deckId, now)
    weeklyGoal = {
      sessionsRequired: hwReq.sessionsRequired,
      minCardsPerSession: hwReq.minCardsPerSession,
      periodDays: hwReq.periodDays,
      sessionsCompleted,
      daysRemaining,
      cardSetFocus,
    }
  }

  res.json({ deckBreakdown: breakdown, streak: { current: currentStreak, longest, mostCardsInDay }, weeklyGoal })
})

// ── GET /stats/daily ──────────────────────────────────────────────────────────

router.get('/daily', async (req: Request, res: Response) => {
  const enrollment = await getEnrollmentForTeacher(req.user!.sub, req.user!.role, p(req, 'classId'), p(req, 'studentId'))
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment not found' }); return }

  const days = Math.min(365, Math.max(1, parseInt(req.query.days as string ?? '30') || 30))
  const since = daysAgo(days - 1)
  const tz = (req.query.tz as string | undefined) || 'UTC'
  const toLocalDay = (date: Date) => {
    try { return date.toLocaleDateString('en-CA', { timeZone: tz }) } catch { return date.toISOString().slice(0, 10) }
  }

  const events = await prisma.reviewEvent.findMany({
    where: { reviewedAt: { gte: since }, session: { deckId: enrollment.deck.id } },
    select: { reviewedAt: true },
  })

  const buckets: Record<string, number> = {}
  for (const e of events) { const d = toLocalDay(e.reviewedAt); buckets[d] = (buckets[d] ?? 0) + 1 }

  const result: { date: string; cardsReviewed: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i)
    const key = toLocalDay(d)
    result.push({ date: key, cardsReviewed: buckets[key] ?? 0 })
  }
  res.json(result)
})

// ── GET /stats/accuracy ───────────────────────────────────────────────────────

router.get('/accuracy', async (req: Request, res: Response) => {
  const enrollment = await getEnrollmentForTeacher(req.user!.sub, req.user!.role, p(req, 'classId'), p(req, 'studentId'))
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment not found' }); return }

  const deckId = enrollment.deck.id
  const days = 30
  const since = daysAgo(days + 7)
  const tz = (req.query.tz as string | undefined) || 'UTC'

  const events = await prisma.reviewEvent.findMany({
    where: { reviewedAt: { gte: since }, session: { deckId } },
    select: { reviewedAt: true, grade: true },
    orderBy: { reviewedAt: 'asc' },
  })

  const result: { date: string; accuracy: number | null }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const end = new Date(); end.setHours(23, 59, 59, 999); end.setDate(end.getDate() - i)
    const start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0)
    const window = events.filter((e) => e.reviewedAt >= start && e.reviewedAt <= end)
    const accuracy = window.length > 0 ? window.filter((e) => e.grade >= 2).length / window.length : null
    result.push({ date: end.toLocaleDateString('en-CA', { timeZone: tz }), accuracy })
  }
  res.json(result)
})

// ── GET /stats/forecast ───────────────────────────────────────────────────────

router.get('/forecast', async (req: Request, res: Response) => {
  const enrollment = await getEnrollmentForTeacher(req.user!.sub, req.user!.role, p(req, 'classId'), p(req, 'studentId'))
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment not found' }); return }

  const deckId = enrollment.deck.id
  const now = new Date()

  const instances = await prisma.cardInstance.findMany({
    where: { deckId, state: { not: 'NEW' } },
    select: { due: true },
  })

  const buckets: Record<string, number> = {}
  for (const inst of instances) {
    const key = inst.due.toISOString().slice(0, 10)
    buckets[key] = (buckets[key] ?? 0) + 1
  }

  const daily: { date: string; due: number }[] = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    daily.push({ date: key, due: buckets[key] ?? 0 })
  }

  const cumAt = (n: number) => daily.slice(0, n).reduce((sum, d) => sum + d.due, 0)
  res.json({ daily, cumulative: { days7: cumAt(7), days14: cumAt(14), days30: cumAt(30) } })
})

// ── GET /stats/sessions ───────────────────────────────────────────────────────

router.get('/sessions', async (req: Request, res: Response) => {
  const enrollment = await getEnrollmentForTeacher(req.user!.sub, req.user!.role, p(req, 'classId'), p(req, 'studentId'))
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment not found' }); return }

  const sessions = await prisma.reviewSession.findMany({
    where: { deckId: enrollment.deck.id, endedAt: { not: null } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, endedAt: true, cardsReviewed: true, accuracyRate: true },
  })

  res.json(sessions.map((s) => ({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.endedAt ? s.endedAt.getTime() - s.startedAt.getTime() : null,
    cardsReviewed: s.cardsReviewed,
    accuracyRate: s.accuracyRate,
  })))
})

// ── GET /stats/growth ─────────────────────────────────────────────────────────

router.get('/growth', async (req: Request, res: Response) => {
  const enrollment = await getEnrollmentForTeacher(req.user!.sub, req.user!.role, p(req, 'classId'), p(req, 'studentId'))
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment not found' }); return }

  const days = Math.min(365, Math.max(1, parseInt(req.query.days as string ?? '30') || 30))
  const since = daysAgo(days - 1)

  const instances = await prisma.cardInstance.findMany({
    where: { deckId: enrollment.deck.id, createdAt: { gte: since } },
    select: { createdAt: true },
  })

  const buckets: Record<string, number> = {}
  for (const inst of instances) {
    const d = inst.createdAt.toISOString().slice(0, 10)
    buckets[d] = (buckets[d] ?? 0) + 1
  }

  const result: { date: string; newCards: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    result.push({ date: key, newCards: buckets[key] ?? 0 })
  }
  res.json(result)
})

export default router
