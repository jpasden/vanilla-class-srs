import { Request, Response } from 'express'
import { asyncRouter } from '../lib/asyncRouter'
import { z } from 'zod'
import { Role, CardSetStatus, AssignmentType } from '@prisma/client'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import prisma from '../lib/prisma'
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { hashPassword, generateTempPassword } from '../services/auth.service'
import { enrollStudents, validateEnrollRows, parseEnrollCsv } from '../services/enrollment.service'
import { batchAddTeachers, batchAddClasses } from '../services/subjectGradeBatch.service'
import { demoteAdmin, PROTECTED_ADMIN_USER_ID } from '../services/adminRoles.service'
import { resetAllClassPasswords } from '../services/classPasswordReset.service'
import { buildClassStats } from './stats.teacher'
import teacherStudentStatsRouter from './stats.teacher-student'
import { getClassStudentAdditions } from './stats.studentAdditions'
import { createClassAssignment, streamCardInstanceCreation, streamCardInstanceCreationForClasses, rollbackOrphanedAssignment, syncNewCardsToAssignedDecks, removeAssignment, resumeClassAssignment, BatchAssignClassTarget } from '../services/assignment.service'
import { validateCardRows, normaliseCardRow, cardDedupeKey, partitionDuplicateRows } from '../services/card.service'
import { labelsForCardSet, labelsForClass } from '../services/departmentLabels.service'
import { getStudentAdditions } from '../services/studentAdditions.service'
import { logAuditEvent } from '../lib/auditLog'
import {
  getLastCompletedWeekBounds,
  getCalendarWeekBounds,
  getClassCompliance,
  DEFAULT_MIN_CARDS_PER_SESSION,
  DEFAULT_PERIOD_DAYS,
  DEFAULT_ALERT_THRESHOLD_DAYS,
} from '../services/homework.service'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })

const router = asyncRouter()
const p = (req: Request, key: string) => req.params[key] as string
router.use(requireAuth, requireAdmin, requirePasswordChanged)

// ─────────────────────────────────────────────
// Departments
// ─────────────────────────────────────────────

const DepartmentSchema = z.object({
  name: z.string().min(1),
  definitionL2Label: z.string().optional(),
  definitionL1Label: z.string().optional(),
})

// GET /api/admin/departments
// ?archived=true returns only archived departments, for the "show archived" toggle.
router.get('/departments', async (req: Request, res: Response) => {
  const archived = req.query.archived === 'true'
  const departments = await prisma.department.findMany({
    where: archived ? { archivedAt: { not: null } } : { archivedAt: null },
    orderBy: { name: 'asc' },
    include: { _count: { select: { subjectGrades: true } } },
  })
  res.json(departments)
})

// GET /api/admin/departments/:id
router.get('/departments/:id', async (req: Request, res: Response) => {
  const dept = await prisma.department.findUnique({
    where: { id: p(req, 'id') },
    include: {
      subjectGrades: {
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        include: { _count: { select: { classes: true, teachers: true } } },
      },
    },
  })
  if (!dept || dept.archivedAt) {
    res.status(404).json({ error: 'Department not found' })
    return
  }
  res.json(dept)
})

// POST /api/admin/departments
router.post('/departments', validate(DepartmentSchema), async (req: Request, res: Response) => {
  const dept = await prisma.department.create({ data: { name: req.body.name } })
  res.status(201).json(dept)
})

// PATCH /api/admin/departments/:id
// Accepts name and/or the two definition-label overrides. Used by both the quick
// rename modal (name only) and the full Department Settings page (name + labels).
router.patch('/departments/:id', validate(DepartmentSchema), async (req: Request, res: Response) => {
  const dept = await prisma.department.findUnique({ where: { id: p(req, 'id') } })
  if (!dept || dept.archivedAt) {
    res.status(404).json({ error: 'Department not found' })
    return
  }
  const updated = await prisma.department.update({
    where: { id: p(req, 'id') },
    data: {
      name: req.body.name,
      definitionL2Label: req.body.definitionL2Label !== undefined ? (req.body.definitionL2Label.trim() || null) : dept.definitionL2Label,
      definitionL1Label: req.body.definitionL1Label !== undefined ? (req.body.definitionL1Label.trim() || null) : dept.definitionL1Label,
    },
  })
  res.json(updated)
})

// DELETE /api/admin/departments/:id  — archives (soft delete)
router.delete('/departments/:id', async (req: Request, res: Response) => {
  const dept = await prisma.department.findUnique({ where: { id: p(req, 'id') } })
  if (!dept || dept.archivedAt) {
    res.status(404).json({ error: 'Department not found' })
    return
  }
  // Archiving a department cascades to its SubjectGrades and their Classes
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // Archive all classes under this department's subject grades
    const subjectGradeIds = (
      await tx.subjectGrade.findMany({
        where: { departmentId: dept.id },
        select: { id: true },
      })
    ).map((sg) => sg.id)

    await tx.class.updateMany({
      where: { subjectGradeId: { in: subjectGradeIds }, archivedAt: null },
      data: { archivedAt: now },
    })
    await tx.subjectGrade.updateMany({
      where: { departmentId: dept.id, archivedAt: null },
      data: { archivedAt: now },
    })
    await tx.department.update({
      where: { id: dept.id },
      data: { archivedAt: now },
    })
  })
  res.json({ ok: true })
})

// POST /api/admin/departments/:id/unarchive
router.post('/departments/:id/unarchive', async (req: Request, res: Response) => {
  const dept = await prisma.department.findUnique({ where: { id: p(req, 'id') } })
  if (!dept) {
    res.status(404).json({ error: 'Department not found' })
    return
  }
  const updated = await prisma.department.update({
    where: { id: p(req, 'id') },
    data: { archivedAt: null },
  })
  res.json(updated)
})

// ─────────────────────────────────────────────
// SubjectGrades
// ─────────────────────────────────────────────

const SubjectGradeSchema = z.object({
  name: z.string().min(1),
  departmentId: z.string().uuid(),
})

const SubjectGradePatchSchema = z.object({
  name: z.string().min(1).optional(),
  departmentId: z.string().uuid().optional(),
})

// GET /api/admin/subject-grades
// ?archived=true returns only archived subject grades, for the "show archived" toggle.
router.get('/subject-grades', async (req: Request, res: Response) => {
  const archived = req.query.archived === 'true'
  const sgs = await prisma.subjectGrade.findMany({
    where: archived ? { archivedAt: { not: null } } : { archivedAt: null },
    orderBy: { name: 'asc' },
    include: {
      department: { select: { id: true, name: true } },
      _count: { select: { classes: true, teachers: true } },
    },
  })
  res.json(sgs)
})

// GET /api/admin/subject-grades/:id
router.get('/subject-grades/:id', async (req: Request, res: Response) => {
  const sg = await prisma.subjectGrade.findUnique({
    where: { id: p(req, 'id') },
    include: {
      department: { select: { id: true, name: true } },
      teachers: { include: { teacher: { include: { user: { select: { id: true, name: true, email: true } } } } } },
      classes: { where: { archivedAt: null }, orderBy: { name: 'asc' } },
    },
  })
  if (!sg || sg.archivedAt) {
    res.status(404).json({ error: 'SubjectGrade not found' })
    return
  }
  res.json(sg)
})

