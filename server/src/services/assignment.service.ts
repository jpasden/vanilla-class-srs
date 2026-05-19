import { PrismaClient, AssignmentType, CardOrigin } from '@prisma/client'
import { Response } from 'express'

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

  const cardIds = assignment.cardSet.cards.map((c) => c.id)
  const enrollments = await prisma.enrollment.findMany({
    where: { classId },
    include: {
      deck: { select: { id: true } },
      student: { select: { user: { select: { name: true } } } },
    },
  })

  return { assignment, enrollments, cardIds }
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
