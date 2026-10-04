import { Request } from 'express'
import { Role } from '@prisma/client'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher, requirePasswordChanged } from '../middleware/auth'
import { ledSubjectGrades } from '../services/classAccess.service'
import {
  subjectGradeStats,
  subjectGradeCardStats,
  subjectGradeMatrix,
} from '../services/subjectGradeStats.service'
import { getStudentAdditions } from '../services/studentAdditions.service'
import { reportRange, midnight } from '../services/reportRange.service'

const router = asyncRouter()
router.use(requireAuth, requireTeacher, requirePasswordChanged)
const positive = (value: unknown, fallback: number, max: number) =>
  Math.min(max, Math.max(1, parseInt(String(value)) || fallback))
router.get('/', async (req, res) => {
  res.json(
    req.user!.role === Role.ADMIN && req.baseUrl.startsWith('/api/admin/')
      ? await prisma.subjectGrade.findMany({
          where: { archivedAt: null, department: { archivedAt: null } },
          select: { id: true, name: true, department: { select: { name: true } } },
          orderBy: { name: 'asc' },
        })
      : await ledSubjectGrades(prisma, req.user!.sub),
  )
})
async function groupFor(req: Request) {
  const group = await prisma.subjectGrade.findFirst({
    where: {
      id: String(req.params.id),
      archivedAt: null,
      department: { archivedAt: null },
      ...(req.user!.role === Role.ADMIN
        ? {}
        : { lead: { membership: { teacher: { userId: req.user!.sub } } } }),
    },
    include: {
      department: { select: { name: true } },
      teachers: { include: { teacher: { include: { user: { select: { name: true, email: true } } } } } },
      lead: true,
      classes: {
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          teacherId: true,
          _count: { select: { enrollments: { where: { archivedAt: null } } } },
        },
      },
    },
  })
  return group
}
router.get('/:id', async (req, res) => {
  const group = await groupFor(req)
  if (!group) {
    res.status(404).json({ error: 'Subject/Grade not available' })
    return
  }
  res.json(group)
})
router.get('/:id/:report', async (req, res) => {
  const group = await groupFor(req)
  if (!group) {
    res.status(404).json({ error: 'Subject/Grade not available' })
    return
  }
  const days = positive(req.query.days, 30, 365)
  const tz = String(req.query.tz || 'Asia/Shanghai')
  let range
  try {
    range = reportRange(days, tz)
  } catch {
    res.status(400).json({ error: 'Invalid timezone' })
    return
  }
  switch (req.params.report) {
    case 'stats':
      res.json(await subjectGradeStats(prisma, group.id, days, tz))
      break
    case 'students': {
      const page = positive(req.query.page, 1, 100000)
      const report = await subjectGradeStats(prisma, group.id, days, tz, new Date(), page)
      res.json({ rows: report.students, total: report.studentTotal, page, pageSize: 50 })
      break
    }
    case 'cards':
      res.json(await subjectGradeCardStats(prisma, group.id, positive(req.query.page, 1, 100000), days, tz))
      break
    case 'matrix':
      res.json(
        await subjectGradeMatrix(
          prisma,
          group.id,
          positive(req.query.page, 1, 100000),
          positive(req.query.cardPage, 1, 100000),
        ),
      )
      break
    case 'student-additions': {
      const parseDate = (value: unknown, fallback: Date) => {
        if (!value) return fallback
        const text = String(value)
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? midnight(text, tz) : new Date(text)
      }
      let start: Date, end: Date
      try {
        start = parseDate(req.query.start, range.start)
        end = parseDate(req.query.end, range.end)
      } catch {
        res.status(400).json({ error: 'Invalid date range' })
        return
      }
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
        res.status(400).json({ error: 'Invalid date range' })
        return
      }
      res.json({
        additions: await getStudentAdditions(
          prisma,
          group.classes.map((c) => c.id),
          start,
          end,
        ),
        rangeStart: start,
        rangeEnd: end,
      })
      break
    }
    default:
      res.status(404).json({ error: 'Report not found' })
  }
})
export default router