// POST /api/admin/subject-grades
router.post('/subject-grades', validate(SubjectGradeSchema), async (req: Request, res: Response) => {
  const dept = await prisma.department.findUnique({ where: { id: req.body.departmentId } })
  if (!dept || dept.archivedAt) {
    res.status(400).json({ error: 'Department not found or archived' })
    return
  }
  const sg = await prisma.subjectGrade.create({
    data: { name: req.body.name, departmentId: req.body.departmentId },
  })
  res.status(201).json(sg)
})

// PATCH /api/admin/subject-grades/:id
router.patch('/subject-grades/:id', validate(SubjectGradePatchSchema), async (req: Request, res: Response) => {
  const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
  if (!sg || sg.archivedAt) {
    res.status(404).json({ error: 'SubjectGrade not found' })
    return
  }
  if (req.body.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: req.body.departmentId } })
    if (!dept || dept.archivedAt) {
      res.status(400).json({ error: 'Department not found or archived' })
      return
    }
  }
  const updated = await prisma.subjectGrade.update({
    where: { id: p(req, 'id') },
    data: req.body,
  })
  res.json(updated)
})

// DELETE /api/admin/subject-grades/:id  — archives, cascades to classes
router.delete('/subject-grades/:id', async (req: Request, res: Response) => {
  const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
  if (!sg || sg.archivedAt) {
    res.status(404).json({ error: 'SubjectGrade not found' })
    return
  }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.class.updateMany({
      where: { subjectGradeId: sg.id, archivedAt: null },
      data: { archivedAt: now },
    })
    await tx.subjectGrade.update({ where: { id: sg.id }, data: { archivedAt: now } })
  })
  res.json({ ok: true })
})

// POST /api/admin/subject-grades/:id/unarchive
router.post('/subject-grades/:id/unarchive', async (req: Request, res: Response) => {
  const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
  if (!sg) {
    res.status(404).json({ error: 'SubjectGrade not found' })
    return
  }
  const updated = await prisma.subjectGrade.update({
    where: { id: p(req, 'id') },
    data: { archivedAt: null },
  })
  res.json(updated)
})

// ─────────────────────────────────────────────
// SubjectGrade batch operations (admin) — bulk-add teachers/classes/CardSet
// assignment for a Subject Grade, so setting up a new subject grade doesn't
// require repeating the same single-item form N times.
// ─────────────────────────────────────────────

const BatchAddTeachersSchema = z.object({
  teacherIds: z.array(z.string().uuid()).min(1),
})

// POST /api/admin/subject-grades/:id/teachers — bulk-add teachers to this
// Subject Grade. Mirrors POST /teachers/:id/subject-grades (which already
// accepts multiple SubjectGrade ids for one teacher) in the other direction:
// one SubjectGrade, multiple teachers.
router.post(
  '/subject-grades/:id/teachers',
  validate(BatchAddTeachersSchema),
  async (req: Request, res: Response) => {
    const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
    if (!sg || sg.archivedAt) { res.status(404).json({ error: 'SubjectGrade not found' }); return }

    const results = await batchAddTeachers(prisma, sg.id, req.body.teacherIds)
    res.status(201).json({ results })
  },
)

const BatchAddClassesSchema = z.object({
  classes: z.array(z.object({
    name: z.string().min(1),
    teacherId: z.string().uuid(),
  })).min(1),
})

// POST /api/admin/subject-grades/:id/classes — bulk-create classes in this
// Subject Grade, one row per class with its own name + teacher. Unlike the
// single-class POST /classes route, this requires each teacher to already be
// assigned to the Subject Grade (via TeacherSubjectGrade) — a consistency
// check the single-class route doesn't have, added here deliberately so
// batch-created classes can't silently reproduce that gap at scale.
router.post(
  '/subject-grades/:id/classes',
  validate(BatchAddClassesSchema),
  async (req: Request, res: Response) => {
    const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
    if (!sg || sg.archivedAt) { res.status(404).json({ error: 'SubjectGrade not found' }); return }

    const results = await batchAddClasses(prisma, sg.id, req.body.classes)
    res.status(201).json({ results })
  },
)

// ─────────────────────────────────────────────
// Teachers
// ─────────────────────────────────────────────

const CreateTeacherSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  subjectGradeIds: z.array(z.string().uuid()).optional(),
})

const PatchTeacherSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
})

// GET /api/admin/teachers
router.get('/teachers', async (_req: Request, res: Response) => {
  const teachers = await prisma.teacher.findMany({
    orderBy: { user: { name: 'asc' } },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, lastLoginAt: true } },
      subjectGrades: {
        include: { subjectGrade: { select: { id: true, name: true } } },
      },
      _count: { select: { classes: true } },
    },
  })
  res.json(teachers)
})

// GET /api/admin/teachers/eligible-admins — admins who don't already have a
// Teacher profile, for the "add an admin as a teacher too" flow. requireTeacher
// already allows ADMIN through, and every teachers.ts route resolves identity
// via Teacher.userId (not role), so an admin with a Teacher row can fully use
// /teacher/* alongside /admin/* under one login. Must be registered before
// GET /teachers/:id or Express would treat "eligible-admins" as an :id.
router.get('/teachers/eligible-admins', async (_req: Request, res: Response) => {
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN, teacherProfile: null },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })
  res.json(admins)
})

// POST /api/admin/teachers/from-existing-user — give an existing ADMIN user a
// Teacher profile too, without creating a second account or changing their
// role. They keep full admin access and also gain teacher access.
const CreateTeacherFromExistingSchema = z.object({
  userId: z.string().uuid(),
  subjectGradeIds: z.array(z.string().uuid()).optional(),
})

router.post(
  '/teachers/from-existing-user',
  validate(CreateTeacherFromExistingSchema),
  async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.body.userId } })
    if (!user || user.role !== Role.ADMIN) {
      res.status(400).json({ error: 'User not found or not an admin' })
      return
    }
    const existing = await prisma.teacher.findUnique({ where: { userId: user.id } })
    if (existing) {
      res.status(409).json({ error: 'This admin already has a teacher profile' })
      return
    }

    const teacher = await prisma.$transaction(async (tx) => {
      const t = await tx.teacher.create({ data: { userId: user.id } })
      if (req.body.subjectGradeIds?.length) {
        await tx.teacherSubjectGrade.createMany({
          data: req.body.subjectGradeIds.map((sgId: string) => ({
            teacherId: t.id,
            subjectGradeId: sgId,
          })),
        })
      }
      return t
    })

    logAuditEvent('teacher_profile_added_to_admin', {
      actorUserId: req.user!.sub,
      adminUserId: user.id,
      adminEmail: user.email,
    })

    res.status(201).json({ teacherId: teacher.id })
  },
)

// GET /api/admin/teachers/:id
router.get('/teachers/:id', async (req: Request, res: Response) => {
  const teacher = await prisma.teacher.findUnique({
    where: { id: p(req, 'id') },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      subjectGrades: {
        include: { subjectGrade: { select: { id: true, name: true } } },
      },
      classes: { where: { archivedAt: null }, orderBy: { name: 'asc' } },
    },
  })
  if (!teacher) {
    res.status(404).json({ error: 'Teacher not found' })
    return
  }
  res.json(teacher)
})

