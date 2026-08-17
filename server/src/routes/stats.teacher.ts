/**
 * Teacher class stats endpoint — spec §14.
 *
 * Mounted at /api/teachers/classes/:id/stats (registered in teachers.ts).
 * Returns a comprehensive stats object for a single class covering §14.1–§14.8.
 *
 * Route:
 *   GET /classes/:id/stats
 *   Query params:
 *     cardSetId  — optional filter by CardSet
 *     days       — lookback window (default 30)
 */

import { Request, Response } from 'express'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { labelsForClass } from '../services/departmentLabels.service'

const router = asyncRouter({ mergeParams: true })
const p = (req: Request, key: string) => req.params[key] as string

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } })
}

// ── GET /api/teachers/classes/:id/stats ──────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const cardSetId = req.query.cardSetId as string | undefined
  const days = Math.min(365, Math.max(1, parseInt(req.query.days as string ?? '30') || 30))
  const since = daysAgo(days)
  const now = new Date()

  // Load all enrollments for the class
  const enrollments = await prisma.enrollment.findMany({
    where: { classId: cls.id, archivedAt: null },
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      deck: { select: { id: true } },
    },
  })

  const deckIds = enrollments.flatMap((e) => (e.deck ? [e.deck.id] : []))

  // ── §14.1 Mastery Matrix ──────────────────────────────────────────────────
  // For each student × card: accuracy (% grade>=2) and rep count.
  // Filter by cardSetId if provided.
  const instanceFilter: any = { deckId: { in: deckIds } }
  if (cardSetId) instanceFilter.card = { cardSetId }

  const allInstances = await prisma.cardInstance.findMany({
    where: instanceFilter,
    include: {
      card: { select: { id: true, word: true, cardSetId: true } },
      reviewEvents: { select: { grade: true } },
    },
  })

  // Build matrix: { studentId → { cardId → { reps, correctReps, accuracy } } }
  const matrix: Record<string, Record<string, { reps: number; correctReps: number; accuracy: number | null }>> = {}
  const cardMeta: Record<string, { word: string; cardSetId: string }> = {}

  for (const inst of allInstances) {
    const enrollment = enrollments.find((e) => e.deck?.id === inst.deckId)
    if (!enrollment) continue
    const studentId = enrollment.student.id
    const cardId = inst.card.id

    if (!matrix[studentId]) matrix[studentId] = {}
    const reps = inst.reviewEvents.length
    const correctReps = inst.reviewEvents.filter((e) => e.grade >= 2).length
    matrix[studentId][cardId] = {
      reps,
      correctReps,
      accuracy: reps > 0 ? correctReps / reps : null,
    }
    cardMeta[cardId] = { word: inst.card.word, cardSetId: inst.card.cardSetId }
  }

  const masteryMatrix = {
    students: enrollments.map((e) => ({
      studentId: e.student.id,
      name: e.student.user.name,
      email: e.student.user.email,
    })),
    cards: Object.entries(cardMeta).map(([id, meta]) => ({ id, ...meta })),
    cells: matrix,
  }

  // ── §14.2 Student Leaderboard ─────────────────────────────────────────────
  // Total reps and accuracy in the last `days` days.
  const leaderboard: { studentId: string; name: string; totalReps: number; accuracyRate: number | null }[] = []
  for (const enrollment of enrollments) {
    if (!enrollment.deck) {
      leaderboard.push({ studentId: enrollment.student.id, name: enrollment.student.user.name, totalReps: 0, accuracyRate: null })
      continue
    }
    const events = await prisma.reviewEvent.findMany({
      where: {
        reviewedAt: { gte: since },
        session: { deckId: enrollment.deck.id },
        ...(cardSetId ? { cardInstance: { card: { cardSetId } } } : {}),
      },
      select: { grade: true },
    })
    const totalReps = events.length
    const accuracyRate = totalReps > 0 ? events.filter((e) => e.grade >= 2).length / totalReps : null
    leaderboard.push({ studentId: enrollment.student.id, name: enrollment.student.user.name, totalReps, accuracyRate })
  }
  leaderboard.sort((a, b) => b.totalReps - a.totalReps || (b.accuracyRate ?? 0) - (a.accuracyRate ?? 0))

  // ── §14.3 Accuracy Highlighting ──────────────────────────────────────────
  // Flag suspiciously high (>95% with <=3 qualifying sessions) and very low (<50%).
  const accuracyFlags: { studentId: string; name: string; accuracyRate: number | null; flag: string | null }[] = []
  for (const row of leaderboard) {
    let flag: string | null = null
    if (row.accuracyRate !== null) {
      const sessionCount = row.totalReps > 0 ? await prisma.reviewSession.count({
        where: {
          deck: { enrollment: { studentId: row.studentId, classId: cls.id } },
          endedAt: { not: null },
          startedAt: { gte: since },
        },
      }) : 0
      if (row.accuracyRate > 0.95 && sessionCount <= 3) flag = 'suspiciously_high'
      else if (row.accuracyRate < 0.50) flag = 'very_low'
    }
    accuracyFlags.push({ studentId: row.studentId, name: row.name, accuracyRate: row.accuracyRate, flag })
  }

  // ── §14.4 Card Leaderboard ────────────────────────────────────────────────
  // Per card: class-wide accuracy, reviewed count vs. enrolled count.
  const cardLeaderboard: {
    cardId: string; word: string;
    avgAccuracy: number | null; reviewedByCount: number; enrolledCount: number;
    isProblemWord: boolean
  }[] = []
  const totalEnrolled = enrollments.length
  for (const [cardId, meta] of Object.entries(cardMeta)) {
    const studentData = Object.values(matrix).map((m) => m[cardId]).filter(Boolean)
    const reviewedByCount = studentData.filter((d) => d.reps > 0).length
    const accuracies = studentData.filter((d) => d.accuracy !== null).map((d) => d.accuracy!)
    const avgAccuracy = accuracies.length > 0 ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null
    cardLeaderboard.push({
      cardId,
      word: meta.word,
      avgAccuracy,
      reviewedByCount,
      enrolledCount: totalEnrolled,
      isProblemWord: avgAccuracy !== null && avgAccuracy < 0.30,
    })
  }
  cardLeaderboard.sort((a, b) => (a.avgAccuracy ?? 1) - (b.avgAccuracy ?? 1))

  // ── §14.5 Recent Student Additions ───────────────────────────────────────
  // Last 20 student-added cards across the class.
  const recentAdditions = await prisma.cardInstance.findMany({
    where: {
      deckId: { in: deckIds },
      origin: 'STUDENT_ADDED',
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      card: { select: { word: true, definitionL1: true, definitionL2: true } },
      deck: { include: { enrollment: { include: { student: { include: { user: { select: { id: true, name: true } } } } } } } },
    },
  })
  const recentAdditionsList = recentAdditions.map((inst) => ({
    studentId: inst.deck.enrollment.student.id,
    studentName: inst.deck.enrollment.student.user.name,
    word: inst.card.word,
    definitionL1: inst.card.definitionL1,
    definitionL2: inst.card.definitionL2,
    addedAt: inst.createdAt,
  }))

  // ── §14.6 Optional CardSet Adoption ──────────────────────────────────────
  const optionalAssignments = await prisma.assignment.findMany({
    where: { classId: cls.id, type: 'OPTIONAL' },
    include: { cardSet: { select: { id: true, name: true } } },
  })
  const optionalAdoption = await Promise.all(
    optionalAssignments.map(async (asgn) => {
      const adopted = await prisma.cardInstance.findMany({
        where: {
          deckId: { in: deckIds },
          origin: 'OPTIONAL',
          card: { cardSetId: asgn.cardSetId },
        },
        select: { deckId: true },
        distinct: ['deckId'],
      })
      const adoptedStudentIds = adopted.map((a) => {
        const e = enrollments.find((en) => en.deck?.id === a.deckId)
        return e?.student.id ?? null
      }).filter(Boolean) as string[]
      return {
        cardSetId: asgn.cardSetId,
        cardSetName: asgn.cardSet.name,
        adoptedCount: adoptedStudentIds.length,
        totalEnrolled,
        adoptedStudentIds,
      }
    })
  )

  // ── §14.7 Time-Based Graphs ───────────────────────────────────────────────
  // Fetch extra 7 days so rolling accuracy windows have data from day 1.
  const accuracySince = daysAgo(days + 7)
  const classEvents = await prisma.reviewEvent.findMany({
    where: {
      reviewedAt: { gte: accuracySince },
      session: { deckId: { in: deckIds } },
      ...(cardSetId ? { cardInstance: { card: { cardSetId } } } : {}),
    },
    select: { reviewedAt: true, grade: true },
  })

  // Cards reviewed per day — only count events within the `days` lookback window.
  const dailyAggregate: Record<string, number> = {}
  for (const e of classEvents.filter((e) => e.reviewedAt >= since)) {
    const d = e.reviewedAt.toISOString().slice(0, 10)
    dailyAggregate[d] = (dailyAggregate[d] ?? 0) + 1
  }
  const dailyChart: { date: string; cardsReviewed: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dailyChart.push({ date: key, cardsReviewed: dailyAggregate[key] ?? 0 })
  }

  // Rolling 7-day accuracy trend (class aggregate) — §14.7
  const accuracyTrend: { date: string; accuracy: number | null }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    end.setDate(end.getDate() - i)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const window = classEvents.filter((e) => e.reviewedAt >= start && e.reviewedAt <= end)
    const accuracy = window.length > 0
      ? window.filter((e) => e.grade >= 2).length / window.length
      : null
    accuracyTrend.push({ date: end.toISOString().slice(0, 10), accuracy })
  }

  // Due card forecast (class aggregate)
  const allNonNewInstances = await prisma.cardInstance.findMany({
    where: { deckId: { in: deckIds }, state: { not: 'NEW' } },
    select: { due: true, deckId: true },
  })
  const forecastBuckets: Record<string, number> = {}
  for (const inst of allNonNewInstances) {
    const key = inst.due.toISOString().slice(0, 10)
    forecastBuckets[key] = (forecastBuckets[key] ?? 0) + 1
  }
  const forecastDaily: { date: string; due: number }[] = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    forecastDaily.push({ date: key, due: forecastBuckets[key] ?? 0 })
  }

  // Overdue card backlog per student — §14.7
  const overdueCountByDeckId: Record<string, number> = {}
  for (const inst of allNonNewInstances) {
    if (inst.due < now) {
      overdueCountByDeckId[inst.deckId] = (overdueCountByDeckId[inst.deckId] ?? 0) + 1
    }
  }
  const overdueByStudent = enrollments
    .filter((e) => e.deck)
    .map((e) => ({
      studentId: e.student.id,
      name: e.student.user.name,
      overdueCount: overdueCountByDeckId[e.deck!.id] ?? 0,
    }))
    .sort((a, b) => b.overdueCount - a.overdueCount)

  // Deck growth over time — new CardInstances per day (class aggregate) — §14.7
  const allNewInstances = await prisma.cardInstance.findMany({
    where: {
      deckId: { in: deckIds },
      createdAt: { gte: since },
      ...(cardSetId ? { card: { cardSetId } } : {}),
    },
    select: { createdAt: true },
  })
  const growthBuckets: Record<string, number> = {}
  for (const inst of allNewInstances) {
    const d = inst.createdAt.toISOString().slice(0, 10)
    growthBuckets[d] = (growthBuckets[d] ?? 0) + 1
  }
  const deckGrowthDaily: { date: string; newCards: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    deckGrowthDaily.push({ date: key, newCards: growthBuckets[key] ?? 0 })
  }

  // ── §14.8 Homework Compliance ─────────────────────────────────────────────
  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { classId: cls.id, isActive: true },
  })

  let homeworkCompliance = null
  if (hwReq) {
    const msPerPeriod = hwReq.periodDays * 86_400_000
    const elapsed = now.getTime() - hwReq.activeFrom.getTime()
    const periodsComplete = Math.floor(elapsed / msPerPeriod)
    const currentPeriodStart = new Date(hwReq.activeFrom.getTime() + periodsComplete * msPerPeriod)
    const currentPeriodEnd = new Date(currentPeriodStart.getTime() + msPerPeriod)
    const daysRemaining = Math.max(0, Math.ceil((currentPeriodEnd.getTime() - now.getTime()) / 86_400_000))

    const studentCompliance = await Promise.all(
      enrollments.map(async (enr) => {
        if (!enr.deck) return { studentId: enr.student.id, name: enr.student.user.name, sessionsCompleted: 0, status: 'NOT_MET' as const }

        const sessionsCompleted = await prisma.reviewSession.count({
          where: {
            deckId: enr.deck.id,
            endedAt: { gte: currentPeriodStart, lt: currentPeriodEnd },
            cardsReviewed: { gte: hwReq.minCardsPerSession },
          },
        })

        let status: 'MET' | 'AT_RISK' | 'NOT_MET'
        if (sessionsCompleted >= hwReq.sessionsRequired) {
          status = 'MET'
        } else if (daysRemaining <= hwReq.alertThresholdDays) {
          status = 'AT_RISK'
        } else {
          status = 'NOT_MET'
        }

        return {
          studentId: enr.student.id,
          name: enr.student.user.name,
          sessionsCompleted,
          sessionsRequired: hwReq.sessionsRequired,
          status,
        }
      })
    )

    const onTrack = studentCompliance.filter((s) => s.status === 'MET').length
    homeworkCompliance = {
      requirement: {
        sessionsRequired: hwReq.sessionsRequired,
        minCardsPerSession: hwReq.minCardsPerSession,
        periodDays: hwReq.periodDays,
        daysRemaining,
      },
      summary: `${onTrack}/${totalEnrolled} students on track`,
      students: studentCompliance,
    }
  }

  const labels = await labelsForClass(prisma, cls.id)

  res.json({
    classId: cls.id,
    className: cls.name,
    masteryMatrix,
    studentLeaderboard: leaderboard,
    accuracyFlags,
    cardLeaderboard,
    recentStudentAdditions: recentAdditionsList,
    optionalCardSetAdoption: optionalAdoption,
    dailyChart,
    forecastDaily,
    accuracyTrend,
    ...labels,
    overdueByStudent,
    deckGrowthDaily,
    homeworkCompliance,
  })
})

export default router
