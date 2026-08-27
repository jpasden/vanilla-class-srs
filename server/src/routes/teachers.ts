import { Request, Response } from 'express'
import { z } from 'zod'
import { AssignmentType } from '@prisma/client'
import multer from 'multer'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher, requirePasswordChanged } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { enrollStudents, validateEnrollRows, parseEnrollCsv } from '../services/enrollment.service'
import { generateTempPassword, hashPassword } from '../services/auth.service'
import { createClassAssignment, streamCardInstanceCreation, rollbackOrphanedAssignment, removeAssignment, resumeClassAssignment } from '../services/assignment.service'
import { DEFAULT_MIN_CARDS_PER_SESSION, DEFAULT_PERIOD_DAYS, DEFAULT_ALERT_THRESHOLD_DAYS } from '../services/homework.service'
import { labelsForClass } from '../services/departmentLabels.service'
import teacherStatsRouter from './stats.teacher'
import teacherStudentStatsRouter from './stats.teacher-student'
import teacherStudentAdditionsRouter from './stats.studentAdditions'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })

const router = asyncRouter()
router.use(requireAuth, requireTeacher, requirePasswordChanged)

// ─── Helper: resolve teacher record from JWT ─────────────────────────────────

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } })
}

const p = (req: Request, key: string) => req.params[key] as string

// ─────────────────────────────────────────────
// Classes — teacher manages own classes
// ─────────────────────────────────────────────

const CreateClassSchema = z.object({
  name: z.string().min(1),
  subjectGradeId: z.string().uuid(),
})

const PatchClassSchema = z.object({
  name: z.string().min(1),
})

// GET /api/teachers/classes
router.get('/classes', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  const classes = await prisma.class.findMany({
    where: { teacherId: teacher.id, archivedAt: null },
    orderBy: { name: 'asc' },
    include: {
      subjectGrade: { select: { id: true, name: true } },
      _count: { select: { enrollments: true } },
    },
  })
  res.json(classes)
})

// GET /api/teachers/classes/:id
router.get('/classes/:id', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  const cls = await prisma.class.findUnique({
    where: { id: p(req, 'id') },
    include: {
      subjectGrade: { include: { department: { select: { id: true, name: true } } } },
      _count: { select: { enrollments: true, assignments: true } },
    },
  })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  res.json(cls)
})

// POST /api/teachers/classes
router.post('/classes', validate(CreateClassSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  // Verify teacher belongs to this SubjectGrade
  const membership = await prisma.teacherSubjectGrade.findUnique({
    where: {
      teacherId_subjectGradeId: {
        teacherId: teacher.id,
        subjectGradeId: req.body.subjectGradeId,
      },
    },
  })
  if (!membership) {
    res.status(403).json({ error: 'Not assigned to this SubjectGrade' })
    return
  }
  const sg = await prisma.subjectGrade.findUnique({ where: { id: req.body.subjectGradeId } })
  if (!sg || sg.archivedAt) {
    res.status(400).json({ error: 'SubjectGrade not found or archived' })
    return
  }
  const cls = await prisma.class.create({
    data: {
      name: req.body.name,
      teacherId: teacher.id,
      subjectGradeId: req.body.subjectGradeId,
    },
  })
  res.status(201).json(cls)
})

// PATCH /api/teachers/classes/:id
router.patch('/classes/:id', validate(PatchClassSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  const updated = await prisma.class.update({
    where: { id: p(req, 'id') },
    data: { name: req.body.name },
  })
  res.json(updated)
})

// DELETE /api/teachers/classes/:id  — archives own class
router.delete('/classes/:id', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  const updated = await prisma.class.update({
    where: { id: p(req, 'id') },
    data: { archivedAt: new Date() },
  })
  res.json(updated)
})

// ─────────────────────────────────────────────
// Student enrollment — teacher manages own class enrollments
// ─────────────────────────────────────────────

const AddStudentSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
})

// POST /api/teachers/classes/:id/students  — single add
router.post('/classes/:id/students', validate(AddStudentSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' })
    return
  }

  const results = await enrollStudents(prisma, cls.id, [{ email: req.body.email, name: req.body.name }], req.user!.sub)
  const result = results[0]

  if (result.status === 'error') {
    res.status(500).json({ error: result.error })
    return
  }
  res.status(result.status === 'already_enrolled' ? 200 : 201).json(result)
})

