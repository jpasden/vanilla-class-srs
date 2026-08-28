/**
 * Homework — a per-class weekly session quota, optionally focused on
 * specific CardSets. See docs/PRE_LAUNCH_REVIEW.md H6 for the history of
 * why this was rebuilt: the old version had no link to what a student
 * actually studied, and its period math ignored timezone.
 *
 * Defaults below are what a newly-created HomeworkRequirement is populated
 * with — not read live by existing requirements, which store their own
 * values on the row. Change a default here only to change what *future*
 * requirements get; it does not retroactively affect existing ones.
 */

import { PrismaClient } from '@prisma/client'

// Matches the default newCardsPerDay pacing cap (shared/fsrs/constants.ts) so
// a session is achievable from day one — a fresh MANDATORY assignment can
// only ever serve up to newCardsPerDay new cards until some have graduated
// out of NEW state and become due again, which can take several days
// depending on grades given (see FSRS interval scheduling).
export const DEFAULT_MIN_CARDS_PER_SESSION = 10
export const DEFAULT_PERIOD_DAYS = 7
export const DEFAULT_ALERT_THRESHOLD_DAYS = 2

/**
 * Monday 00:00 (inclusive) to the following Monday 00:00 (exclusive), in
 * server-local time. Only correct once the server actually runs in the
 * intended timezone (Asia/Shanghai via docker-compose's TZ) — there is
 * exactly one deployment/timezone for this app today, so this doesn't take
 * a tz parameter the way the chart endpoints do.
 */
export function getCalendarWeekBounds(now: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(now)
  periodStart.setHours(0, 0, 0, 0)
  // getDay(): 0=Sun, 1=Mon, ... 6=Sat. Days since the most recent Monday.
  const daysSinceMonday = (periodStart.getDay() + 6) % 7
  periodStart.setDate(periodStart.getDate() - daysSinceMonday)
  const periodEnd = new Date(periodStart)
  periodEnd.setDate(periodEnd.getDate() + 7)
  return { periodStart, periodEnd }
}

/**
 * The most recent fully-completed Monday–Sunday week — i.e. this week's
 * bounds, shifted back one period. If today is mid-week, that's last week,
 * not the current in-progress one. Used as the default range for reports
 * (e.g. student-added-card exports) where "last week" should mean a
 * finished period, not "the last 7 days including today."
 */
export function getLastCompletedWeekBounds(now: Date): { periodStart: Date; periodEnd: Date } {
  const oneWeekAgo = new Date(now)
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  return getCalendarWeekBounds(oneWeekAgo)
}

/**
 * Anchor-based bounds for any periodDays value other than the 7-day default
 * — kept as a fallback since a HomeworkRequirement row could in principle
 * have a non-default periodDays (the field isn't removed, just not exposed
 * in the current teacher form). Mirrors the app's original period math.
 */
function getAnchoredPeriodBounds(
  activeFrom: Date,
  periodDays: number,
  now: Date,
): { periodStart: Date; periodEnd: Date } {
  const msPerPeriod = periodDays * 86_400_000
  const elapsed = now.getTime() - activeFrom.getTime()
  const periodsComplete = Math.floor(elapsed / msPerPeriod)
  const periodStart = new Date(activeFrom.getTime() + periodsComplete * msPerPeriod)
  const periodEnd = new Date(periodStart.getTime() + msPerPeriod)
  return { periodStart, periodEnd }
}

/** Picks calendar-week bounds for the common case, anchored math otherwise. */
export function getPeriodBounds(
  hwReq: { activeFrom: Date; periodDays: number },
  now: Date,
): { periodStart: Date; periodEnd: Date } {
  if (hwReq.periodDays === DEFAULT_PERIOD_DAYS) return getCalendarWeekBounds(now)
  return getAnchoredPeriodBounds(hwReq.activeFrom, hwReq.periodDays, now)
}

/** Today 00:00 (inclusive) to tomorrow 00:00 (exclusive), server-local time. */
export function getTodayBounds(now: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return { dayStart, dayEnd }
}

/** Has this deck completed at least one qualifying session today? */
export async function hasMetTodaysQuota(
  prisma: PrismaClient,
  deckId: string,
  minCardsPerSession: number,
  now: Date,
): Promise<boolean> {
  const { dayStart, dayEnd } = getTodayBounds(now)
  const count = await prisma.reviewSession.count({
    where: {
      deckId,
      endedAt: { gte: dayStart, lt: dayEnd },
      cardsReviewed: { gte: minCardsPerSession },
    },
  })
  return count >= 1
}