// POST /api/admin/teachers
router.post('/teachers', validate(CreateTeacherSchema), async (req: Request, res: Response) => {
  const existing = await prisma.user.findUnique({ where: { email: req.body.email } })
  if (existing) {
    res.status(409).json({ error: 'Email already in use' })
    return
  }

  const tempPassword = generateTempPassword()
  const passwordHash = await hashPassword(tempPassword)

  const teacher = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: req.body.email,
        name: req.body.name,
        passwordHash,
        role: Role.TEACHER,
        mustChangePassword: true,
      },
    })
    const t = await tx.teacher.create({ data: { userId: user.id } })

    if (req.body.subjectGradeIds?.length) {
      await tx.teacherSubjectGrade.createMany({
        data: req.body.subjectGradeIds.map((sgId: string) => ({
          teacherId: t.id,
          subjectGradeId: sgId,
        })),
      })
    }
    return t
  })

  logAuditEvent('teacher_account_created', {
    actorUserId: req.user!.sub,
    teacherEmail: req.body.email,
  })

  // Return the temp password once — it is never retrievable again
  res.status(201).json({ teacherId: teacher.id, tempPassword })
})

// PATCH /api/admin/teachers/:id
router.patch('/teachers/:id', validate(PatchTeacherSchema), async (req: Request, res: Response) => {
  const teacher = await prisma.teacher.findUnique({ where: { id: p(req, 'id') } })
  if (!teacher) {
    res.status(404).json({ error: 'Teacher not found' })
    return
  }
  try {
    const updated = await prisma.user.update({
      where: { id: teacher.userId },
      data: req.body,
      select: { id: true, name: true, email: true, role: true },
    })
    res.json(updated)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'Email already in use' })
      return
    }
    throw err
  }
})

// POST /api/admin/teachers/:id/reset-password
router.post('/teachers/:id/reset-password', async (req: Request, res: Response) => {
  const teacher = await prisma.teacher.findUnique({
    where: { id: p(req, 'id') },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!teacher) {
    res.status(404).json({ error: 'Teacher not found' })
    return
  }

  const tempPassword = generateTempPassword()
  const passwordHash = await hashPassword(tempPassword)
  await prisma.user.update({
    where: { id: teacher.user.id },
    data: { passwordHash, mustChangePassword: true },
  })

  logAuditEvent('teacher_password_reset', {
    actorUserId: req.user!.sub,
    teacherUserId: teacher.user.id,
    teacherEmail: teacher.user.email,
  })

  res.json({ teacherName: teacher.user.name, tempPassword })
})

// DELETE /api/admin/teachers/:id  — removes teacher profile and SubjectGrade memberships.
// Blocked if the teacher still has any classes (active OR archived) — admin must reassign
// all classes to another teacher first. User record is retained; role is demoted to STUDENT.
router.delete('/teachers/:id', async (req: Request, res: Response) => {
  const teacher = await prisma.teacher.findUnique({
    where: { id: p(req, 'id') },
    include: { _count: { select: { classes: true } } },
  })
  if (!teacher) {
    res.status(404).json({ error: 'Teacher not found' })
    return
  }
  // Block on ALL classes (active + archived) — FK constraint on Class.teacherId prevents deletion
  const totalClassCount = teacher._count.classes
  if (totalClassCount > 0) {
    const activeCount = await prisma.class.count({
      where: { teacherId: teacher.id, archivedAt: null },
    })
    res.status(409).json({
      error: `Teacher still has ${totalClassCount} class(es) (${activeCount} active). Reassign all classes to another teacher first.`,
    })
    return
  }
  await prisma.$transaction(async (tx) => {
    await tx.teacherSubjectGrade.deleteMany({ where: { teacherId: teacher.id } })
    await tx.teacher.delete({ where: { id: teacher.id } })
    await tx.user.update({
      where: { id: teacher.userId },
      data: { role: Role.STUDENT }, // demote to prevent orphaned TEACHER role
    })
  })
  res.json({ ok: true })
})

// POST /api/admin/teachers/:id/promote-admin
router.post('/teachers/:id/promote-admin', async (req: Request, res: Response) => {
  const teacher = await prisma.teacher.findUnique({
    where: { id: p(req, 'id') },
    include: { user: true },
  })
  if (!teacher) {
    res.status(404).json({ error: 'Teacher not found' })
    return
  }
  if (teacher.user.role === Role.ADMIN) {
    res.status(400).json({ error: 'User is already an admin' })
    return
  }
  const updated = await prisma.user.update({
    where: { id: teacher.userId },
    data: { role: Role.ADMIN },
    select: { id: true, name: true, email: true, role: true },
  })
  res.json(updated)
})

// GET /api/admin/admins — every ADMIN user, for the demote-admin UI.
router.get('/admins', async (_req: Request, res: Response) => {
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN },
    select: { id: true, name: true, email: true, teacherProfile: { select: { id: true } } },
    orderBy: { name: 'asc' },
  })
  res.json(admins.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    hasTeacherProfile: !!a.teacherProfile,
    protected: a.id === PROTECTED_ADMIN_USER_ID,
  })))
})

// POST /api/admin/admins/:id/demote — demote an admin back to teacher (if
// they have a Teacher profile) or student (if not). Blocked if this would
// leave zero admins, or if the target is the protected founding admin.
router.post('/admins/:id/demote', async (req: Request, res: Response) => {
  const result = await demoteAdmin(prisma, p(req, 'id'))
  switch (result.status) {
    case 'protected':
      res.status(403).json({ error: 'This admin account cannot be demoted' })
      return
    case 'not_found':
      res.status(404).json({ error: 'Admin not found' })
      return
    case 'last_admin':
      res.status(409).json({ error: 'Cannot demote the last remaining admin' })
      return
    case 'ok':
      logAuditEvent('admin_demoted', {
        actorUserId: req.user!.sub,
        demotedUserId: result.user.id,
        demotedEmail: result.user.email,
        newRole: result.user.role,
      })
      res.json(result.user)
      return
  }
})

// POST /api/admin/teachers/:id/subject-grades  — assign teacher to subject grade(s)
const AssignSubjectGradesSchema = z.object({
  subjectGradeIds: z.array(z.string().uuid()).min(1),
})

router.post(
  '/teachers/:id/subject-grades',
  validate(AssignSubjectGradesSchema),
  async (req: Request, res: Response) => {
    const teacher = await prisma.teacher.findUnique({ where: { id: p(req, 'id') } })
    if (!teacher) {
      res.status(404).json({ error: 'Teacher not found' })
      return
    }
    // upsert — skip duplicates
    await prisma.teacherSubjectGrade.createMany({
      data: req.body.subjectGradeIds.map((sgId: string) => ({
        teacherId: teacher.id,
        subjectGradeId: sgId,
      })),
      skipDuplicates: true,
    })
    res.json({ ok: true })
  }
)

// DELETE /api/admin/teachers/:id/subject-grades/:subjectGradeId
router.delete(
  '/teachers/:id/subject-grades/:subjectGradeId',
  async (req: Request, res: Response) => {
    await prisma.teacherSubjectGrade.deleteMany({
      where: { teacherId: p(req, 'id'), subjectGradeId: p(req, 'subjectGradeId') },
    })
    res.json({ ok: true })
  }
)

