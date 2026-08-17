import { PrismaClient, AssignmentType, CardOrigin } from '@prisma/client'
import { Response } from 'express'

/**
 * Fetch the enrollments + card IDs needed to stream CardInstance creation for
 * a MANDATORY assignment. Shared by fresh creation and by resuming a
 * previously-interrupted stream — both need the *current* state (enrollments
 * and cards can have changed since the assignment was first created), not a
 * snapshot from whenever the job was originally queued.
 */
async function loadStreamTargets(prisma: PrismaClient, classId: string, cardSetId: string) {
  const cardSet = await prisma.cardSet.findUnique({
    where: { id: cardSetId },
    select: { cards: { select: { id: true } } },
  })
  const cardIds = cardSet?.cards.map((c) => c.id) ?? []
  const enrollments = await prisma.enrollment.findMany({
    where: { classId, archivedAt: null },
    include: {
      deck: { select: { id: true } },
      student: { select: { user: { select: { name: true } } } },
    },
  })
  return { cardIds, enrollments }
}

/**
 * Create the Assignment record and fetch the card IDs + enrollments needed for
 * CardInstance creation. Does NOT create CardInstances — caller streams them via
 * streamCardInstanceCreation so the client can show progress.
 *
 * Returns the assignment plus metadata needed by the streaming step.
 */
export async function createClassAssignment(
  prisma: PrismaClient,
  classId: string,
  cardSetId: string,
  type: AssignmentType,
  priority: number,
  assignedBy: string,
) {
  const assignment = await prisma.assignment.create({
    data: { classId, cardSetId, type, priority, assignedBy },
    include: {
      cardSet: {
        select: {
          name: true,
          _count: { select: { cards: true } },
          cards: { select: { id: true } },
        },
      },
    },
  })

  if (type !== AssignmentType.MANDATORY) {
    return { assignment, enrollments: [], cardIds: [] }
  }

  const { cardIds, enrollments } = await loadStreamTargets(prisma, classId, cardSetId)
  return { assignment, enrollments, cardIds }
}

/**
 * Rebuild the streaming target list for an assignment that already exists in
 * the DB — used to resume after a dropped SSE connection. Unlike the
 * in-memory PendingJob (consumed once, lost on drop), this reads current
 * state, so it naturally covers "the connection died, retry" without needing
 * to track which students were already done: skipDuplicates on the eventual
 * createMany makes re-streaming every enrollment safe, not just the
 * incomplete ones.
 */
export async function resumeClassAssignment(prisma: PrismaClient, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } })
  if (!assignment || assignment.type !== AssignmentType.MANDATORY) return null

  const { cardIds, enrollments } = await loadStreamTargets(prisma, assignment.classId, assignment.cardSetId)
  const cls = await prisma.class.findUnique({ where: { id: assignment.classId }, select: { name: true } })
  return { assignment, enrollments, cardIds, className: cls?.name ?? '' }
}

/**
 * Delete an orphaned Assignment that was never streamed (e.g. browser closed
 * before the SSE connection was opened). Restores the all-or-nothing guarantee.
 */
export async function rollbackOrphanedAssignment(prisma: PrismaClient, assignmentId: string) {
  await prisma.assignment.delete({ where: { id: assignmentId } }).catch(() => {
    // Already deleted or never existed — safe to ignore
  })
}

/**
 * Remove an Assignment. By default this also removes every CardInstance (and
 * its ReviewEvents) that this assignment put into student decks across the
 * class — a teacher clicking "Remove" expects the words gone, not orphaned in
 * thirty decks with no way to undo the original mistake. Pass keepCards to
 * leave the words in place and only delete the Assignment row.
 *
 * Only CardInstances still tied to the CardSet's *current* cards are touched
 * — if a card was removed from the set after assignment, its instances (now
 * disconnected from this cardSetId via the Card table) are left alone, since
 * they're no longer something this assignment can be said to own.
 */
