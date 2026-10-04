import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { classAccess } from '../services/classAccess.service'
import { labelsForClass } from '../services/departmentLabels.service'
import { z } from 'zod'

// Mounted only inside the authenticated Admin and Teacher routers.
const router = asyncRouter()
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().max(200).optional(),
  cardSetId: z.string().uuid().optional(),
  origin: z.enum(['TEACHER_ASSIGNED', 'OPTIONAL', 'STUDENT_ADDED']).optional(),
  state: z.enum(['NEW', 'LEARNING', 'REVIEW', 'RELEARNING']).optional(),
})
router.get('/classes/:id/students/:studentId/deck', async (req, res) => {
  const access = await classAccess(prisma, req.user!.sub, req.user!.role, String(req.params.id))
  if (!access) {
    res.status(404).json({ error: 'Class not available' })
    return
  }
  const enrollment = await prisma.enrollment.findFirst({
    where: { classId: access.cls.id, studentId: String(req.params.studentId), archivedAt: null },
    include: { student: { include: { user: { select: { name: true } } } }, deck: true },
  })
  if (!enrollment) {
    res.status(404).json({ error: 'Enrollment not found' })
    return
  }
  const parsed = querySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid deck filters' })
    return
  }
  const { page, search, cardSetId, origin, state } = parsed.data
  const where = {
    deckId: enrollment.deck?.id ?? '__no_deck__',
    ...(origin ? { origin } : {}),
    ...(state ? { state } : {}),
    card: {
      ...(cardSetId ? { cardSetId } : {}),
      ...(search ? { word: { contains: search, mode: 'insensitive' as const } } : {}),
    },
  }
  const [instances, total, sets, labels] = await Promise.all([
    prisma.cardInstance.findMany({
      where,
      skip: (page - 1) * 50,
      take: 50,
      orderBy: [{ card: { word: 'asc' } }, { id: 'asc' }],
      include: { card: { include: { cardSet: { select: { id: true, name: true } } } } },
    }),
    prisma.cardInstance.count({ where }),
    prisma.cardSet.findMany({
      where: { cards: { some: { instances: { some: { deckId: enrollment.deck?.id ?? '__no_deck__' } } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    labelsForClass(prisma, access.cls.id),
  ])
  res.json({
    studentName: enrollment.student.user.name,
    className: access.cls.name,
    total,
    page,
    pageSize: 50,
    cardSets: sets,
    ...labels,
    cards: instances.map((i) => ({
      id: i.id,
      word: i.card.word,
      pos: i.card.pos,
      definitionL1: i.definitionL1 ?? i.card.definitionL1,
      definitionL2: i.card.definitionL2,
      exampleSentence: i.exampleSentence ?? i.card.exampleSentence,
      cardSet: i.card.cardSet,
      origin: i.origin,
      state: i.state,
      due: i.due,
      lastReview: i.lastReview,
      reps: i.reps,
      lapses: i.lapses,
    })),
  })
})
export default router