// ─────────────────────────────────────────────
// Classes (admin manages all; teachers manage own — see teacher routes)
// ─────────────────────────────────────────────

const CreateClassSchema = z.object({
  name: z.string().min(1),
  teacherId: z.string().uuid(),
  subjectGradeId: z.string().uuid(),
})

const PatchClassSchema = z.object({
  name: z.string().min(1).optional(),
  teacherId: z.string().uuid().optional(),
})

// GET /api/admin/classes
// ?archived=true returns only archived classes, for the "show archived" toggle.
// ?subjectGradeId= / ?teacherId= narrow the list — used by drill-through links
// from the Subject Grades and Teachers pages.
router.get('/classes', async (req: Request, res: Response) => {
  const archived = req.query.archived === 'true'
  const subjectGradeId = req.query.subjectGradeId as string | undefined
  const teacherId = req.query.teacherId as string | undefined
  const classes = await prisma.class.findMany({
    where: {
      archivedAt: archived ? { not: null } : null,
      ...(subjectGradeId && { subjectGradeId }),
      ...(teacherId && { teacherId }),
    },
    orderBy: { name: 'asc' },
    include: {
      teacher: { include: { user: { select: { id: true, name: true } } } },
      subjectGrade: { select: { id: true, name: true } },
      _count: { select: { enrollments: true, assignments: true } },
    },
  })
  res.json(classes)
})

// GET /api/admin/classes/:id
router.get('/classes/:id', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({
    where: { id: p(req, 'id') },
    include: {
      teacher: { include: { user: { select: { id: true, name: true, email: true } } } },
      subjectGrade: { include: { department: { select: { id: true, name: true } } } },
      _count: { select: { enrollments: true, assignments: true } },
    },
  })
  if (!cls || cls.archivedAt) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  res.json(cls)
})

// POST /api/admin/classes
router.post('/classes', validate(CreateClassSchema), async (req: Request, res: Response) => {
  const [teacher, sg] = await Promise.all([
    prisma.teacher.findUnique({ where: { id: req.body.teacherId } }),
    prisma.subjectGrade.findUnique({ where: { id: req.body.subjectGradeId } }),
  ])
  if (!teacher) {
    res.status(400).json({ error: 'Teacher not found' })
    return
  }
  if (!sg || sg.archivedAt) {
    res.status(400).json({ error: 'SubjectGrade not found or archived' })
    return
  }
  const cls = await prisma.class.create({
    data: {
      name: req.body.name,
      teacherId: req.body.teacherId,
      subjectGradeId: req.body.subjectGradeId,
    },
  })
  res.status(201).json(cls)
})

// PATCH /api/admin/classes/:id
router.patch('/classes/:id', validate(PatchClassSchema), async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  if (req.body.teacherId) {
    const teacher = await prisma.teacher.findUnique({ where: { id: req.body.teacherId } })
    if (!teacher) {
      res.status(400).json({ error: 'Teacher not found' })
      return
    }
  }
  const updated = await prisma.class.update({
    where: { id: p(req, 'id') },
    data: req.body,
  })
  res.json(updated)
})

// DELETE /api/admin/classes/:id  — archives
router.delete('/classes/:id', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  const updated = await prisma.class.update({
    where: { id: p(req, 'id') },
    data: { archivedAt: new Date() },
  })
  res.json(updated)
})

// POST /api/admin/classes/:id/unarchive
router.post('/classes/:id/unarchive', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  const updated = await prisma.class.update({
    where: { id: p(req, 'id') },
    data: { archivedAt: null },
  })
  res.json(updated)
})

// ─────────────────────────────────────────────
// Student enrollment — admin manages any class
// ─────────────────────────────────────────────

const AddStudentSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
})

// POST /api/admin/classes/:id/students  — single add
router.post('/classes/:id/students', validate(AddStudentSchema), async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) {
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

// POST /api/admin/classes/:id/students/import  — CSV bulk
router.post(
  '/classes/:id/students/import',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
    if (!cls || cls.archivedAt) {
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

// GET /api/admin/classes/:id/students  — list enrolled students
router.get('/classes/:id/students', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) {
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

// DELETE /api/admin/classes/:id/students/:studentId  — unenroll (soft delete)
// Same semantics as the teacher-facing route: deck and review history are
// left intact, only removed from rosters/stats.
router.delete('/classes/:id/students/:studentId', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) {
    res.status(404).json({ error: 'Class not found' })
    return
  }
  const enrollment = await prisma.enrollment.findFirst({
    where: { classId: cls.id, student: { id: p(req, 'studentId') }, archivedAt: null },
  })
  if (!enrollment) { res.status(404).json({ error: 'Student not found in this class' }); return }

  await prisma.enrollment.update({ where: { id: enrollment.id }, data: { archivedAt: new Date() } })
  res.json({ ok: true })
})

const PatchStudentSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
})

// PATCH /api/admin/classes/:id/students/:studentId  — edit name/email
router.patch(
  '/classes/:id/students/:studentId',
  validate(PatchStudentSchema),
  async (req: Request, res: Response) => {
    const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
    if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

    const enrollment = await prisma.enrollment.findFirst({
      where: { classId: cls.id, student: { id: p(req, 'studentId') }, archivedAt: null },
      include: { student: { include: { user: { select: { id: true } } } } },
    })
    if (!enrollment) { res.status(404).json({ error: 'Student not found in this class' }); return }

    try {
      const updated = await prisma.user.update({
        where: { id: enrollment.student.user.id },
        data: req.body,
        select: { id: true, name: true, email: true },
      })
      res.json(updated)
    } catch (err: any) {
      if (err?.code === 'P2002') {
        res.status(409).json({ error: 'Email already in use' })
        return
      }
      throw err
    }
  },
)

// POST /api/admin/classes/:id/students/:studentId/reset-password
router.post('/classes/:id/students/:studentId/reset-password', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

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

// POST /api/admin/classes/:id/reset-passwords  — reset all students in class
router.post('/classes/:id/reset-passwords', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

  const results = await resetAllClassPasswords(prisma, cls.id)
  res.json({ results, count: results.length })
})

// GET /api/admin/classes/:id/students/:studentId/cards — a student's
// personally-added cards for this class, any class (no ownership check).
router.get('/classes/:id/students/:studentId/cards', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

  const enrollment = await prisma.enrollment.findFirst({
    where: { classId: cls.id, student: { id: p(req, 'studentId') } },
    include: { personalCardSet: { include: { cards: { orderBy: { createdAt: 'desc' } } } } },
  })
  if (!enrollment) { res.status(404).json({ error: 'Student not found in this class' }); return }

  const labels = await labelsForClass(prisma, cls.id)
  res.json({ cards: enrollment.personalCardSet?.cards ?? [], ...labels })
})

// Per-student stats — reuses the same router mounted under /api/teachers/*.
// Its internal auth helper already special-cases ADMIN (see
// stats.teacher-student.ts's getEnrollmentForTeacher) to skip the
// owns-this-class check, so this is safe to mount here unmodified.
router.use('/classes/:classId/students/:studentId/stats', teacherStudentStatsRouter)