// POST /api/teachers/classes/:id/students/import  — CSV bulk
router.post(
  '/classes/:id/students/import',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const teacher = await getTeacher(req.user!.sub)
    if (!teacher) {
      res.status(403).json({ error: 'No teacher profile found' })
      return
    }
    const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
    if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
      res.status(404).json({ error: 'Class not found' })
      return
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    const confirmedHeaderless = req.query.confirmHeaderless === 'true'
    const parsed = parseEnrollCsv(req.file.buffer, confirmedHeaderless)
    if (parsed.status === 'parse_error') {
      res.status(400).json({ error: 'Invalid CSV format' })
      return
    }
    if (parsed.status === 'needs_confirmation') {
      res.status(200).json({ needsConfirmation: true, detectedFormat: parsed.detectedFormat })
      return
    }

    // Validate all rows before processing — per spec §15, partial imports are rejected
    const validationErrors = validateEnrollRows(parsed.rows)
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'CSV validation failed', validationErrors })
      return
    }

    const results = await enrollStudents(prisma, cls.id, parsed.rows as { email: string; name: string }[], req.user!.sub)
    res.json({ results })
  },
)

// POST /api/teachers/classes/:id/students/:studentId/reset-password
router.post('/classes/:id/students/:studentId/reset-password', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { classId: cls.id, student: { id: p(req, 'studentId') }, archivedAt: null },
    include: { student: { include: { user: { select: { id: true } } } } },
  })
  if (!enrollment) { res.status(404).json({ error: 'Student not found in this class' }); return }

  const tempPassword = generateTempPassword()
  const passwordHash = await hashPassword(tempPassword)
  await prisma.user.update({
    where: { id: enrollment.student.user.id },
    data: { passwordHash, mustChangePassword: true },
  })
  res.json({ tempPassword })
})

// POST /api/teachers/classes/:id/reset-passwords  — reset all students in class
router.post('/classes/:id/reset-passwords', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const enrollments = await prisma.enrollment.findMany({
    where: { classId: cls.id, archivedAt: null },
    include: { student: { include: { user: { select: { id: true, name: true } } } } },
  })

  // Each student gets their own random password — a shared class-wide reset
  // password would recreate the exact weakness this generator replaces.
  const results = await Promise.all(
    enrollments.map(async (e) => {
      const tempPassword = generateTempPassword()
      const passwordHash = await hashPassword(tempPassword)
      await prisma.user.update({
        where: { id: e.student.user.id },
        data: { passwordHash, mustChangePassword: true },
      })
      return { studentName: e.student.user.name, tempPassword }
    }),
  )

  res.json({ results, count: results.length })
})

// GET /api/teachers/classes/:id/students  — list enrolled students
router.get('/classes/:id/students', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  const enrollments = await prisma.enrollment.findMany({
    where: { classId: cls.id, archivedAt: null },
    orderBy: { student: { user: { name: 'asc' } } },
    include: {
      student: {
        include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
      },
      deck: { select: { id: true, _count: { select: { instances: true } } } },
    },
  })
  res.json(enrollments)
})

// DELETE /api/teachers/classes/:id/students/:studentId  — unenroll (soft delete)
// Deck, review history, and CardInstances are left intact — this only removes
// the student from rosters/stats and frees them to be re-enrolled elsewhere.
// Reversible only via direct DB access; there is no "undo" in the UI.
router.delete('/classes/:id/students/:studentId', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }
  const enrollment = await prisma.enrollment.findFirst({
    where: { classId: cls.id, student: { id: p(req, 'studentId') }, archivedAt: null },
  })
  if (!enrollment) { res.status(404).json({ error: 'Student not found in this class' }); return }

  await prisma.enrollment.update({ where: { id: enrollment.id }, data: { archivedAt: new Date() } })
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// Subject grades — read-only for teachers (to know what they're assigned to)
// ─────────────────────────────────────────────

// GET /api/teachers/subject-grades
router.get('/subject-grades', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) {
    res.status(403).json({ error: 'No teacher profile found' })
    return
  }
  const memberships = await prisma.teacherSubjectGrade.findMany({
    where: { teacherId: teacher.id },
    include: {
      subjectGrade: {
        include: { department: { select: { id: true, name: true } } },
      },
    },
  })
  res.json(memberships.map((m) => m.subjectGrade))
})

// ─────────────────────────────────────────────
// Assignments — teacher assigns CardSets to own classes
// ─────────────────────────────────────────────

const CreateAssignmentSchema = z.object({
  cardSetId: z.string().uuid(),
  type: z.nativeEnum(AssignmentType),
  priority: z.number().int().min(0).default(0),
})

// GET /api/teachers/classes/:id/assignments
router.get('/classes/:id/assignments', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }
  const assignments = await prisma.assignment.findMany({
    where: { classId: cls.id },
    orderBy: { priority: 'asc' },
    include: { cardSet: { select: { id: true, name: true, status: true, _count: { select: { cards: true } } } } },
  })
  res.json(assignments)
})