/** A qualifying session only counts toward sessionsRequired if it lands on a different
 * calendar day AND at least this many hours after the previous COUNTED session — either
 * rule alone still allows a near-midnight pair (e.g. 11:58pm/12:02am) to slip through. */
const MIN_HOURS_BETWEEN_COUNTED_SESSIONS = 12
const MIN_MS_BETWEEN_COUNTED_SESSIONS = MIN_HOURS_BETWEEN_COUNTED_SESSIONS * 60 * 60 * 1000

function calendarDayKey(d: Date): string {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy.toISOString()
}

/**
 * Walks a deck's qualifying (cardsReviewed >= minCardsPerSession) sessions within a
 * period, in order, and marks which ones actually count toward sessionsRequired: a
 * session counts if it's the first qualifying one in the period, or if it lands on a
 * different calendar day AND >=12h after the previous COUNTED session. This is stricter
 * than either rule alone — same-day repeats are blocked (the "spread out over the week"
 * intent), and a near-midnight pair (11:58pm/12:02am) is also blocked despite being a
 * different calendar day, since it's really the same sitting.
 *
 * Server-local (Asia/Shanghai) calendar day, same boundary as hasMetTodaysQuota —
 * homework completion isn't tz-param dependent the way the historical stats charts are.
 */
async function walkQualifyingSessions(
  prisma: PrismaClient,
  deckId: string,
  minCardsPerSession: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ id: string; endedAt: Date; counted: boolean }[]> {
  const sessions = await prisma.reviewSession.findMany({
    where: {
      deckId,
      endedAt: { gte: periodStart, lt: periodEnd },
      cardsReviewed: { gte: minCardsPerSession },
    },
    orderBy: { endedAt: 'asc' },
    select: { id: true, endedAt: true },
  })

  const result: { id: string; endedAt: Date; counted: boolean }[] = []
  let lastCounted: Date | null = null
  for (const s of sessions) {
    if (!s.endedAt) continue
    const isNewDay = !lastCounted || calendarDayKey(s.endedAt) !== calendarDayKey(lastCounted)
    const isFarEnough = !lastCounted || s.endedAt.getTime() - lastCounted.getTime() >= MIN_MS_BETWEEN_COUNTED_SESSIONS
    const counted = !lastCounted || (isNewDay && isFarEnough)
    if (counted) lastCounted = s.endedAt
    result.push({ id: s.id, endedAt: s.endedAt, counted })
  }
  return result
}

export async function countQualifyingDays(
  prisma: PrismaClient,
  deckId: string,
  minCardsPerSession: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<number> {
  const walked = await walkQualifyingSessions(prisma, deckId, minCardsPerSession, periodStart, periodEnd)
  return walked.filter((s) => s.counted).length
}

export type StudyFocus =
  | null // no active homework requirement for this class
  | { mode: 'all' }
  | { mode: 'assigned'; cardSetIds: string[]; cardSetNames: string[] }

/**
 * Resolves what a student's study queue should default to focus on right
 * now: the homework's selected CardSet(s), unless there's no selection (the
 * requirement means "any assigned cardsets") or the student has already met
 * today's quota, in which case focus opens back up to the whole deck.
 *
 * Used both to pre-populate the client's Study Focus dropdown and by
 * startSession itself, so what the UI shows as the default matches what
 * actually happens when a session starts without an explicit override.
 */
export async function getAutoStudyFocus(
  prisma: PrismaClient,
  classId: string,
  deckId: string,
  now: Date = new Date(),
): Promise<StudyFocus> {
  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { classId, isActive: true },
    include: { cardSets: { include: { cardSet: { select: { id: true, name: true } } } } },
  })
  if (!hwReq) return null

  if (hwReq.cardSets.length === 0) return { mode: 'all' }

  const metToday = await hasMetTodaysQuota(prisma, deckId, hwReq.minCardsPerSession, now)
  if (metToday) return { mode: 'all' }

  return {
    mode: 'assigned',
    cardSetIds: hwReq.cardSets.map((c) => c.cardSetId),
    cardSetNames: hwReq.cardSets.map((c) => c.cardSet.name),
  }
}