// ─────────────────────────────────────────────
// CardSet creation + promotion (spec §10)
// Admin can author a CardSet directly (created straight to DEPARTMENTAL,
// scoped to a SubjectGrade — an admin-authored set has no teacher owner to
// keep it PRIVATE for), or promote a teacher's existing PRIVATE CardSet to
// DEPARTMENTAL, linking it to a SubjectGrade. Teacher loses edit rights
// after promotion either way.
// ─────────────────────────────────────────────

const CreateAdminCardSetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  subjectGradeId: z.string().uuid(),
})

// POST /api/admin/cardsets — admin authors a new Departmental CardSet directly
router.post('/cardsets', validate(CreateAdminCardSetSchema), async (req: Request, res: Response) => {
  const sg = await prisma.subjectGrade.findUnique({ where: { id: req.body.subjectGradeId } })
  if (!sg || sg.archivedAt) {
    res.status(400).json({ error: 'SubjectGrade not found or archived' }); return
  }
  const cs = await prisma.cardSet.create({
    data: {
      name: req.body.name,
      description: req.body.description,
      status: CardSetStatus.DEPARTMENTAL,
      subjectGradeId: sg.id,
    },
  })
  res.status(201).json(cs)
})

const PromoteCardSetSchema = z.object({
  subjectGradeId: z.string().uuid(),
})

// POST /api/admin/cardsets/:id/promote
router.post('/cardsets/:id/promote', validate(PromoteCardSetSchema), async (req: Request, res: Response) => {
  const cs = await prisma.cardSet.findUnique({ where: { id: p(req, 'id') } })
  if (!cs || cs.archivedAt || cs.isPersonal) {
    res.status(404).json({ error: 'CardSet not found' }); return
  }
  if (cs.status === CardSetStatus.DEPARTMENTAL) {
    res.status(400).json({ error: 'CardSet is already DEPARTMENTAL' }); return
  }
  const sg = await prisma.subjectGrade.findUnique({ where: { id: req.body.subjectGradeId } })
  if (!sg || sg.archivedAt) {
    res.status(400).json({ error: 'SubjectGrade not found or archived' }); return
  }
  const updated = await prisma.cardSet.update({
    where: { id: cs.id },
    data: {
      status: CardSetStatus.DEPARTMENTAL,
      subjectGradeId: sg.id,
    },
  })
  res.json(updated)
})

// GET /api/admin/cardsets  — list all non-personal CardSets
// ?archived=true returns only archived CardSets, for the "show archived" toggle.
router.get('/cardsets', async (req: Request, res: Response) => {
  const archived = req.query.archived === 'true'
  const cardSets = await prisma.cardSet.findMany({
    where: { archivedAt: archived ? { not: null } : null, isPersonal: false },
    orderBy: { name: 'asc' },
    include: {
      teacher: { include: { user: { select: { id: true, name: true } } } },
      subjectGrade: { select: { id: true, name: true } },
      _count: { select: { cards: true } },
    },
  })
  res.json(cardSets)
})

// GET /api/admin/cardsets/:id
router.get('/cardsets/:id', async (req: Request, res: Response) => {
  const cs = await prisma.cardSet.findUnique({
    where: { id: p(req, 'id') },
    include: {
      cards: { orderBy: { createdAt: 'asc' } },
      teacher: { include: { user: { select: { id: true, name: true } } } },
      subjectGrade: { select: { id: true, name: true } },
    },
  })
  if (!cs || cs.archivedAt || cs.isPersonal) {
    res.status(404).json({ error: 'CardSet not found' }); return
  }
  const labels = await labelsForCardSet(prisma, cs)
  res.json({ ...cs, ...labels })
})

const PatchCardSetSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
})

// PATCH /api/admin/cardsets/:id  — rename/edit description, any non-archived,
// non-personal CardSet (PRIVATE or DEPARTMENTAL) — no ownership check, same
// as every other admin CardSet/card route in this file.
router.patch('/cardsets/:id', validate(PatchCardSetSchema), async (req: Request, res: Response) => {
  const cs = await getAdminEditableCardSet(p(req, 'id'))
  if (!cs) { res.status(404).json({ error: 'CardSet not found' }); return }

  const updated = await prisma.cardSet.update({
    where: { id: cs.id },
    data: req.body,
  })
  res.json(updated)
})

// DELETE /api/admin/cardsets/:id  — archives (soft delete). Existing CardInstances in
// student decks are untouched; the set just drops out of active lists and can no
// longer be newly assigned. Existing class Assignments referencing it are left as-is.
router.delete('/cardsets/:id', async (req: Request, res: Response) => {
  const cs = await prisma.cardSet.findUnique({ where: { id: p(req, 'id') } })
  if (!cs || cs.archivedAt || cs.isPersonal) {
    res.status(404).json({ error: 'CardSet not found' }); return
  }
  const updated = await prisma.cardSet.update({
    where: { id: cs.id },
    data: { archivedAt: new Date() },
  })
  res.json(updated)
})

// POST /api/admin/cardsets/:id/unarchive
router.post('/cardsets/:id/unarchive', async (req: Request, res: Response) => {
  const cs = await prisma.cardSet.findUnique({ where: { id: p(req, 'id') } })
  if (!cs) { res.status(404).json({ error: 'CardSet not found' }); return }
  const updated = await prisma.cardSet.update({
    where: { id: cs.id },
    data: { archivedAt: null },
  })
  res.json(updated)
})

// ─────────────────────────────────────────────
// Cards within a CardSet — admin may edit PRIVATE or DEPARTMENTAL sets
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

async function getAdminEditableCardSet(cardSetId: string) {
  const cs = await prisma.cardSet.findUnique({ where: { id: cardSetId } })
  if (!cs || cs.archivedAt || cs.isPersonal) return null
  return cs
}

// POST /api/admin/cardsets/:id/cards  — single card add
router.post('/cardsets/:id/cards', validate(CreateCardSchema), async (req: Request, res: Response) => {
  const cs = await getAdminEditableCardSet(p(req, 'id'))
  if (!cs) { res.status(404).json({ error: 'CardSet not found' }); return }

  const existing = await prisma.card.findMany({ where: { cardSetId: cs.id }, select: { word: true, pos: true } })
  const newKey = cardDedupeKey(req.body.word, req.body.pos ?? null)
  if (existing.some((c) => cardDedupeKey(c.word, c.pos) === newKey)) {
    res.status(409).json({ error: `"${req.body.word}" already exists in this CardSet${req.body.pos ? ` as ${req.body.pos}` : ''}.` }); return
  }

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
  await syncNewCardsToAssignedDecks(prisma, cs.id, [card.id])
  res.status(201).json(card)
})

