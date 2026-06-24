import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { CardOrigin, CardSetStatus } from '@prisma/client'
import prisma from '../lib/prisma'
import { requireAuth, requireStudent } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { startSession, startRestudy, gradeCard, finishSession } from '../services/review.service'
import studentStatsRouter from './stats.student'

const router = Router()
router.use(requireAuth, requireStudent)
router.use(studentStatsRouter)

// ─── Helper: resolve student record from JWT ──────────────────────────────────

async function getStudent(userId: string) {
  return prisma.student.findUnique({ where: { userId } })
}

const p = (req: Request, key: string) => req.params[key] as string

// ─────────────────────────────────────────────
// Enrollments — student deck picker support
// ─────────────────────────────────────────────

// GET /api/students/enrollments
// Returns all active enrollments for the logged-in student,
// including class name and subjectGrade. Used by the deck-picker UI.
router.get('/enrollments', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) {
    res.status(403).json({ error: 'No student profile found' })
    return
  }
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.id },
    include: {
      class: {
        include: {
          subjectGrade: { select: { id: true, name: true } },
          teacher: { include: { user: { select: { id: true, name: true } } } },
        },
      },
      deck: { select: { id: true } },
      student: { select: { id: true } },
    },
    orderBy: { class: { name: 'asc' } },
  })
  // Filter out enrollments whose class has been archived
  const active = enrollments.filter((e) => !e.class.archivedAt)
  res.json(active)
})

// ─────────────────────────────────────────────
// Deck — student views their card instances
// All deck-scoped endpoints require ?enrollmentId query param (spec §12)
// ─────────────────────────────────────────────

async function getEnrollmentAndDeck(studentId: string, enrollmentId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true },
  })
  if (!enrollment || enrollment.studentId !== studentId) return null
  return enrollment
}

// GET /api/students/deck?enrollmentId=...
router.get('/deck', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getEnrollmentAndDeck(student.id, enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }
  if (!enrollment.deck) { res.status(404).json({ error: 'Deck not found' }); return }

  const instances = await prisma.cardInstance.findMany({
    where: { deckId: enrollment.deck.id },
    include: { card: true },
    orderBy: { due: 'asc' },
  })
  res.json(instances)
})

// ─────────────────────────────────────────────
// Student-added cards + personal CardSet auto-creation (spec §11)
// ─────────────────────────────────────────────

const AddOwnCardSchema = z.object({
  enrollmentId: z.string().uuid(),
  word: z.string().min(1),
  pos: z.string().optional(),
  definitionL2: z.string().optional(),
  definitionL1: z.string().optional(),
  exampleSentence: z.string().optional(),
}).refine(
  (d) => !!d.definitionL2?.trim() || !!d.definitionL1?.trim(),
  { message: 'At least one definition (L1 or L2) is required.' },
)

// POST /api/students/deck/cards
router.post('/deck/cards', validate(AddOwnCardSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollment = await getEnrollmentAndDeck(student.id, req.body.enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }
  if (!enrollment.deck) { res.status(404).json({ error: 'Deck not found' }); return }

  // Auto-create personal CardSet on first student card addition (spec §11)
  const result = await prisma.$transaction(async (tx) => {
    let personalSet = await tx.cardSet.findFirst({
      where: { enrollmentId: enrollment.id, isPersonal: true },
    })
    if (!personalSet) {
      // Get class name for the personal set name
      const cls = await tx.class.findUnique({
        where: { id: enrollment.classId },
        select: { name: true },
      })
      personalSet = await tx.cardSet.create({
        data: {
          name: `My Words — ${cls?.name ?? 'My Class'}`,
          status: CardSetStatus.PRIVATE,
          isPersonal: true,
          enrollmentId: enrollment.id,
        },
      })
    }

    const card = await tx.card.create({
      data: {
        cardSetId: personalSet.id,
        word: req.body.word,
        pos: req.body.pos ?? null,
        definitionL2: req.body.definitionL2 ?? null,
        definitionL1: req.body.definitionL1 ?? null,
        exampleSentence: req.body.exampleSentence ?? null,
      },
    })

    const instance = await tx.cardInstance.create({
      data: {
        deckId: enrollment.deck!.id,
        cardId: card.id,
        origin: CardOrigin.STUDENT_ADDED,
      },
      include: { card: true },
    })

    return instance
  })

  res.status(201).json(result)
})

// PATCH /api/students/deck/cards/:instanceId  — spec §11
// STUDENT_ADDED cards: student owns the underlying Card (it lives in their personal
// CardSet, which is 1:1 with their Enrollment), so they may edit any field directly.
// Teacher-assigned/optional cards: student may only edit their own exampleSentence
// override (CardInstance) and the shared Card's L1 (native-language) definition,
// which teachers typically leave blank for students to fill in themselves.
const PatchInstanceSchema = z.object({
  word: z.string().min(1).optional(),
  pos: z.string().optional(),
  definitionL2: z.string().optional(),
  definitionL1: z.string().optional(),
  exampleSentence: z.string().optional(),
})

