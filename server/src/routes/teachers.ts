import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { AssignmentType } from '@prisma/client'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { enrollStudents, validateEnrollRows } from '../services/enrollment.service'
import { generateTempPassword, hashPassword } from '../services/auth.service'
import { createClassAssignment, streamCardInstanceCreation, rollbackOrphanedAssignment } from '../services/assignment.service'
import { labelsForClass } from '../services/departmentLabels.service'
import teacherStatsRouter from './stats.teacher'
import teacherStudentStatsRouter from './stats.teacher-student'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })

const router = Router()
router.use(requireAuth, requireTeacher)

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
  const [cls, teacherUser] = await Promise.all([
    prisma.class.findUnique({ where: { id: p(req, 'id') } }),
    prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } }),
  ])
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' })
    return
  }

  const results = await enrollStudents(prisma, cls.id, [{ email: req.body.email, name: req.body.name }], teacherUser?.name ?? '')
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
    const [cls, teacherUser] = await Promise.all([
      prisma.class.findUnique({ where: { id: p(req, 'id') } }),
      prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } }),
    ])
    if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
      res.status(404).json({ error: 'Class not found' })
      return
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    let rows: { email: string; name: string }[]
    try {
      rows = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as { email: string; name: string }[]
    } catch {
      res.status(400).json({ error: 'Invalid CSV format' })
      return
    }

    // Validate all rows before processing — per spec §15, partial imports are rejected
    const validationErrors = validateEnrollRows(rows)
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'CSV validation failed', validationErrors })
      return
    }

    const results = await enrollStudents(prisma, cls.id, rows, teacherUser?.name ?? '')
    res.json({ results })
  },
)

// POST /api/teachers/classes/:id/students/:studentId/reset-password
router.post('/classes/:id/students/:studentId/reset-password', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const [cls, teacherUser] = await Promise.all([
    prisma.class.findUnique({ where: { id: p(req, 'id') } }),
    prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } }),
  ])
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { classId: cls.id, student: { id: p(req, 'studentId') } },
    include: { student: { include: { user: { select: { id: true } } } } },
  })
  if (!enrollment) { res.status(404).json({ error: 'Student not found in this class' }); return }

  const tempPassword = generateTempPassword(teacherUser?.name ?? '')
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

  const [cls, teacherUser] = await Promise.all([
    prisma.class.findUnique({ where: { id: p(req, 'id') } }),
    prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } }),
  ])
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const tempPassword = generateTempPassword(teacherUser?.name ?? '')
  const passwordHash = await hashPassword(tempPassword)

  const enrollments = await prisma.enrollment.findMany({
    where: { classId: cls.id },
    include: { student: { include: { user: { select: { id: true } } } } },
  })

  await prisma.user.updateMany({
    where: { id: { in: enrollments.map((e) => e.student.user.id) } },
    data: { passwordHash, mustChangePassword: true },
  })

  res.json({ tempPassword, count: enrollments.length })
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
    where: { classId: cls.id },
    orderBy: { student: { user: { name: 'asc' } } },
    include: {
      student: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      deck: { select: { id: true, _count: { select: { instances: true } } } },
    },
  })
  res.json(enrollments)
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

// DELETE /api/teachers/classes/:id/assignments/:assignmentId
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
  await prisma.assignment.delete({ where: { id: assignment.id } })
  res.json({ ok: true })
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
  minCardsPerSession: z.number().int().min(1),
  periodDays: z.number().int().min(1).default(7),
  alertThresholdDays: z.number().int().min(0).default(2),
  activeFrom: z.string().datetime(),
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
  })
  res.json(hwReq ?? null)
})

// POST /api/teachers/classes/:id/homework
router.post('/classes/:id/homework', validate(HomeworkSchema), async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  // Deactivate any existing active requirement, then create new one (in transaction)
  const hwReq = await prisma.$transaction(async (tx) => {
    await tx.homeworkRequirement.updateMany({
      where: { classId: cls.id, isActive: true },
      data: { isActive: false },
    })
    return tx.homeworkRequirement.create({
      data: {
        classId: cls.id,
        sessionsRequired: req.body.sessionsRequired,
        minCardsPerSession: req.body.minCardsPerSession,
        periodDays: req.body.periodDays,
        alertThresholdDays: req.body.alertThresholdDays,
        activeFrom: new Date(req.body.activeFrom),
        isActive: true,
      },
    })
  })

  res.status(201).json(hwReq)
})

// ─────────────────────────────────────────────
// Class stats — spec §14
// ─────────────────────────────────────────────

// Mount the stats sub-router so it has access to :id param
router.use('/classes/:id/stats', teacherStatsRouter)

// Student stats — teacher read-only view (mirrors student stats routes)
router.use('/classes/:classId/students/:studentId/stats', teacherStudentStatsRouter)

export default router
