/**
 * Teacher-side student-added-cards report for a single class.
 *
 * Mounted at /api/teachers/classes/:id/student-additions (registered in
 * teachers.ts). Separate from stats.teacher.ts's combined stats payload
 * (and its "Student Additions" tab, which this route replaces) because
 * this needs its own date-range query params, independent of that page's
 * shared `days` lookback selector.
 *
 * Route:
 *   GET /classes/:id/student-additions
 *   Query params:
 *     start, end — ISO date strings. Both optional; default to the most
 *     recent fully-completed Monday-Sunday week.
 */

import { Request, Response } from 'express'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { getStudentAdditions } from '../services/studentAdditions.service'
import { getLastCompletedWeekBounds } from '../services/homework.service'

const router = asyncRouter({ mergeParams: true })
const p = (req: Request, key: string) => req.params[key] as string

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } })
}

function resolveRange(req: Request): { start: Date; end: Date } {
  const now = new Date()
  const startParam = req.query.start as string | undefined
  const endParam = req.query.end as string | undefined
  if (startParam && endParam) {
    return { start: new Date(startParam), end: new Date(endParam) }
  }
  const { periodStart, periodEnd } = getLastCompletedWeekBounds(now)
  return { start: periodStart, end: periodEnd }
}

router.get('/', async (req: Request, res: Response) => {
  const teacher = await getTeacher(req.user!.sub)
  if (!teacher) { res.status(403).json({ error: 'No teacher profile found' }); return }

  const cls = await prisma.class.findUnique({ where: { id: p(req, 'id') } })
  if (!cls || cls.archivedAt || cls.teacherId !== teacher.id) {
    res.status(404).json({ error: 'Class not found' }); return
  }

  const { start, end } = resolveRange(req)
  const additions = await getStudentAdditions(prisma, [cls.id], start, end)
  res.json({ additions, rangeStart: start, rangeEnd: end })
})

export default router