router.patch('/deck/cards/:instanceId', validate(PatchInstanceSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const instance = await prisma.cardInstance.findUnique({
    where: { id: p(req, 'instanceId') },
    include: { deck: { include: { enrollment: true } }, card: true },
  })
  if (!instance || instance.deck.enrollment.studentId !== student.id) {
    res.status(404).json({ error: 'Card instance not found' }); return
  }

  const isOwnCard = instance.origin === CardOrigin.STUDENT_ADDED

  if (isOwnCard) {
    const mergedL2 = req.body.definitionL2 !== undefined ? req.body.definitionL2 : instance.card.definitionL2
    const mergedL1 = req.body.definitionL1 !== undefined ? req.body.definitionL1 : instance.card.definitionL1
    if (!mergedL2?.trim() && !mergedL1?.trim()) {
      res.status(400).json({ error: 'At least one definition (L1 or L2) is required.' }); return
    }
    await prisma.card.update({
      where: { id: instance.cardId },
      data: {
        word: req.body.word ?? instance.card.word,
        pos: req.body.pos !== undefined ? (req.body.pos || null) : instance.card.pos,
        definitionL2: req.body.definitionL2 !== undefined ? (req.body.definitionL2 || null) : instance.card.definitionL2,
        definitionL1: req.body.definitionL1 !== undefined ? (req.body.definitionL1 || null) : instance.card.definitionL1,
        exampleSentence: req.body.exampleSentence !== undefined ? (req.body.exampleSentence || null) : instance.card.exampleSentence,
      },
    })
  }

  const instanceData: { exampleSentence?: string | null; definitionL1?: string | null } = {}
  if (!isOwnCard) {
    // Per-student overrides on CardInstance, same pattern as exampleSentence — never
    // written to the shared Card, so one student's L1 translation never affects anyone
    // else who has this same card.
    if (req.body.exampleSentence !== undefined) instanceData.exampleSentence = req.body.exampleSentence || null
    if (req.body.definitionL1 !== undefined) instanceData.definitionL1 = req.body.definitionL1 || null
  }

  const updated = await prisma.cardInstance.update({
    where: { id: instance.id },
    data: instanceData,
    include: { card: true },
  })
  res.json(updated)
})

// DELETE /api/students/deck/cards/:instanceId  — students may only delete their own
// self-added cards. Deletes the CardInstance and the underlying Card (safe: it lives
// in the student's personal CardSet, 1:1 with their Enrollment — nothing else
// references it).
router.delete('/deck/cards/:instanceId', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const instance = await prisma.cardInstance.findUnique({
    where: { id: p(req, 'instanceId') },
    include: { deck: { include: { enrollment: true } } },
  })
  if (!instance || instance.deck.enrollment.studentId !== student.id) {
    res.status(404).json({ error: 'Card instance not found' }); return
  }
  if (instance.origin !== CardOrigin.STUDENT_ADDED) {
    res.status(403).json({ error: 'You can only delete cards you added yourself' }); return
  }

  await prisma.$transaction([
    prisma.reviewEvent.deleteMany({ where: { cardInstanceId: instance.id } }),
    prisma.cardInstance.delete({ where: { id: instance.id } }),
    prisma.card.delete({ where: { id: instance.cardId } }),
  ])
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// Optional CardSets — student opt-in (spec §10, §11)
// ─────────────────────────────────────────────

// GET /api/students/deck/optional?enrollmentId=...
// Returns optional CardSets available to the student (assigned to their class, not yet opted in)
router.get('/deck/optional', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getEnrollmentAndDeck(student.id, enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }

  // Get OPTIONAL assignments for this class
  const optionalAssignments = await prisma.assignment.findMany({
    where: { classId: enrollment.classId, type: 'OPTIONAL' },
    include: { cardSet: { include: { _count: { select: { cards: true } } } } },
  })

  // Exclude any the student has already opted into (CardInstance with origin OPTIONAL from that set)
  // We detect opt-in by checking if the deck has any instances from this CardSet
  const optedInCardSetIds = (
    await prisma.cardInstance.findMany({
      where: {
        deckId: enrollment.deck?.id,
        origin: CardOrigin.OPTIONAL,
        card: { cardSetId: { in: optionalAssignments.map((a) => a.cardSetId) } },
      },
      select: { card: { select: { cardSetId: true } } },
      distinct: ['cardId'],
    })
  ).map((i) => i.card.cardSetId)

  res.json(optionalAssignments.map((a) => ({
    ...a.cardSet,
    added: optedInCardSetIds.includes(a.cardSetId),
  })))
})

