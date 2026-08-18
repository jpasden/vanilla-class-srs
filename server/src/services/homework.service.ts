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

export const DEFAULT_MIN_CARDS_PER_SESSION = 20
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

/**
 * Homework progress toward sessionsRequired counts distinct CALENDAR DAYS with
 * at least one qualifying session in the period, not raw session count — two
 * qualifying reviews on the same day (even minutes apart, even straddling
 * 11:59pm/12:01am) still only count once. Forces the "spread out over the
 * week" intent behind sessionsRequired instead of letting it be satisfied in
 * one sitting. Server-local (Asia/Shanghai) calendar day, same boundary as
 * hasMetTodaysQuota/getTodayBounds — homework completion isn't tz-param
 * dependent the way the historical stats charts are.
 */
export async function countQualifyingDays(
  prisma: PrismaClient,
  deckId: string,
  minCardsPerSession: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<number> {
  const sessions = await prisma.reviewSession.findMany({
    where: {
      deckId,
      endedAt: { gte: periodStart, lt: periodEnd },
      cardsReviewed: { gte: minCardsPerSession },
    },
    select: { endedAt: true },
  })
  const days = new Set<string>()
  for (const s of sessions) {
    if (!s.endedAt) continue
    const d = new Date(s.endedAt)
    d.setHours(0, 0, 0, 0)
    days.add(d.toISOString())
  }
  return days.size
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
}

/**
 * The full weeklyGoal payload shown to students/teachers: requirement plus
 * live progress. Pulled into one helper since it was previously copy-pasted
 * across stats.student.ts, stats.teacher-student.ts, and stats.teacher.ts —
 * now also used by finishSession so a student sees updated progress the
 * moment a session ends, not just on a separate stats page.
 */
export async function getWeeklyGoal(
  prisma: PrismaClient,
  classId: string,
  deckId: string,
  now: Date = new Date(),
): Promise<WeeklyGoal | null> {
  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { classId, isActive: true },
  })
  if (!hwReq) return null

  const { periodStart, periodEnd } = getPeriodBounds(hwReq, now)
  const sessionsCompleted = await countQualifyingDays(prisma, deckId, hwReq.minCardsPerSession, periodStart, periodEnd)
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000))
  const cardSetFocus = await getAutoStudyFocus(prisma, classId, deckId, now)

  return {
    sessionsRequired: hwReq.sessionsRequired,
    minCardsPerSession: hwReq.minCardsPerSession,
    periodDays: hwReq.periodDays,
    sessionsCompleted,
    daysRemaining,
    cardSetFocus,
  }
}