// In-memory store: assignmentId → pending enrollment job for SSE streaming.
// Entries are consumed once by the SSE endpoint and cleaned up after 60 s.
type PendingJob = {
  enrollments: Awaited<ReturnType<typeof createClassAssignment>>['enrollments']
  cardIds: string[]
  className: string
  totalInstances: number
  enrollmentCount: number
  timer: ReturnType<typeof setTimeout>
}
const pendingAssignmentJobs = new Map<string, PendingJob>()

// POST /api/teachers/classes/:id/assignments
// Creates the Assignment record and queues the CardInstance work.
// Returns immediately with { assignmentId, totalInstances, enrollmentCount }
// so the client can open the SSE stream.
router.post(
  '/classes/:id/assignments',
  validate(CreateAssignmentSchema),
  async (req: Request, res: Response) => {
    const teacher = await getTeacher(req.user!.sub)
    if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

    const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
    if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
      res.status(404).json({ error: 'Class not found' }); return
    }

    // CardSet must be accessible to this teacher (own PRIVATE or DEPARTMENTAL in their SG)
    const cs = await prisma.cardSet.findUnique({ where: { id: req.body.cardSetId } })
    if (!cs || cs.archivedAt || cs.isPersonal) {
      res.status(400).json({ error: 'CardSet not found' }); return
    }
    const isOwner = cs.status === 'PRIVATE' && cs.teacherId === teacher.id
    const isDeptInSG = cs.status === 'DEPARTMENTAL' && cs.subjectGradeId === cls.subjectGradeId
    if (!isOwner && !isDeptInSG) {
      res.status(403).json({ error: 'Not authorized to assign this CardSet' }); return
    }

    // Check for duplicate
    const existing = await prisma.assignment.findUnique({
      where: { classId_cardSetId: { classId: cls.id, cardSetId: cs.id } },
    })
    if (existing) {
      res.status(409).json({ error: 'CardSet already assigned to this class' }); return
    }

    const { assignment, enrollments, cardIds } = await createClassAssignment(
      prisma,
      cls.id,
      cs.id,
      req.body.type,
      req.body.priority,
      req.user!.sub,
    )

    const totalInstances = enrollments.filter((e) => e.deck).length * cardIds.length
    const enrollmentCount = enrollments.length

    if (cardIds.length > 0 && enrollments.length > 0) {
      // Park the job for the SSE endpoint to pick up; auto-expire after 60 s
      const timer = setTimeout(() => {
        pendingAssignmentJobs.delete(assignment.id)
        rollbackOrphanedAssignment(prisma, assignment.id)
      }, 60_000)
      pendingAssignmentJobs.set(assignment.id, {
        enrollments,
        cardIds,
        className: cls.name,
        totalInstances,
        enrollmentCount,
        timer,
      })
    }

    res.status(201).json({
      assignmentId: assignment.id,
      cardSetName: cs.name,
      totalInstances,
      enrollmentCount,
      needsStream: cardIds.length > 0 && enrollments.length > 0,
    })
  },
)

// GET /api/teachers/classes/:id/assignments/:assignmentId/progress  (SSE)
// Streams CardInstance creation progress for a pending MANDATORY assignment.
router.get('/classes/:id/assignments/:assignmentId/progress', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const job = pendingAssignmentJobs.get(p(req, 'assignmentId'))
  if (!job) {
    res.status(404).json({ error: 'No pending job found for this assignment' }); return
  }

  // Consume the job immediately so duplicate SSE connections don't double-create
  clearTimeout(job.timer)
  pendingAssignmentJobs.delete(p(req, 'assignmentId'))

  await streamCardInstanceCreation(prisma, res, job.enrollments, job.cardIds, job.className)
})

// GET /api/teachers/classes/:id/assignments/:assignmentId/resume  (SSE)
// Re-streams CardInstance creation for an assignment whose original SSE
// connection dropped mid-way. Re-runs against every current enrollment
// rather than tracking who was already done — skipDuplicates on the
// eventual createMany makes that safe and idempotent, so a flaky-wifi
// disconnect no longer leaves an assignment stuck at "409 to retry, no way
// to remove it" (removeAssignment now also covers that path directly).
router.get('/classes/:id/assignments/:assignmentId/resume', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }
  const assignment = await prisma.assignment.findUnique({ where: { id: p(req, 'assignmentId') } })
  if (!assignment || assignment.classId !== cls.id) {
    res.status(404).json({ error: 'Assignment not found' }); return
  }

  const target = await resumeClassAssignment(prisma, assignment.id)
  if (!target) {
    res.status(400).json({ error: 'Assignment is not resumable' }); return
  }

  await streamCardInstanceCreation(prisma, res, target.enrollments, target.cardIds, target.className)
})

