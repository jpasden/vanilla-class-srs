/**
 * Student stats endpoints — spec §21.
 *
 * All routes are student-only (requireStudent applied in students router).
 * Mounted at /api/students (prefixed in students.ts via router.use).
 *
 * Routes:
 *   GET /stats/summary         deck state breakdown, streak, weekly goal
 *   GET /stats/daily           cards reviewed per day (days=30 default)
 *   GET /stats/accuracy        rolling 7-day accuracy rate
 *   GET /stats/forecast        due card forecast (7/14/30 days)
 *   GET /stats/sessions        session log
 *   GET /deck/cards/:instanceId/history  per-card review history
 */

import { Request, Response } from 'express'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { getPeriodBounds, getAutoStudyFocus, countQualifyingDays } from '../services/homework.service'

const router = asyncRouter()
const p = (req: Request, key: string) => req.params[key] as string

// ── Helper: resolve student from JWT ─────────────────────────────────────────

async function getStudent(userId: string) {
  return prisma.student.findUnique({ where: { userId } })
}

// ── Helper: get enrollment + deck, verifying ownership ───────────────────────

async function getStudentDeck(studentId: string, enrollmentId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true },
  })
  if (!enrollment || enrollment.studentId !== studentId || enrollment.archivedAt) return null
  return enrollment
}

// ── Helper: today start (server local midnight) ───────────────────────────────

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// ── Helper: date N days ago ───────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

// ─────────────────────────────────────────────
// GET /stats/summary
// Returns:
//   deckBreakdown: { NEW, LEARNING, REVIEW, RELEARNING, dueToday }
//   streak: { current, longest, mostCardsInDay }
//   weeklyGoal: { sessionsRequired, minCardsPerSession, periodDays, sessionsCompleted, daysRemaining }
// ─────────────────────────────────────────────

router.get('/stats/summary', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getStudentDeck(student.id, enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }
  if (!enrollment.deck) { res.status(404).json({ error: 'Deck not found' }); return }

  const deckId = enrollment.deck.id
  const now = new Date()

  // Deck state breakdown
  const instances = await prisma.cardInstance.findMany({
    where: { deckId },
    select: { state: true, due: true },
  })
  const breakdown = { NEW: 0, LEARNING: 0, REVIEW: 0, RELEARNING: 0, dueToday: 0 }
  for (const inst of instances) {
    breakdown[inst.state] = (breakdown[inst.state] ?? 0) + 1
    if (inst.state !== 'NEW' && inst.due <= now) breakdown.dueToday++
  }

  // Streak — consecutive days with at least one completed qualifying session
  // A qualifying session has cardsReviewed >= minCardsPerSession (from HomeworkRequirement, default 1)
  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { class: { enrollments: { some: { id: enrollmentId } } }, isActive: true },
  })
  const minCards = hwReq?.minCardsPerSession ?? 1

  const allSessions = await prisma.reviewSession.findMany({
    where: { deckId, endedAt: { not: null }, cardsReviewed: { gte: minCards } },
    orderBy: { endedAt: 'desc' },
    select: { endedAt: true, cardsReviewed: true },
  })

  const tz = (req.query.tz as string | undefined) || 'UTC'
  const toLocalDay = (date: Date) => {
    try {
      return date.toLocaleDateString('en-CA', { timeZone: tz }) // en-CA gives YYYY-MM-DD
    } catch {
      return date.toISOString().slice(0, 10)
    }
  }

  // Group by calendar day
  const daySet = new Set<string>()
  const cardsPerDay: Record<string, number> = {}
  for (const s of allSessions) {
    if (!s.endedAt) continue
    const d = toLocalDay(s.endedAt)
    daySet.add(d)
    cardsPerDay[d] = (cardsPerDay[d] ?? 0) + s.cardsReviewed
  }

  // Current streak — consecutive days from today/yesterday backwards
  // Use noon UTC as anchor so toLocalDay never flips to the previous day
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

  // Longest streak — scan sorted local-date strings (YYYY-MM-DD), use noon UTC to diff safely
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

  // Most cards in a single day
  const mostCardsInDay = Object.values(cardsPerDay).reduce((max, v) => Math.max(max, v), 0)

  // Weekly goal
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

  // CardSets present in this deck — populates the Study Focus dropdown's options.
  const deckCardSetRows = await prisma.cardInstance.findMany({
    where: { deckId },
    select: { card: { select: { cardSet: { select: { id: true, name: true } } } } },
  })
  const deckCardSetsById = new Map(deckCardSetRows.map((r) => [r.card.cardSet.id, r.card.cardSet.name]))
  const deckCardSets = [...deckCardSetsById].map(([id, name]) => ({ id, name }))

  res.json({
    deckBreakdown: breakdown,
    streak: { current: currentStreak, longest, mostCardsInDay },
    weeklyGoal,
    deckCardSets,
  })
})

// ─────────────────────────────────────────────
// GET /stats/daily?enrollmentId=...&days=30
// Returns array of { date: 'YYYY-MM-DD', cardsReviewed: N }
// ─────────────────────────────────────────────

