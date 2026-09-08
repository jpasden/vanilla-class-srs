/**
 * Streak / best-day computation — shared by the student's "My Stats" page
 * (`GET /students/stats/summary`) and the post-review finish screen
 * (`finishSession`), so the two surfaces can never independently drift on
 * what counts as a "qualifying day." Extracted from stats.student.ts's
 * original inline computation, behavior-preserving.
 */

import { PrismaClient } from '@prisma/client'

export interface StreakAndBestDay {
  currentStreak: number
  longest: number
  mostCardsInDay: number
  /** Local-day-string (YYYY-MM-DD per `tz`) -> total cards reviewed that day. */
  cardsPerDay: Record<string, number>
}

/**
 * A "qualifying day" is a calendar day (in `tz`) with at least one
 * completed ReviewSession whose cardsReviewed meets the class's active
 * HomeworkRequirement.minCardsPerSession (default 1 if none is set).
 */
export async function computeStreakAndBestDay(
  prisma: PrismaClient,
  deckId: string,
  enrollmentId: string,
  tz: string,
  now: Date,
): Promise<StreakAndBestDay> {
  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { class: { enrollments: { some: { id: enrollmentId } } }, isActive: true },
  })
  const minCards = hwReq?.minCardsPerSession ?? 1

  const allSessions = await prisma.reviewSession.findMany({
    where: { deckId, endedAt: { not: null }, cardsReviewed: { gte: minCards } },
    orderBy: { endedAt: 'desc' },
    select: { endedAt: true, cardsReviewed: true },
  })

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

  // Current streak — consecutive days from today/yesterday backwards.
  // Use noon UTC as anchor so toLocalDay never flips to the previous day.
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

  const mostCardsInDay = Object.values(cardsPerDay).reduce((max, v) => Math.max(max, v), 0)

  return { currentStreak, longest, mostCardsInDay, cardsPerDay }
}