// GET /api/students/deck/optional/:cardSetId/cards  — browse cards before opting in
router.get('/deck/optional/:cardSetId/cards', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getEnrollmentAndDeck(student.id, enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }

  // Verify this CardSet is actually assigned as OPTIONAL to the student's class
  const assignment = await prisma.assignment.findFirst({
    where: { classId: enrollment.classId, cardSetId: p(req, 'cardSetId'), type: 'OPTIONAL' },
  })
  if (!assignment) { res.status(404).json({ error: 'CardSet not found' }); return }

  const cards = await prisma.card.findMany({
    where: { cardSetId: p(req, 'cardSetId') },
    select: { id: true, word: true, pos: true, definitionL2: true, definitionL1: true, exampleSentence: true },
    orderBy: { word: 'asc' },
  })

  res.json(cards)
})

// POST /api/students/deck/optional/:cardSetId  — opt in
router.post('/deck/optional/:cardSetId', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getEnrollmentAndDeck(student.id, enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }
  if (!enrollment.deck) { res.status(404).json({ error: 'Deck not found' }); return }

  // Verify there is an OPTIONAL assignment for this CardSet in the student's class
  const assignment = await prisma.assignment.findUnique({
    where: { classId_cardSetId: { classId: enrollment.classId, cardSetId: p(req, 'cardSetId') } },
    include: { cardSet: { include: { cards: { select: { id: true } } } } },
  })
  if (!assignment || assignment.type !== 'OPTIONAL') {
    res.status(404).json({ error: 'Optional CardSet not available for this class' }); return
  }

  // Create CardInstances for all cards in the set (skip any already in deck)
  const cardInstanceData = assignment.cardSet.cards.map((c) => ({
    deckId: enrollment.deck!.id,
    cardId: c.id,
    origin: CardOrigin.OPTIONAL,
  }))

  let added = 0
  if (cardInstanceData.length > 0) {
    const result = await prisma.cardInstance.createMany({ data: cardInstanceData, skipDuplicates: true })
    added = result.count
  }

  res.status(201).json({ ok: true, added })
})

// ─────────────────────────────────────────────
// Deck export — CSV download (spec §23)
// ─────────────────────────────────────────────

// GET /api/students/deck/export?enrollmentId=...
router.get('/deck/export', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const enrollment = await getEnrollmentAndDeck(student.id, enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }
  if (!enrollment.deck) { res.status(404).json({ error: 'Deck not found' }); return }

  const instances = await prisma.cardInstance.findMany({
    where: { deckId: enrollment.deck.id },
    include: { card: true },
    orderBy: { createdAt: 'asc' },
  })

  // Build CSV: student's exampleSentence/definitionL1 override takes priority over card's
  const esc = (v: string | null | undefined) => {
    if (!v) return ''
    if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`
    return v
  }
  const header = 'word,pos,definition_l2,definition_l1,example_sentence'
  const rows = instances.map((inst) => {
    const definitionL1 = inst.definitionL1 ?? inst.card.definitionL1 ?? null
    const example = inst.exampleSentence ?? inst.card.exampleSentence ?? null
    return [
      esc(inst.card.word),
      esc(inst.card.pos),
      esc(inst.card.definitionL2),
      esc(definitionL1),
      esc(example),
    ].join(',')
  })

  const csv = [header, ...rows].join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="deck-export.csv"')
  res.send(csv)
})

// ─────────────────────────────────────────────
// Review session (spec §24)
// ─────────────────────────────────────────────

const StartSessionSchema = z.object({
  enrollmentId: z.string().uuid(),
})

// POST /api/students/review/start
router.post('/review/start', validate(StartSessionSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await startSession(prisma, student.id, req.body.enrollmentId)
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.status(201).json(result)
})

const RestudySchema = z.object({
  enrollmentId: z.string().uuid(),
  instanceIds: z.array(z.string().uuid()).min(1),
})

// POST /api/students/review/restudy — open a fresh session for weak-card re-drill
router.post('/review/restudy', validate(RestudySchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await startRestudy(prisma, student.id, req.body.enrollmentId, req.body.instanceIds)
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.status(201).json(result)
})

const GradeSchema = z.object({
  sessionId: z.string().uuid(),
  instanceId: z.string().uuid(),
  grade: z.number().int().min(1).max(4),
  responseTimeMs: z.number().int().positive().optional(),
})

// POST /api/students/review/grade
router.post('/review/grade', validate(GradeSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await gradeCard(
    prisma,
    student.id,
    req.body.sessionId,
    req.body.instanceId,
    req.body.grade,
    req.body.responseTimeMs,
  )
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

const FinishSchema = z.object({
  sessionId: z.string().uuid(),
})

// POST /api/students/review/finish
router.post('/review/finish', validate(FinishSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await finishSession(prisma, student.id, req.body.sessionId)
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

export default router