router.get('/stats/daily', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getStudentDeck(student.id, enrollmentId)
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment or deck not found' }); return }

  const days = Math.min(365, Math.max(1, parseInt(req.query.days as string ?? '30') || 30))
  const since = daysAgo(days - 1)

  // Count ReviewEvents per day (each event = one card review)
  const events = await prisma.reviewEvent.findMany({
    where: {
      reviewedAt: { gte: since },
      session: { deckId: enrollment.deck.id },
    },
    select: { reviewedAt: true },
  })

  const tz = (req.query.tz as string | undefined) || 'UTC'
  const toLocalDay = (date: Date) => {
    try { return date.toLocaleDateString('en-CA', { timeZone: tz }) } catch { return date.toISOString().slice(0, 10) }
  }

  // Bucket by date
  const buckets: Record<string, number> = {}
  for (const e of events) {
    const d = toLocalDay(e.reviewedAt)
    buckets[d] = (buckets[d] ?? 0) + 1
  }

  // Fill all days in range (even zero days)
  const result: { date: string; cardsReviewed: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setHours(12, 0, 0, 0) // use noon to avoid DST edge cases
    d.setDate(d.getDate() - i)
    const key = toLocalDay(d)
    result.push({ date: key, cardsReviewed: buckets[key] ?? 0 })
  }

  res.json(result)
})

// ─────────────────────────────────────────────
// GET /stats/accuracy?enrollmentId=...
// Rolling 7-day accuracy rate (one data point per day for the last 30 days).
// ─────────────────────────────────────────────

router.get('/stats/accuracy', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getStudentDeck(student.id, enrollmentId)
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment or deck not found' }); return }

  const deckId = enrollment.deck.id
  const days = 30

  // Get all events in the last 30+7 days (need 7-day rolling window)
  const since = daysAgo(days + 7)
  const events = await prisma.reviewEvent.findMany({
    where: { reviewedAt: { gte: since }, session: { deckId } },
    select: { reviewedAt: true, grade: true },
    orderBy: { reviewedAt: 'asc' },
  })

  // For each of the last `days` days, compute rolling 7-day accuracy
  const result: { date: string; accuracy: number | null }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    end.setDate(end.getDate() - i)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)

    const window = events.filter((e) => e.reviewedAt >= start && e.reviewedAt <= end)
    const accuracy = window.length > 0
      ? window.filter((e) => e.grade >= 2).length / window.length
      : null

    result.push({ date: end.toLocaleDateString('en-CA', { timeZone: (req.query.tz as string | undefined) || 'UTC' }), accuracy })
  }

  res.json(result)
})

// ─────────────────────────────────────────────
// GET /stats/forecast?enrollmentId=...
// Due card forecast: cards due in next 7, 14, 30 days.
// ─────────────────────────────────────────────

router.get('/stats/forecast', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getStudentDeck(student.id, enrollmentId)
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment or deck not found' }); return }

  const deckId = enrollment.deck.id
  const now = new Date()

  // Get all non-NEW instances with due dates
  const instances = await prisma.cardInstance.findMany({
    where: { deckId, state: { not: 'NEW' } },
    select: { due: true },
  })

  // Bucket by day
  const buckets: Record<string, number> = {}
  for (const inst of instances) {
    const key = inst.due.toISOString().slice(0, 10)
    buckets[key] = (buckets[key] ?? 0) + 1
  }

  // Build forecast for next 30 days (cumulative at 7, 14, 30)
  const daily: { date: string; due: number }[] = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    daily.push({ date: key, due: buckets[key] ?? 0 })
  }

  const cumAt = (n: number) => daily.slice(0, n).reduce((sum, d) => sum + d.due, 0)

  res.json({
    daily,
    cumulative: { days7: cumAt(7), days14: cumAt(14), days30: cumAt(30) },
  })
})

// ─────────────────────────────────────────────
// GET /stats/sessions?enrollmentId=...
// Reverse-chronological session log.
// ─────────────────────────────────────────────

router.get('/stats/sessions', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getStudentDeck(student.id, enrollmentId)
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment or deck not found' }); return }

  const sessions = await prisma.reviewSession.findMany({
    where: { deckId: enrollment.deck.id, endedAt: { not: null } },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      cardsReviewed: true,
      accuracyRate: true,
    },
  })

  const result = sessions.map((s) => ({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.endedAt ? s.endedAt.getTime() - s.startedAt.getTime() : null,
    cardsReviewed: s.cardsReviewed,
    accuracyRate: s.accuracyRate,
  }))

  res.json(result)
})

// ─────────────────────────────────────────────
// GET /deck/cards/:instanceId/history?enrollmentId=...
// Per-card review history (dates + grades; no FSRS internals per spec §21.2).
// ─────────────────────────────────────────────

router.get('/deck/cards/:instanceId/history', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getStudentDeck(student.id, enrollmentId)
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment or deck not found' }); return }

  // Verify the instance belongs to this deck
  const instance = await prisma.cardInstance.findUnique({
    where: { id: p(req, 'instanceId') },
    include: { card: { select: { word: true, pos: true } } },
  })
  if (!instance || instance.deckId !== enrollment.deck.id) {
    res.status(404).json({ error: 'Card instance not found' }); return
  }

  const events = await prisma.reviewEvent.findMany({
    where: { cardInstanceId: instance.id },
    orderBy: { reviewedAt: 'asc' },
    select: { reviewedAt: true, grade: true, responseTimeMs: true },
  })

  res.json({
    instanceId: instance.id,
    word: instance.card.word,
    pos: instance.card.pos,
    events: events.map((e) => ({
      reviewedAt: e.reviewedAt,
      grade: e.grade,
      responseTimeMs: e.responseTimeMs,
    })),
  })
})

// ── GET /stats/growth — new CardInstances per day — §21.2 ────────────────────

router.get('/stats/growth', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getStudentDeck(student.id, enrollmentId)
  if (!enrollment?.deck) { res.status(404).json({ error: 'Enrollment or deck not found' }); return }

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
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    result.push({ date: key, newCards: buckets[key] ?? 0 })
  }

  res.json(result)
})

export default router
