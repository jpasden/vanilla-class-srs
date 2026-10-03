import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { Server } from 'http'

const prisma = vi.hoisted(() => ({
  teacher: { findUnique: vi.fn() },
  class: { findUnique: vi.fn() },
  cardSet: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  teacherSubjectGrade: { findMany: vi.fn() },
  assignment: { findUnique: vi.fn(), create: vi.fn() },
}))
vi.mock('../lib/prisma', () => ({ default: prisma }))
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { sub: 'user1', role: 'TEACHER' }; next()
  },
  requireTeacher: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requirePasswordChanged: (_req: Request, _res: Response, next: NextFunction) => next(),
}))

const cls = { id: 'c1', teacherId: 't1', subjectGradeId: 'sg1', archivedAt: null }
const cardsets = [
  { id: '11111111-1111-4111-8111-111111111111', status: 'PRIVATE', teacherId: 't1', subjectGradeId: null, archivedAt: null, isPersonal: false },
  { id: '22222222-2222-4222-8222-222222222222', status: 'DEPARTMENTAL', teacherId: 'colleague', subjectGradeId: 'sg1', archivedAt: null, isPersonal: false },
  { id: 'other-sg', status: 'DEPARTMENTAL', teacherId: 't1', subjectGradeId: 'sg2', archivedAt: null, isPersonal: false },
  { id: 'colleague-private', status: 'PRIVATE', teacherId: 'colleague', subjectGradeId: null, archivedAt: null, isPersonal: false },
  { id: 'archived', status: 'DEPARTMENTAL', teacherId: null, subjectGradeId: 'sg1', archivedAt: new Date(), isPersonal: false },
  { id: 'personal', status: 'PRIVATE', teacherId: 't1', subjectGradeId: null, archivedAt: null, isPersonal: true },
  { id: 'already-assigned', status: 'DEPARTMENTAL', teacherId: null, subjectGradeId: 'sg1', archivedAt: null, isPersonal: false },
]

// Evaluate the actual Prisma query against a mixed library fixture. This
// verifies that returned choices obey the policy, including a creator who
// teaches in multiple subject/grades.
function matches(set: typeof cardsets[number], where: any): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as any[]).some((branch) => matches(set, branch))
    if (key === 'assignments') return set.id !== 'already-assigned'
    return set[key as keyof typeof set] === value
  })
}

let server: Server
let base: string
beforeAll(async () => {
  const [{ default: cardsetsRouter }, { default: teachersRouter }, { default: adminRouter }] = await Promise.all([
    import('../routes/cardsets'), import('../routes/teachers'), import('../routes/admin'),
  ])
  const app = express()
  app.use(express.json())
  app.use('/teachers/cardsets', cardsetsRouter)
  app.use('/teachers', teachersRouter)
  app.use('/admin', adminRouter)
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterAll(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())) })
beforeEach(() => {
  vi.resetAllMocks()
  prisma.teacher.findUnique.mockResolvedValue({ id: 't1' })
  prisma.class.findUnique.mockResolvedValue(cls)
  prisma.cardSet.findMany.mockImplementation(({ where }) => Promise.resolve(cardsets.filter((cs) => matches(cs, where))))
  prisma.cardSet.findUnique.mockImplementation(({ where }) => Promise.resolve(cardsets.find((cs) => cs.id === where.id)))
  prisma.cardSet.findFirst.mockImplementation(({ where }) => Promise.resolve(cardsets.find((cs) => matches(cs, where))))
})

describe('class cardset picker scope', () => {
  it.each(['teachers', 'admin'])('scopes the %s picker to this class and keeps a colleague-created departmental set', async (role) => {
    const res = await fetch(`${base}/${role}/cardsets?classId=c1`)
    expect(res.status).toBe(200)
    const choices = await res.json() as { id: string }[]
    expect(choices.map((cs) => cs.id)).toEqual(cardsets.slice(0, 2).map((cs) => cs.id))
    expect(prisma.teacherSubjectGrade.findMany).not.toHaveBeenCalled()
    expect(prisma.cardSet.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignments: { none: { classId: 'c1' } } }),
    }))
  })

  it('does not expose choices for another teacher’s class', async () => {
    prisma.class.findUnique.mockResolvedValue({ ...cls, teacherId: 'colleague' })
    const res = await fetch(`${base}/teachers/cardsets?classId=c1`)
    expect(res.status).toBe(404)
    expect(prisma.cardSet.findMany).not.toHaveBeenCalled()
  })

  it.each(['teachers', 'admin'])('rejects an archived class in the %s picker', async (role) => {
    prisma.class.findUnique.mockResolvedValue({ ...cls, archivedAt: new Date() })
    expect((await fetch(`${base}/${role}/cardsets?classId=c1`)).status).toBe(404)
    expect(prisma.cardSet.findMany).not.toHaveBeenCalled()
  })

  it('preserves the general teacher library across all their memberships', async () => {
    prisma.teacherSubjectGrade.findMany.mockResolvedValue([{ subjectGradeId: 'sg1' }, { subjectGradeId: 'sg2' }])
    // General library uses an "in" predicate rather than the class-specific equality.
    prisma.cardSet.findMany.mockResolvedValue([])
    expect((await fetch(`${base}/teachers/cardsets`)).status).toBe(200)
    expect(prisma.cardSet.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [
        { teacherId: 't1', status: 'PRIVATE' },
        { subjectGradeId: { in: ['sg1', 'sg2'] }, status: 'DEPARTMENTAL' },
      ] }),
    }))
  })
})

describe('teacher assignment scope', () => {
  it('permits a departmental set created by another teacher in the class subject/grade', async () => {
    const cs = cardsets[1]
    prisma.assignment.findUnique.mockResolvedValue(null)
    prisma.assignment.create.mockResolvedValue({ id: 'a1', cardSet: { name: 'Shared vocabulary' } })
    const res = await fetch(`${base}/teachers/classes/c1/assignments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardSetId: cs.id, type: 'OPTIONAL', priority: 0 }),
    })
    expect(res.status).toBe(201)
    expect(prisma.assignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { classId: 'c1', cardSetId: cs.id, type: 'OPTIONAL', priority: 0, assignedBy: 'user1' },
    }))
  })

  it('rejects a departmental set from another subject/grade even when its creator owns the class', async () => {
    prisma.cardSet.findUnique.mockResolvedValue(cardsets[2])
    const res = await fetch(`${base}/teachers/classes/c1/assignments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardSetId: cardsets[0].id, type: 'OPTIONAL', priority: 0 }),
    })
    expect(res.status).toBe(403)
    expect(prisma.assignment.create).not.toHaveBeenCalled()
  })
})
