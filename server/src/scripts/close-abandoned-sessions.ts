/**
 * Closes ReviewSession rows a student never explicitly finished and never
 * returned to (no new session started on the same deck since). Without
 * this, a student who closes the tab mid-review and doesn't come back
 * leaves that session open (endedAt: null) forever — its real, graded
 * ReviewEvents are invisible to homework compliance and to the
 * "suspiciously high accuracy" heuristic in stats.teacher.ts, both of
 * which only count sessions with endedAt set.
 *
 * A session already gets closed automatically the moment the student
 * starts their NEXT session on that deck (see startSession/startRestudy
 * in review.service.ts) — this job only catches the case where there is
 * no next session, using inactivity (no ReviewEvent, and no further
 * activity) for more than 3 hours as the abandonment signal.
 *
 * Usage (run hourly via host crontab):
 *   docker compose exec -T server npx tsx src/scripts/close-abandoned-sessions.ts
 */

import { PrismaClient } from '@prisma/client'
import { closeSession } from '../services/review.service'

export const ABANDON_THRESHOLD_MS = 3 * 60 * 60 * 1000

export interface OpenSessionForAbandonCheck {
  id: string
  startedAt: Date
  events: { reviewedAt: Date }[]
}

/** A session counts as abandoned once its last activity (most recent
 * ReviewEvent, or startedAt if it has none) is older than the threshold —
 * still-recent sessions are left alone since the student might genuinely
 * still be mid-review. */
export function isAbandoned(session: OpenSessionForAbandonCheck, now: Date): boolean {
  const lastActivity = session.events[0]?.reviewedAt ?? session.startedAt
  return now.getTime() - lastActivity.getTime() > ABANDON_THRESHOLD_MS
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const now = new Date()

    const openSessions = await prisma.reviewSession.findMany({
      where: { endedAt: null },
      include: { events: { orderBy: { reviewedAt: 'desc' }, take: 1 } },
    })

    let closedCount = 0
    for (const session of openSessions) {
      if (!isAbandoned(session, now)) continue // might still be in progress

      await closeSession(prisma, session.id, now)
      closedCount++
    }

    console.log(`Closed ${closedCount} abandoned session(s) out of ${openSessions.length} open.`)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
