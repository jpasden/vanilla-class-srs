/**
 * /api/teachers/cardsets  — teacher-owned CardSet and Card management
 *
 * Only the creating teacher may edit a PRIVATE CardSet.
 * Once promoted to DEPARTMENTAL by admin, the teacher loses edit rights (admin-only).
 *
 * Mounted at /api/teachers by index.ts as a sub-router.
 */

import { Router, Request, Response } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import { CardSetStatus } from '@prisma/client'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { validateCardRows, normaliseCardRow } from '../services/card.service'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

const router = Router()
router.use(requireAuth, requireTeacher)

// ─── Helper: resolve teacher record from JWT ──────────────────────────────────

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } })
}

// ─── Guard: only owner of a PRIVATE CardSet may edit it ───────────────────────

async function getEditableCardSet(cardSetId: string, teacherId: string) {
  const cs = await prisma.cardSet.findUnique({ where: { id: cardSetId } })
  if (!cs || cs.archivedAt) return null
  // DEPARTMENTAL sets are admin-only
  if (cs.status === CardSetStatus.DEPARTMENTAL) return null
  // PRIVATE sets: only the creating teacher
  if (cs.teacherId !== teacherId) return null
  return cs
}

// ─────────────────────────────────────────────
// CardSets
// ─────────────────────────────────────────────

const CreateCardSetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
})

const PatchCardSetSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
})

// GET /api/teachers/cardsets  — own private CardSets + departmental sets for teacher's SGs
router.get('/', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  // Own private sets + any DEPARTMENTAL sets belonging to their SubjectGrades
  const sgIds = (
    await prisma.teacherSubjectGrade.findMany({
      where: { teacherId: teacher.id },
      select: { subjectGradeId: true },
    })
  ).map((m) => m.subjectGradeId)

  const cardSets = await prisma.cardSet.findMany({
    where: {
      archivedAt: null,
      isPersonal: false,
      OR: [
        { teacherId: teacher.id, status: CardSetStatus.PRIVATE },
        { subjectGradeId: { in: sgIds }, status: CardSetStatus.DEPARTMENTAL },
      ],
    },
    orderBy: { name: 'asc' },
    include: { _count: { select: { cards: true } } },
  })
  res.json(cardSets)
})

// GET /api/teachers/cardsets/:id
router.get('/:id', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await prisma.cardSet.findUnique({
    where: { id: req.params.id },
    include: {
      cards: { orderBy: { createdAt: 'asc' } },
      _count: { select: { assignments: true } },
    },
  })
  if (!cs || cs.archivedAt || cs.isPersonal) { res.status(404).json({ error: 'CardSet not found' }); return }

  // Must be owner (PRIVATE) or belong to the SG (DEPARTMENTAL)
  if (cs.status === CardSetStatus.PRIVATE && cs.teacherId !== teacher.id) {
    res.status(404).json({ error: 'CardSet not found' }); return
  }
  if (cs.status === CardSetStatus.DEPARTMENTAL) {
    const membership = await prisma.teacherSubjectGrade.findFirst({
      where: { teacherId: teacher.id, subjectGradeId: cs.subjectGradeId! },
    })
    if (!membership) { res.status(404).json({ error: 'CardSet not found' }); return }
  }

  res.json(cs)
})

// POST /api/teachers/cardsets
router.post('/', validate(CreateCardSetSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await prisma.cardSet.create({
    data: {
      name: req.body.name,
      description: req.body.description,
      status: CardSetStatus.PRIVATE,
      teacherId: teacher.id,
    },
  })
  res.status(201).json(cs)
})

// PATCH /api/teachers/cardsets/:id
router.patch('/:id', validate(PatchCardSetSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await getEditableCardSet(req.params.id, teacher.id)
  if (!cs) { res.status(404).json({ error: 'CardSet not found or not editable' }); return }

  const updated = await prisma.cardSet.update({
    where: { id: cs.id },
    data: { name: req.body.name, description: req.body.description },
  })
  res.json(updated)
})

// DELETE /api/teachers/cardsets/:id  — soft-archives
router.delete('/:id', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await getEditableCardSet(req.params.id, teacher.id)
  if (!cs) { res.status(404).json({ error: 'CardSet not found or not editable' }); return }

  const updated = await prisma.cardSet.update({
    where: { id: cs.id },
    data: { archivedAt: new Date() },
  })
  res.json(updated)
})

// ─────────────────────────────────────────────
// Cards within a CardSet
// ─────────────────────────────────────────────

const CreateCardSchema = z.object({
  word: z.string().min(1),
  pos: z.string().optional(),
  definitionL2: z.string().optional(),
  definitionL1: z.string().optional(),
  exampleSentence: z.string().optional(),
}).refine(
  (d) => !!d.definitionL2?.trim() || !!d.definitionL1?.trim(),
  { message: 'At least one definition (L1 or L2) is required.' },
)

