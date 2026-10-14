import { PrismaClient, CardSet } from '@prisma/client'

export class CardSetCopyError extends Error {}

export class CrossSubjectCopyRequired extends CardSetCopyError {
  constructor() {
    super('This CardSet belongs to another Subject/Grade. Confirm to create or reuse an independent copy in the destination group. Later edits will not sync between the sets.')
  }
}

/** Reuse the destination copy so retries and later batches never duplicate learning cards. */
export async function cardSetForSubjectGrade(
  db: PrismaClient, source: CardSet, subjectGradeId: string, confirmed: boolean,
) {
  if (!source.subjectGradeId || source.subjectGradeId === subjectGradeId) return source
  if (!confirmed) throw new CrossSubjectCopyRequired()
  return db.$transaction(async (tx) => {
    // Serialize copies of this source, including requests for the same destination.
    await tx.$queryRaw`SELECT id FROM "CardSet" WHERE id = ${source.id} FOR UPDATE`
    const existing = await tx.cardSet.findUnique({
      where: { copiedFromId_subjectGradeId: { copiedFromId: source.id, subjectGradeId } },
    })
    if (existing) {
      if (existing.archivedAt) throw new CardSetCopyError('The destination copy is archived. Restore it before assigning this CardSet.')
      return existing
    }
    const current = await tx.cardSet.findUniqueOrThrow({ where: { id: source.id }, include: { cards: true } })
    if (current.archivedAt || current.isPersonal) throw new CardSetCopyError('Source CardSet is no longer available')
    return tx.cardSet.create({
      data: {
        name: current.name,
        description: current.description,
        status: 'DEPARTMENTAL',
        subjectGradeId,
        teacherId: current.teacherId,
        copiedFromId: current.id,
        cards: { create: current.cards.map(({ word, pos, definitionL1, definitionL2, exampleSentence }) =>
          ({ word, pos, definitionL1, definitionL2, exampleSentence })) },
      },
    })
  }, { timeout: 30000 })
}