// POST /api/admin/cardsets/:id/cards/import  — CSV bulk import
router.post(
  '/cardsets/:id/cards/import',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const cs = await getAdminEditableCardSet(p(req, 'id'))
    if (!cs) { res.status(404).json({ error: 'CardSet not found' }); return }

    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }

    let rows: Record<string, string>[]
    try {
      rows = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Record<string, string>[]
    } catch {
      res.status(400).json({ error: 'Invalid CSV format' }); return
    }

    if (rows.length === 0) {
      res.status(400).json({ error: 'CSV contains no data rows' }); return
    }

    const errors = validateCardRows(rows)
    if (errors.length > 0) {
      res.status(400).json({ error: 'CSV validation failed', validationErrors: errors }); return
    }

    const existingCards = await prisma.card.findMany({ where: { cardSetId: cs.id }, select: { word: true, pos: true } })
    const existingKeys = new Set(existingCards.map((c) => cardDedupeKey(c.word, c.pos)))
    const normalised = rows.map(normaliseCardRow)
    const { toInsert, skipped } = partitionDuplicateRows(normalised, existingKeys)

    let createdCount = 0
    if (toInsert.length > 0) {
      const result = await prisma.card.createMany({ data: toInsert.map((r) => ({ ...r, cardSetId: cs.id })) })
      createdCount = result.count
      const newCards = await prisma.card.findMany({
        where: { cardSetId: cs.id, OR: toInsert.map((r) => ({ word: r.word, pos: r.pos })) },
        select: { id: true },
      })
      await syncNewCardsToAssignedDecks(prisma, cs.id, newCards.map((c) => c.id))
    }

    res.status(201).json({ created: createdCount, skipped })
  },
)

