/**
 * Assignment service — retroactive CardInstance creation.
 *
 * When a MANDATORY Assignment is created for a class that already has enrolled
 * students, CardInstances must be immediately created for all of them.
 * Runs inside a single transaction (spec §10: all-or-nothing).
 */

import { PrismaClient, AssignmentType, CardOrigin } from '@prisma/client'

/**
 * Create a class-level Assignment and, if MANDATORY, immediately create
 * CardInstances for all currently enrolled students (in a transaction).
 *
 * Returns the created Assignment.
 */
export async function createClassAssignment(
  prisma: PrismaClient,
  classId: string,
  cardSetId: string,
  type: AssignmentType,
  priority: number,
  assignedBy: string,
) {
  return prisma.$transaction(async (tx) => {
    // Create the Assignment record
    const assignment = await tx.assignment.create({
      data: { classId, cardSetId, type, priority, assignedBy },
      include: { cardSet: { include: { cards: { select: { id: true } } } } },
    })

    // For MANDATORY only: create CardInstances for all enrolled students
    if (type === AssignmentType.MANDATORY) {
      const cardIds = assignment.cardSet.cards.map((c) => c.id)
      if (cardIds.length > 0) {
        // Find all enrolled students' decks
        const enrollments = await tx.enrollment.findMany({
          where: { classId },
          include: { deck: { select: { id: true } } },
        })
        const cardInstanceData = enrollments.flatMap((e) => {
          if (!e.deck) return []
          return cardIds.map((cardId) => ({
            deckId: e.deck!.id,
            cardId,
            origin: CardOrigin.TEACHER_ASSIGNED,
          }))
        })
        if (cardInstanceData.length > 0) {
          await tx.cardInstance.createMany({ data: cardInstanceData, skipDuplicates: true })
        }
      }
    }

    return assignment
  })
}
