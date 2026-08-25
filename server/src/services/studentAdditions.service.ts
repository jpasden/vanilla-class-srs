/**
 * Student-added card reporting — the full list of vocabulary a student has
 * personally added to their deck (CardOrigin.STUDENT_ADDED), across one or
 * more classes, for a given date range. Powers both the teacher's per-class
 * "Student Additions" stats tab and the admin's school-wide Stats page.
 */

import { PrismaClient } from '@prisma/client'

export interface StudentAddition {
  cardInstanceId: string
  studentName: string
  className: string
  word: string
  definitionL1: string | null
  definitionL2: string | null
  addedAt: Date
}

export async function getStudentAdditions(
  prisma: PrismaClient,
  classIds: string[],
  rangeStart: Date,
  rangeEnd: Date,
): Promise<StudentAddition[]> {
  if (classIds.length === 0) return []

  const instances = await prisma.cardInstance.findMany({
    where: {
      origin: 'STUDENT_ADDED',
      createdAt: { gte: rangeStart, lt: rangeEnd },
      deck: { enrollment: { classId: { in: classIds } } },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      card: { select: { word: true, definitionL1: true, definitionL2: true } },
      deck: {
        include: {
          enrollment: {
            include: {
              student: { include: { user: { select: { name: true } } } },
              class: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  return instances.map((inst) => ({
    cardInstanceId: inst.id,
    studentName: inst.deck.enrollment.student.user.name,
    className: inst.deck.enrollment.class.name,
    word: inst.card.word,
    definitionL1: inst.card.definitionL1,
    definitionL2: inst.card.definitionL2,
    addedAt: inst.createdAt,
  }))
}
