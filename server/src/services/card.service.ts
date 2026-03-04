/**
 * Card validation — applied consistently at CSV import and API endpoints (spec §8).
 * At least one of definitionL1 or definitionL2 must be non-empty per row.
 */

export interface CardRowInput {
  word: string
  pos?: string
  definition_l2?: string
  definition_l1?: string
  example_sentence?: string
}

export interface CardRowError {
  row: number
  word?: string
  error: string
}

/**
 * Validate a batch of card rows.
 * Returns an array of errors (empty = all valid).
 * Per spec §15: partial imports rejected — all rows must pass before any DB write.
 */
export function validateCardRows(rows: unknown[]): CardRowError[] {
  const errors: CardRowError[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, string>
    if (!r.word?.trim()) {
      errors.push({ row: i + 1, error: 'word is required' })
      continue
    }
    if (!r.definition_l2?.trim() && !r.definition_l1?.trim()) {
      errors.push({
        row: i + 1,
        word: r.word,
        error: 'At least one definition (L1 or L2) is required.',
      })
    }
  }
  return errors
}

/**
 * Normalise a validated CSV row into the shape Prisma expects.
 */
export function normaliseCardRow(r: Record<string, string>) {
  return {
    word: r.word.trim(),
    pos: r.pos?.trim() || null,
    definitionL2: r.definition_l2?.trim() || null,
    definitionL1: r.definition_l1?.trim() || null,
    exampleSentence: r.example_sentence?.trim() || null,
  }
}