export async function removeAssignment(
  prisma: PrismaClient,
  assignmentId: string,
  keepCards: boolean,
): Promise<{ cardsRemoved: number }> {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } })
  if (!assignment) return { cardsRemoved: 0 }

  if (keepCards) {
    await prisma.assignment.delete({ where: { id: assignmentId } })
    return { cardsRemoved: 0 }
  }

  const instances = await prisma.cardInstance.findMany({
    where: {
      card: { cardSetId: assignment.cardSetId },
      deck: { enrollment: { classId: assignment.classId } },
      origin: CardOrigin.TEACHER_ASSIGNED,
    },
    select: { id: true },
  })
  const instanceIds = instances.map((i) => i.id)

  await prisma.$transaction([
    prisma.reviewEvent.deleteMany({ where: { cardInstanceId: { in: instanceIds } } }),
    prisma.cardInstance.deleteMany({ where: { id: { in: instanceIds } } }),
    prisma.assignment.delete({ where: { id: assignmentId } }),
  ])

  return { cardsRemoved: instanceIds.length }
}

/**
 * Stream per-enrollment CardInstance creation over an SSE response.
 * Emits one "progress" event per enrollment, then a "done" event.
 * Each enrollment's instances are created in their own small transaction
 * so the stream can emit incrementally.
 */
export async function streamCardInstanceCreation(
  prisma: PrismaClient,
  res: Response,
  enrollments: Awaited<ReturnType<typeof createClassAssignment>>['enrollments'],
  cardIds: string[],
  className: string,
) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const total = enrollments.length
  let completed = 0

  for (const enrollment of enrollments) {
    if (!enrollment.deck) {
      completed++
      send('progress', {
        studentName: enrollment.student.user.name,
        className,
        instancesCreated: 0,
        completed,
        total,
      })
      continue
    }

    const data = cardIds.map((cardId) => ({
      deckId: enrollment.deck!.id,
      cardId,
      origin: CardOrigin.TEACHER_ASSIGNED,
    }))

    const result = await prisma.cardInstance.createMany({ data, skipDuplicates: true })
    completed++

    send('progress', {
      studentName: enrollment.student.user.name,
      className,
      instancesCreated: result.count,
      completed,
      total,
    })
  }

  send('done', { completed, total })
  res.end()
}

/**
 * Fan out newly-created cards into decks that already have a MANDATORY
 * assignment for this CardSet. Without this, a teacher's normal rhythm of
 * "add this week's words to the existing unit list" silently stops reaching
 * students after the first assignment — the CardSet page shows the new
 * words, the assignment row shows the updated count, but decks stay frozen.
 *
 * Safe to call after every card creation (single add or CSV import) — a
 * CardSet with no MANDATORY assignment yet is a cheap no-op, and
 * skipDuplicates makes re-running against an already-synced deck a no-op too.
 */
export async function syncNewCardsToAssignedDecks(
  prisma: PrismaClient,
  cardSetId: string,
  cardIds: string[],
): Promise<{ instancesCreated: number }> {
  if (cardIds.length === 0) return { instancesCreated: 0 }

  const assignments = await prisma.assignment.findMany({
    where: { cardSetId, type: AssignmentType.MANDATORY },
    select: { classId: true },
  })
  if (assignments.length === 0) return { instancesCreated: 0 }

  const enrollments = await prisma.enrollment.findMany({
    where: { classId: { in: assignments.map((a) => a.classId) }, archivedAt: null },
    include: { deck: { select: { id: true } } },
  })

  const data = enrollments.flatMap((enrollment) =>
    enrollment.deck
      ? cardIds.map((cardId) => ({
          deckId: enrollment.deck!.id,
          cardId,
          origin: CardOrigin.TEACHER_ASSIGNED,
        }))
      : [],
  )
  if (data.length === 0) return { instancesCreated: 0 }

  const result = await prisma.cardInstance.createMany({ data, skipDuplicates: true })
  return { instancesCreated: result.count }
}