// PATCH /api/admin/cardsets/:csId/cards/:cardId
router.patch('/cardsets/:csId/cards/:cardId', validate(PatchCardSchema), async (req: Request, res: Response) => {
  const cs = await getAdminEditableCardSet(p(req, 'csId'))
  if (!cs) { res.status(404).json({ error: 'CardSet not found' }); return }

  const card = await prisma.card.findUnique({ where: { id: p(req, 'cardId') } })
  if (!card || card.cardSetId !== cs.id) { res.status(404).json({ error: 'Card not found' }); return }

  const mergedL2 = req.body.definitionL2 !== undefined ? req.body.definitionL2 : card.definitionL2
  const mergedL1 = req.body.definitionL1 !== undefined ? req.body.definitionL1 : card.definitionL1
  if (!mergedL2?.trim() && !mergedL1?.trim()) {
    res.status(400).json({ error: 'At least one definition (L1 or L2) is required.' }); return
  }

  const mergedWord = req.body.word ?? card.word
  const mergedPos = req.body.pos !== undefined ? (req.body.pos || null) : card.pos
  const newKey = cardDedupeKey(mergedWord, mergedPos)
  if (newKey !== cardDedupeKey(card.word, card.pos)) {
    const others = await prisma.card.findMany({
      where: { cardSetId: cs.id, id: { not: card.id } },
      select: { word: true, pos: true },
    })
    if (others.some((c) => cardDedupeKey(c.word, c.pos) === newKey)) {
      res.status(409).json({ error: `"${mergedWord}" already exists in this CardSet${mergedPos ? ` as ${mergedPos}` : ''}.` }); return
    }
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

// DELETE /api/admin/cardsets/:csId/cards/:cardId
router.delete('/cardsets/:csId/cards/:cardId', async (req: Request, res: Response) => {
  const cs = await getAdminEditableCardSet(p(req, 'csId'))
  if (!cs) { res.status(404).json({ error: 'CardSet not found' }); return }

  const card = await prisma.card.findUnique({ where: { id: p(req, 'cardId') } })
  if (!card || card.cardSetId !== cs.id) { res.status(404).json({ error: 'Card not found' }); return }

  const instanceCount = await prisma.cardInstance.count({ where: { cardId: card.id } })
  if (instanceCount > 0) {
    res.status(409).json({ error: 'Card is in use in student decks and cannot be deleted' }); return
  }

  await prisma.card.delete({ where: { id: card.id } })
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// SubjectGrade Assignments (admin assigns CardSets to SubjectGrades)
// ─────────────────────────────────────────────

const CreateSGAssignmentSchema = z.object({
  cardSetId: z.string().uuid(),
  type: z.nativeEnum(AssignmentType),
})

// GET /api/admin/subject-grades/:id/assignments
router.get('/subject-grades/:id/assignments', async (req: Request, res: Response) => {
  const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
  if (!sg || sg.archivedAt) { res.status(404).json({ error: 'SubjectGrade not found' }); return }

  const assignments = await prisma.subjectGradeAssignment.findMany({
    where: { subjectGradeId: sg.id },
    include: { cardSet: { select: { id: true, name: true, status: true, _count: { select: { cards: true } } } } },
  })
  res.json(assignments)
})

// POST /api/admin/subject-grades/:id/assignments
router.post(
  '/subject-grades/:id/assignments',
  validate(CreateSGAssignmentSchema),
  async (req: Request, res: Response) => {
    const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
    if (!sg || sg.archivedAt) { res.status(404).json({ error: 'SubjectGrade not found' }); return }

    const cs = await prisma.cardSet.findUnique({ where: { id: req.body.cardSetId } })
    if (!cs || cs.archivedAt || cs.isPersonal) {
      res.status(400).json({ error: 'CardSet not found' }); return
    }

    const existing = await prisma.subjectGradeAssignment.findUnique({
      where: { subjectGradeId_cardSetId: { subjectGradeId: sg.id, cardSetId: cs.id } },
    })
    if (existing) {
      res.status(409).json({ error: 'CardSet already assigned to this SubjectGrade' }); return
    }

    const assignment = await prisma.subjectGradeAssignment.create({
      data: {
        subjectGradeId: sg.id,
        cardSetId: cs.id,
        type: req.body.type,
        assignedBy: req.user!.sub,
      },
    })
    res.status(201).json(assignment)
  },
)

// DELETE /api/admin/subject-grades/:id/assignments/:assignmentId
router.delete('/subject-grades/:id/assignments/:assignmentId', async (req: Request, res: Response) => {
  const assignment = await prisma.subjectGradeAssignment.findUnique({
    where: { id: p(req, 'assignmentId') },
  })
  if (!assignment || assignment.subjectGradeId !== p(req, 'id')) {
    res.status(404).json({ error: 'Assignment not found' }); return
  }
  await prisma.subjectGradeAssignment.delete({ where: { id: assignment.id } })
  res.json({ ok: true })
})

// GET /api/admin/classes/:id/assignments
router.get('/classes/:id/assignments', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

  const assignments = await prisma.assignment.findMany({
    where: { classId: cls.id },
    orderBy: { priority: 'asc' },
    include: { cardSet: { select: { id: true, name: true, status: true, _count: { select: { cards: true } } } } },
  })
  res.json(assignments)
})

// GET /api/admin/classes/:id/homework — the active requirement (if any) plus
// per-student compliance, mirroring the teacher's Homework + Compliance tabs.
router.get('/classes/:id/homework', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

  const hwReq = await prisma.homeworkRequirement.findFirst({
    where: { classId: cls.id, isActive: true },
    include: { cardSets: { include: { cardSet: { select: { id: true, name: true } } } } },
  })
  const compliance = await getClassCompliance(prisma, cls.id)

  res.json({
    requirement: hwReq ? { ...hwReq, cardSets: hwReq.cardSets.map((c) => c.cardSet) } : null,
    compliance,
  })
})

// POST /api/admin/classes/:id/homework — set/replace the active requirement.
// Mirrors teachers.ts's POST .../homework exactly (same schema, same
// deactivate-then-create pattern), minus the teacher-ownership check —
// admin can do this for any class.
const AdminHomeworkSchema = z.object({
  sessionsRequired: z.number().int().min(1),
  cardSetIds: z.array(z.string().uuid()).optional(),
})

router.post('/classes/:id/homework', validate(AdminHomeworkSchema), async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

  const cardSetIds: string[] = req.body.cardSetIds ?? []
  if (cardSetIds.length > 0) {
    const assignedCount = await prisma.assignment.count({
      where: { classId: cls.id, cardSetId: { in: cardSetIds } },
    })
    if (assignedCount !== cardSetIds.length) {
      res.status(400).json({ error: 'One or more CardSets are not assigned to this class' }); return
    }
  }

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

// GET /api/admin/classes/:id/stats — same §14.1-§14.8 stats as the teacher
// class-stats tab (mastery matrix, leaderboards, forecasts, homework
// compliance, etc.), but for ANY class — no ownership check, consistent
// with every other admin class-detail tab (Students/CardSets/Homework).
router.get('/classes/:id/stats', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

  const result = await buildClassStats(prisma, cls, req)
  res.json(result)
})

// GET /api/admin/classes/:id/student-additions — same as the teacher
// per-class report used by ClassStatsPanel's "Additions" tab, any class.
router.get('/classes/:id/student-additions', async (req: Request, res: Response) => {
  const result = await getClassStudentAdditions(p(req, 'id'), req)
  if (!result) { res.status(404).json({ error: 'Class not found' }); return }
  res.json(result)
})

// Admin can also create class-level assignments directly
const AdminCreateClassAssignmentSchema = z.object({
  cardSetId: z.string().uuid(),
  type: z.nativeEnum(AssignmentType),
  priority: z.number().int().min(0).default(0),
})

// In-memory store for admin pending jobs (same pattern as teachers router)
type AdminPendingJob = {
  enrollments: Awaited<ReturnType<typeof createClassAssignment>>['enrollments']
  cardIds: string[]
  className: string
  totalInstances: number
  enrollmentCount: number
  timer: ReturnType<typeof setTimeout>
}
const adminPendingJobs = new Map<string, AdminPendingJob>()

// POST /api/admin/classes/:id/assignments
router.post(
  '/classes/:id/assignments',
  validate(AdminCreateClassAssignmentSchema),
  async (req: Request, res: Response) => {
    const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
    if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

    const cs = await prisma.cardSet.findUnique({ where: { id: req.body.cardSetId } })
    if (!cs || cs.archivedAt || cs.isPersonal) {
      res.status(400).json({ error: 'CardSet not found' }); return
    }

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
      const timer = setTimeout(() => {
        adminPendingJobs.delete(assignment.id)
        rollbackOrphanedAssignment(prisma, assignment.id)
      }, 60_000)
      adminPendingJobs.set(assignment.id, {
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

// GET /api/admin/classes/:id/assignments/:assignmentId/progress  (SSE)
router.get('/classes/:id/assignments/:assignmentId/progress', async (req: Request, res: Response) => {
  const job = adminPendingJobs.get(p(req, 'assignmentId'))
  if (!job) {
    res.status(404).json({ error: 'No pending job found for this assignment' }); return
  }
  clearTimeout(job.timer)
  adminPendingJobs.delete(p(req, 'assignmentId'))
  await streamCardInstanceCreation(prisma, res, job.enrollments, job.cardIds, job.className)
})

// GET /api/admin/classes/:id/assignments/:assignmentId/resume  (SSE)
// Re-streams CardInstance creation for an assignment whose original SSE
// connection dropped mid-way — mirrors teachers.ts's equivalent route.
router.get('/classes/:id/assignments/:assignmentId/resume', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

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

const BatchAssignSchema = z.object({
  cardSetId: z.string().uuid(),
  classIds: z.array(z.string().uuid()).min(1),
  type: z.nativeEnum(AssignmentType),
  priority: z.number().int().min(0).default(0),
})

type BatchAssignJob = {
  cardSetId: string
  targets: BatchAssignClassTarget[]
  timer: ReturnType<typeof setTimeout>
}
const batchAssignJobs = new Map<string, BatchAssignJob>()

// POST /api/admin/subject-grades/:id/batch-assign — assign one CardSet to
// multiple classes within this Subject Grade in one operation. Two-phase,
// same shape as the single-class assign flow: this call only creates the
// Assignment rows and returns a jobId; the client must then open the SSE
// /batch-assign/:jobId/progress stream (below) to actually populate
// CardInstances, exactly like the single-class flow requires opening
// /classes/:id/assignments/:assignmentId/progress. Classes that already have
// this CardSet assigned are skipped (not an error) so the rest of the batch
// still proceeds.
router.post(
  '/subject-grades/:id/batch-assign',
  validate(BatchAssignSchema),
  async (req: Request, res: Response) => {
    const sg = await prisma.subjectGrade.findUnique({ where: { id: p(req, 'id') } })
    if (!sg || sg.archivedAt) { res.status(404).json({ error: 'SubjectGrade not found' }); return }

    const cs = await prisma.cardSet.findUnique({ where: { id: req.body.cardSetId } })
    if (!cs || cs.archivedAt || cs.isPersonal) {
      res.status(400).json({ error: 'CardSet not found' }); return
    }
    // CardSet must belong to this Subject Grade, or be owned by one of the
    // Subject Grade's own teachers — prevents assigning an unrelated
    // department's CardSet to these classes by mistake. The single-class
    // assign route (POST /classes/:id/assignments) has no such check; this
    // batch route adds it deliberately, per the same reasoning as the
    // teacher/Subject-Grade check on the batch class-create route above.
    if (cs.subjectGradeId !== sg.id) {
      if (!cs.teacherId) {
        res.status(400).json({ error: 'CardSet does not belong to this Subject Grade' }); return
      }
      const ownerAssigned = await prisma.teacherSubjectGrade.findUnique({
        where: { teacherId_subjectGradeId: { teacherId: cs.teacherId, subjectGradeId: sg.id } },
      })
      if (!ownerAssigned) {
        res.status(400).json({ error: 'CardSet does not belong to this Subject Grade' }); return
      }
    }

    const classIds: string[] = req.body.classIds
    const classes = await prisma.class.findMany({ where: { id: { in: classIds } } })
    const invalid = classIds.filter((id) => {
      const cls = classes.find((c) => c.id === id)
      return !cls || cls.archivedAt || cls.subjectGradeId !== sg.id
    })
    if (invalid.length > 0) {
      res.status(400).json({ error: 'One or more classes are invalid, archived, or not in this Subject Grade' })
      return
    }

    const existingAssignments = await prisma.assignment.findMany({
      where: { cardSetId: cs.id, classId: { in: classIds } },
      select: { classId: true },
    })
    const alreadyAssigned = new Set(existingAssignments.map((a) => a.classId))

    const targets: BatchAssignClassTarget[] = []
    const skipped: { classId: string; className: string }[] = []

    for (const cls of classes) {
      if (alreadyAssigned.has(cls.id)) {
        skipped.push({ classId: cls.id, className: cls.name })
        continue
      }
      const { assignment, enrollments, cardIds } = await createClassAssignment(
        prisma, cls.id, cs.id, req.body.type, req.body.priority, req.user!.sub,
      )
      if (req.body.type === AssignmentType.MANDATORY && cardIds.length > 0 && enrollments.length > 0) {
        targets.push({ classId: cls.id, className: cls.name, assignmentId: assignment.id, enrollments, cardIds })
      }
    }

    if (targets.length === 0) {
      res.status(201).json({
        jobId: null,
        needsStream: false,
        skipped,
        classes: [],
      })
      return
    }

    const jobId = targets.map((t) => t.assignmentId).join(',')
    const timer = setTimeout(() => {
      batchAssignJobs.delete(jobId)
      for (const t of targets) rollbackOrphanedAssignment(prisma, t.assignmentId)
    }, 60_000)
    batchAssignJobs.set(jobId, { cardSetId: cs.id, targets, timer })

    res.status(201).json({
      jobId,
      needsStream: true,
      skipped,
      classes: targets.map((t) => ({
        classId: t.classId,
        className: t.className,
        enrollmentCount: t.enrollments.length,
        totalInstances: t.enrollments.filter((e) => e.deck).length * t.cardIds.length,
      })),
    })
  },
)

// GET /api/admin/subject-grades/batch-assign/:jobId/progress  (SSE)
router.get('/subject-grades/batch-assign/:jobId/progress', async (req: Request, res: Response) => {
  const job = batchAssignJobs.get(p(req, 'jobId'))
  if (!job) {
    res.status(404).json({ error: 'No pending job found for this batch' }); return
  }
  clearTimeout(job.timer)
  batchAssignJobs.delete(p(req, 'jobId'))
  await streamCardInstanceCreationForClasses(prisma, res, job.targets, job.cardSetId)
})

// DELETE /api/admin/classes/:id/assignments/:assignmentId
// By default also removes the words this assignment put into student decks.
// Pass ?keepCards=true to unassign without touching existing decks.
router.delete('/classes/:id/assignments/:assignmentId', async (req: Request, res: Response) => {
  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }

  const assignment = await prisma.assignment.findUnique({ where: { id: p(req, 'assignmentId') } })
  if (!assignment || assignment.classId !== cls.id) {
    res.status(404).json({ error: 'Assignment not found' }); return
  }
  const keepCards = req.query.keepCards === 'true'
  const result = await removeAssignment(prisma, assignment.id, keepCards)
  res.json({ ok: true, cardsRemoved: result.cardsRemoved })
})

// ─────────────────────────────────────────────
// Student-added cards report — school-wide
// ─────────────────────────────────────────────

// GET /api/admin/student-additions
// Query params:
//   start, end — ISO date strings. Both optional; default to the most
//   recent fully-completed Monday-Sunday week.
//   classId — optional; scope to one class. Omitted = every non-archived class.
router.get('/student-additions', async (req: Request, res: Response) => {
  const classId = req.query.classId as string | undefined
  let classIds: string[]
  if (classId) {
    const cls = await prisma.class.findUnique({ where: { id: classId } })
    if (!cls || cls.archivedAt) { res.status(404).json({ error: 'Class not found' }); return }
    classIds = [cls.id]
  } else {
    classIds = (
      await prisma.class.findMany({ where: { archivedAt: null }, select: { id: true } })
    ).map((c) => c.id)
  }

  const now = new Date()
  const startParam = req.query.start as string | undefined
  const endParam = req.query.end as string | undefined
  let start: Date
  let end: Date
  if (startParam && endParam) {
    start = new Date(startParam)
    end = new Date(endParam)
  } else {
    const bounds = getLastCompletedWeekBounds(now)
    start = bounds.periodStart
    end = bounds.periodEnd
  }

  const additions = await getStudentAdditions(prisma, classIds, start, end)
  res.json({ additions, rangeStart: start, rangeEnd: end })
})

// ─────────────────────────────────────────────
// Class rollup — one row per class, for the Stats page overview table
// ─────────────────────────────────────────────

interface ClassRollupRow {
  classId: string
  className: string
  subjectGradeId: string
  subjectGradeName: string
  enrolledCount: number
  homeworkCompletionPct: number | null
  studentAddedCount: number
  accuracyRate: number | null
  reviewsThisWeek: number
}

// GET /api/admin/class-rollup — one row per non-archived class, grouped by
// Subject Grade client-side. Powers the Stats page's overview table.
router.get('/class-rollup', async (req: Request, res: Response) => {
  const now = new Date()
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    include: {
      subjectGrade: { select: { id: true, name: true } },
      _count: { select: { enrollments: true } },
    },
  })

  // Default date range for the student-added-cards count — matches the
  // Student Additions table's own default so the two sections of the page
  // agree without the admin having to think about it.
  const additionsStartParam = req.query.start as string | undefined
  const additionsEndParam = req.query.end as string | undefined
  let additionsStart: Date
  let additionsEnd: Date
  if (additionsStartParam && additionsEndParam) {
    additionsStart = new Date(additionsStartParam)
    additionsEnd = new Date(additionsEndParam)
  } else {
    const bounds = getLastCompletedWeekBounds(now)
    additionsStart = bounds.periodStart
    additionsEnd = bounds.periodEnd
  }

  const { periodStart: weekStart, periodEnd: weekEnd } = getCalendarWeekBounds(now)
  const accuracySince = new Date(now)
  accuracySince.setDate(accuracySince.getDate() - 30)

  const rows: ClassRollupRow[] = await Promise.all(
    classes.map(async (cls) => {
      const [compliance, reviewsThisWeek, accuracySessions, studentAdditionCount] = await Promise.all([
        getClassCompliance(prisma, cls.id, now),
        prisma.reviewSession.count({
          where: { endedAt: { gte: weekStart, lt: weekEnd }, deck: { enrollment: { classId: cls.id } } },
        }),
        prisma.reviewSession.findMany({
          where: { endedAt: { gte: accuracySince }, accuracyRate: { not: null }, deck: { enrollment: { classId: cls.id } } },
          select: { accuracyRate: true },
        }),
        prisma.cardInstance.count({
          where: {
            origin: 'STUDENT_ADDED',
            createdAt: { gte: additionsStart, lt: additionsEnd },
            deck: { enrollment: { classId: cls.id } },
          },
        }),
      ])

      const homeworkCompletionPct = compliance
        ? (compliance.students.filter((s) => s.status === 'MET').length / Math.max(1, compliance.students.length)) * 100
        : null

      const accuracyRate = accuracySessions.length > 0
        ? accuracySessions.reduce((sum, s) => sum + (s.accuracyRate ?? 0), 0) / accuracySessions.length
        : null

      return {
        classId: cls.id,
        className: cls.name,
        subjectGradeId: cls.subjectGrade.id,
        subjectGradeName: cls.subjectGrade.name,
        enrolledCount: cls._count.enrollments,
        homeworkCompletionPct,
        studentAddedCount: studentAdditionCount,
        accuracyRate,
        reviewsThisWeek,
      }
    })
  )

  res.json({ rows, additionsRangeStart: additionsStart, additionsRangeEnd: additionsEnd })
})

export default router
