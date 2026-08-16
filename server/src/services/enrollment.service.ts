/**
 * Enrollment service — shared logic for adding a student to a class.
 *
 * Called by:
 *   - POST /api/teachers/classes/:id/students  (single)
 *   - POST /api/teachers/classes/:id/students/import  (CSV bulk)
 *   - POST /api/admin/classes/:id/students  (single)
 *   - POST /api/admin/classes/:id/students/import  (CSV bulk)
 *
 * What it does per student:
 *   1. Find or create User (role: STUDENT) + Student profile
 *   2. Create Enrollment (skip if already enrolled)
 *   3. Create Deck for the Enrollment
 *   4. Create CardInstances for every MANDATORY Assignment on the class
 *
 * Returns a per-row result so callers can report partial failures to the client.
 */

import { PrismaClient, Role, CardOrigin } from '@prisma/client'
import { z } from 'zod'
import { hashPassword, generateTempPassword } from './auth.service'

const EmailSchema = z.string().email()

/**
 * Validate a batch of CSV rows before any DB work.
 * Returns an array of validation errors (empty = all valid).
 * Per spec §15: partial imports are rejected — all rows must be valid before processing.
 */
export function validateEnrollRows(
  rows: unknown[],
): { row: number; email?: string; error: string }[] {
  const errors: { row: number; email?: string; error: string }[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, string>
    if (!r.name || !r.name.trim()) {
      errors.push({ row: i + 1, email: r.email, error: 'name is required' })
    }
    if (!r.email || !r.email.trim()) {
      errors.push({ row: i + 1, error: 'email is required' })
    } else if (!EmailSchema.safeParse(r.email.trim()).success) {
      errors.push({ row: i + 1, email: r.email, error: 'invalid email format' })
    }
  }
  return errors
}

export interface EnrollInput {
  email: string
  name: string
}

export interface EnrollResult {
  email: string
  name: string
  status: 'created' | 'enrolled' | 'already_enrolled' | 'error'
  /** One-time temp password — only set when status === 'created' */
  tempPassword?: string
  error?: string
}

/**
 * Enroll a list of students into a class.
 * Each row is processed independently; errors on one row don't abort others.
 * All DB work for a single row runs in a transaction.
 */
export async function enrollStudents(
  prisma: PrismaClient,
  classId: string,
  rows: EnrollInput[],
): Promise<EnrollResult[]> {
  // Load the class's MANDATORY assignments once (used for CardInstance creation)
  const mandatoryAssignments = await prisma.assignment.findMany({
    where: { classId, type: 'MANDATORY' },
    include: { cardSet: { include: { cards: { select: { id: true } } } } },
  })

  const results: EnrollResult[] = []

  for (const row of rows) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // ── 1. Find or create User + Student profile ─────────────────────────
        let user = await tx.user.findUnique({ where: { email: row.email } })
        let tempPassword: string | undefined

        if (!user) {
          tempPassword = generateTempPassword()
          const passwordHash = await hashPassword(tempPassword)
          user = await tx.user.create({
            data: {
              email: row.email,
              name: row.name,
              passwordHash,
              role: Role.STUDENT,
              mustChangePassword: true,
            },
          })
          // Create Student profile
          await tx.student.create({ data: { userId: user.id } })
        }

        // Ensure Student profile exists (user may have been TEACHER or ADMIN)
        let student = await tx.student.findUnique({ where: { userId: user.id } })
        if (!student) {
          student = await tx.student.create({ data: { userId: user.id } })
        }

        // ── 2. Check for existing enrollment ────────────────────────────────
        const existingEnrollment = await tx.enrollment.findUnique({
          where: { studentId_classId: { studentId: student.id, classId } },
        })
        if (existingEnrollment) {
          return { email: row.email, name: row.name, status: 'already_enrolled' as const }
        }

        // ── 3. Create Enrollment ─────────────────────────────────────────────
        const enrollment = await tx.enrollment.create({
          data: { studentId: student.id, classId },
        })

        // ── 4. Create Deck ───────────────────────────────────────────────────
        const deck = await tx.deck.create({ data: { enrollmentId: enrollment.id } })

        // ── 5. Create CardInstances for every MANDATORY assignment ───────────
        if (mandatoryAssignments.length > 0) {
          const cardInstanceData = mandatoryAssignments.flatMap((assignment) =>
            assignment.cardSet.cards.map((card) => ({
              deckId: deck.id,
              cardId: card.id,
              origin: CardOrigin.TEACHER_ASSIGNED,
            })),
          )
          if (cardInstanceData.length > 0) {
            await tx.cardInstance.createMany({ data: cardInstanceData, skipDuplicates: true })
          }
        }

        const status = tempPassword ? 'created' : 'enrolled'
        return { email: row.email, name: row.name, status: status as 'created' | 'enrolled', tempPassword }
      })

      results.push(result)
    } catch (err: any) {
      results.push({ email: row.email, name: row.name, status: 'error', error: err?.message ?? 'Unknown error' })
    }
  }

  return results
}