export interface WeeklyGoal {
  sessionsRequired: number
  minCardsPerSession: number
  periodDays: number
  sessionsCompleted: number
  daysRemaining: number
  cardSetFocus: StudyFocus
  /** Set only when getWeeklyGoal is called with justFinishedSessionId: did that specific
   * session count toward sessionsCompleted? null if there's no active requirement, or the
   * session wasn't a qualifying one at all (too few cards). */
  justFinishedSessionCounted?: boolean | null
}

/**
 * The full weeklyGoal payload shown to students/teachers: requirement plus
 * live progress. Pulled into one helper since it was previously copy-pasted
 * across stats.student.ts, stats.teacher-student.ts, and stats.teacher.ts —
 * now also used by finishSession so a student sees updated progress the
 * moment a session ends, not just on a separate stats page.
 *
 * Pass justFinishedSessionId (from finishSession) to also learn whether that
 * particular session counted — lets the client explain a same-day or
 * too-soon-after-last-one session that didn't move the count, instead of
 * leaving the student to guess why.
 */
export async function getWeeklyGoal(
  prisma: PrismaClient,
  classId: string,
  deckId: string,
  now: Date = new Date(),
  justFinishedSessionId?: string,
): Promise<WeeklyGoal | null> {
  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { classId, isActive: true },
  })
  if (!hwReq) return null

  const { periodStart, periodEnd } = getPeriodBounds(hwReq, now)
  const walked = await walkQualifyingSessions(prisma, deckId, hwReq.minCardsPerSession, periodStart, periodEnd)
  const sessionsCompleted = walked.filter((s) => s.counted).length
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000))
  const cardSetFocus = await getAutoStudyFocus(prisma, classId, deckId, now)
  const justFinishedSessionCounted = justFinishedSessionId
    ? walked.find((s) => s.id === justFinishedSessionId)?.counted ?? null
    : undefined

  return {
    sessionsRequired: hwReq.sessionsRequired,
    minCardsPerSession: hwReq.minCardsPerSession,
    periodDays: hwReq.periodDays,
    sessionsCompleted,
    daysRemaining,
    cardSetFocus,
    ...(justFinishedSessionId ? { justFinishedSessionCounted } : {}),
  }
}

export interface ClassCompliance {
  requirement: { sessionsRequired: number; minCardsPerSession: number; periodDays: number; daysRemaining: number }
  summary: string
  students: {
    studentId: string
    name: string
    sessionsCompleted: number
    sessionsRequired: number
    status: 'MET' | 'AT_RISK' | 'NOT_MET'
  }[]
}

/**
 * Per-student homework compliance for a class's active requirement — who's
 * met it, who's at risk, who hasn't. Extracted from stats.teacher.ts so an
 * admin-side read-only view can reuse the exact same computation rather
 * than duplicating it; teacher's own Compliance tab now calls this too.
 */
export async function getClassCompliance(
  prisma: PrismaClient,
  classId: string,
  now: Date = new Date(),
): Promise<ClassCompliance | null> {
  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { classId, isActive: true },
  })
  if (!hwReq) return null

  const enrollments = await prisma.enrollment.findMany({
    where: { classId, archivedAt: null },
    include: {
      student: { include: { user: { select: { id: true, name: true } } } },
      deck: { select: { id: true } },
    },
  })

  const { periodStart, periodEnd } = getPeriodBounds(hwReq, now)
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000))

  const students = await Promise.all(
    enrollments.map(async (enr) => {
      if (!enr.deck) {
        return { studentId: enr.student.id, name: enr.student.user.name, sessionsCompleted: 0, sessionsRequired: hwReq.sessionsRequired, status: 'NOT_MET' as const }
      }

      const sessionsCompleted = await countQualifyingDays(prisma, enr.deck.id, hwReq.minCardsPerSession, periodStart, periodEnd)

      let status: 'MET' | 'AT_RISK' | 'NOT_MET'
      if (sessionsCompleted >= hwReq.sessionsRequired) status = 'MET'
      else if (daysRemaining <= hwReq.alertThresholdDays) status = 'AT_RISK'
      else status = 'NOT_MET'

      return { studentId: enr.student.id, name: enr.student.user.name, sessionsCompleted, sessionsRequired: hwReq.sessionsRequired, status }
    })
  )

  const onTrack = students.filter((s) => s.status === 'MET').length
  return {
    requirement: {
      sessionsRequired: hwReq.sessionsRequired,
      minCardsPerSession: hwReq.minCardsPerSession,
      periodDays: hwReq.periodDays,
      daysRemaining,
    },
    summary: `${onTrack}/${enrollments.length} students on track`,
    students,
  }
}