const PatchCardSchema = z.object({
  word: z.string().min(1).optional(),
  pos: z.string().optional(),
  definitionL2: z.string().optional(),
  definitionL1: z.string().optional(),
  exampleSentence: z.string().optional(),
})

// GET /api/teachers/cardsets/:id/cards
router.get('/:id/cards', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await prisma.cardSet.findUnique({ where: { id: req.params.id } })
  if (!cs || cs.archivedAt || cs.isPersonal) { res.status(404).json({ error: 'CardSet not found' }); return }
  if (cs.status === CardSetStatus.PRIVATE && cs.teacherId !== teacher.id) {
    res.status(404).json({ error: 'CardSet not found' }); return
  }

  const cards = await prisma.card.findMany({
    where: { cardSetId: cs.id },
    orderBy: { createdAt: 'asc' },
  })
  res.json(cards)
})

// POST /api/teachers/cardsets/:id/cards  — single card add
router.post('/:id/cards', validate(CreateCardSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await getEditableCardSet(req.params.id, teacher.id)
  if (!cs) { res.status(404).json({ error: 'CardSet not found or not editable' }); return }

  const card = await prisma.card.create({
    data: {
      cardSetId: cs.id,
      word: req.body.word,
      pos: req.body.pos ?? null,
      definitionL2: req.body.definitionL2 ?? null,
      definitionL1: req.body.definitionL1 ?? null,
      exampleSentence: req.body.exampleSentence ?? null,
    },
  })
  res.status(201).json(card)
})

// POST /api/teachers/cardsets/:id/cards/import  — CSV bulk import
router.post(
  '/:id/cards/import',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const teacher = await getTeacher(req.user!.sub)
    if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

    const cs = await getEditableCardSet(req.params.id, teacher.id)
    if (!cs) { res.status(404).json({ error: 'CardSet not found or not editable' }); return }

    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }

    let rows: Record<string, string>[]
    try {
      rows = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[]
    } catch {
      res.status(400).json({ error: 'Invalid CSV format' }); return
    }

    if (rows.length === 0) {
      res.status(400).json({ error: 'CSV contains no data rows' }); return
    }

    // Validate all rows before any DB writes (spec §15: all-or-nothing)
    const errors = validateCardRows(rows)
    if (errors.length > 0) {
      res.status(400).json({ error: 'CSV validation failed', validationErrors: errors }); return
    }

    const cards = await prisma.card.createMany({
      data: rows.map((r) => ({ ...normaliseCardRow(r), cardSetId: cs.id })),
    })
    res.status(201).json({ created: cards.count })
  },
)

// PATCH /api/teachers/cardsets/:csId/cards/:cardId
router.patch('/:csId/cards/:cardId', validate(PatchCardSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await getEditableCardSet(req.params.csId, teacher.id)
  if (!cs) { res.status(404).json({ error: 'CardSet not found or not editable' }); return }

  const card = await prisma.card.findUnique({ where: { id: req.params.cardId } })
  if (!card || card.cardSetId !== cs.id) { res.status(404).json({ error: 'Card not found' }); return }

  // Check the updated card still has at least one definition
  const mergedL2 = req.body.definitionL2 !== undefined ? req.body.definitionL2 : card.definitionL2
  const mergedL1 = req.body.definitionL1 !== undefined ? req.body.definitionL1 : card.definitionL1
  if (!mergedL2?.trim() && !mergedL1?.trim()) {
    res.status(400).json({ error: 'At least one definition (L1 or L2) is required.' }); return
  }

  const updated = await prisma.card.update({
    where: { id: card.id },
    data: {
      word: req.body.word ?? card.word,
      pos: req.body.pos !== undefined ? (req.body.pos || null) : card.pos,
      definitionL2: req.body.definitionL2 !== undefined ? (req.body.definitionL2 || null) : card.definitionL2,
      definitionL1: req.body.definitionL1 !== undefined ? (req.body.definitionL1 || null) : card.definitionL1,
      exampleSentence: req.body.exampleSentence !== undefined ? (req.body.exampleSentence || null) : card.exampleSentence,
    },
  })
  res.json(updated)
})

// DELETE /api/teachers/cardsets/:csId/cards/:cardId
router.delete('/:csId/cards/:cardId', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cs = await getEditableCardSet(req.params.csId, teacher.id)
  if (!cs) { res.status(404).json({ error: 'CardSet not found or not editable' }); return }

  const card = await prisma.card.findUnique({ where: { id: req.params.cardId } })
  if (!card || card.cardSetId !== cs.id) { res.status(404).json({ error: 'Card not found' }); return }

  // Guard: cannot delete a card that is in use in student decks (FK constraint)
  const instanceCount = await prisma.cardInstance.count({ where: { cardId: card.id } })
  if (instanceCount > 0) {
    res.status(409).json({ error: 'Card is in use in student decks and cannot be deleted' }); return
  }

  await prisma.card.delete({ where: { id: card.id } })
  res.json({ ok: true })
})

export default router