// DELETE /api/teachers/classes/:id/assignments/:assignmentId
// By default also removes the words this assignment put into student decks.
// Pass ?keepCards=true to unassign without touching existing decks.
router.delete('/classes/:id/assignments/:assignmentId', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }
  const assignment = await prisma.assignment.findUnique({ where: { id: p(req, 'assignmentId') } })
  if (!assignment || assignment.classId !== cls.id) {
    res.status(404).json({ error: 'Assignment not found' }); return
  }
  const keepCards = req.query.keepCards === 'true'
  const result = await removeAssignment(prisma, assignment.id, keepCards)
  res.json({ ok: true, cardsRemoved: result.cardsRemoved })
})

// ─────────────────────────────────────────────
// Student personal CardSet view — teacher read-only (spec §11)
// ─────────────────────────────────────────────

// GET /api/teachers/classes/:id/students/:studentId/cards
router.get('/classes/:id/students/:studentId/cards', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }
  // Find the student's enrollment in this class
  const enrollment = await prisma.enrollment.findFirst({
    where: { classId: cls.id, student: { id: p(req, 'studentId') } },
    include: { personalCardSet: { include: { cards: { orderBy: { createdAt: 'desc' } } } } },
  })
  if (!enrollment) { res.status(404).json({ error: 'Student not found in this class' }); return }

  const labels = await labelsForClass(prisma, cls.id)
  res.json({ cards: enrollment.personalCardSet?.cards ?? [], ...labels })
})

// ─────────────────────────────────────────────
// Homework Requirements — spec §20
// ─────────────────────────────────────────────

const HomeworkSchema = z.object({
  sessionsRequired: z.number().int().min(1),
  // Optional CardSet focus — omitted or empty means "any assigned cardsets."
  cardSetIds: z.array(z.string().uuid()).optional(),
})

// GET /api/teachers/classes/:id/homework
router.get('/classes/:id/homework', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { classId: cls.id, isActive: true },
    include: { cardSets: { include: { cardSet: { select: { id: true, name: true } } } } },
  })
  if (!hwReq) { res.json(null); return }

  res.json({
    ...hwReq,
    cardSets: hwReq.cardSets.map((c) => c.cardSet),
  })
})

// POST /api/teachers/classes/:id/homework
router.post('/classes/:id/homework', validate(HomeworkSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const cardSetIds: string[] = req.body.cardSetIds ?? []
  if (cardSetIds.length > 0) {
    const assignedCount = await prisma.assignment.count({
      where: { classId: cls.id, cardSetId: { in: cardSetIds } },
    })
    if (assignedCount !== cardSetIds.length) {
      res.status(400).json({ error: 'One or more CardSets are not assigned to this class' }); return
    }
  }

  // Deactivate any existing active requirement, then create new one (in transaction)
  const hwReq = await prisma.$transaction(async (tx) => {
    await tx.homeworkRequirement.updateMany({
      where: { classId: cls.id, isActive: true },
      data: { isActive: false },
    })
    const created = await tx.homeworkRequirement.create({
      data: {
        classId: cls.id,
        sessionsRequired: req.body.sessionsRequired,
        minCardsPerSession: DEFAULT_MIN_CARDS_PER_SESSION,
        periodDays: DEFAULT_PERIOD_DAYS,
        alertThresholdDays: DEFAULT_ALERT_THRESHOLD_DAYS,
        activeFrom: new Date(),
        isActive: true,
      },
    })
    if (cardSetIds.length > 0) {
      await tx.homeworkRequirementCardSet.createMany({
        data: cardSetIds.map((cardSetId) => ({ homeworkRequirementId: created.id, cardSetId })),
      })
    }
    return created
  })

  res.status(201).json(hwReq)
})

// ─────────────────────────────────────────────
// Class stats — spec §14
// ─────────────────────────────────────────────

// Mount the stats sub-router so it has access to :id param
router.use('/classes/:id/stats', teacherStatsRouter)

// Student-added cards report — separate from the combined stats payload above,
// since it has its own date-range query params (see stats.studentAdditions.ts)
router.use('/classes/:id/student-additions', teacherStudentAdditionsRouter)

// Student stats — teacher read-only view (mirrors student stats routes)
router.use('/classes/:classId/students/:studentId/stats', teacherStudentStatsRouter)

export default router
