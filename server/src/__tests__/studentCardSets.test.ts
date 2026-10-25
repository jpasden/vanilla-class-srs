import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { Server } from 'http'

const prisma = vi.hoisted(() => ({
  student: { findUnique: vi.fn() }, enrollment: { findUnique: vi.fn() },
  class: { findUnique: vi.fn() }, assignment: { findMany: vi.fn(), findFirst: vi.fn() },
  cardInstance: { findMany: vi.fn() }, card: { findMany: vi.fn() },
}))
vi.mock('../lib/prisma', () => ({ default: prisma }))
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { sub: 'user', role: 'STUDENT' }; next() },
  requireStudent: (_req: any, _res: any, next: any) => next(),
  requirePasswordChanged: (_req: any, _res: any, next: any) => next(),
}))
vi.mock('../services/departmentLabels.service', () => ({ labelsForClass: async () => ({ definitionL2Label: 'English', definitionL1Label: 'Chinese' }) }))
const sets = [
  { id: 'required', type: 'MANDATORY', classId: 'class', archivedAt: null, isPersonal: false },
  { id: 'optional', type: 'OPTIONAL', classId: 'class', archivedAt: null, isPersonal: false },
  { id: 'other-class', type: 'MANDATORY', classId: 'other', archivedAt: null, isPersonal: false },
  { id: 'archived', type: 'MANDATORY', classId: 'class', archivedAt: new Date(), isPersonal: false },
  { id: 'personal', type: 'MANDATORY', classId: 'class', archivedAt: null, isPersonal: true },
]
function matches(set: typeof sets[number], where: any) {
  return set.classId === where.classId && (!where.cardSetId || set.id === where.cardSetId)
    && (!where.type || set.type === where.type)
    && set.archivedAt === where.cardSet.archivedAt && set.isPersonal === where.cardSet.isPersonal
}
let server: Server, base: string
beforeAll(async () => {
  const { default: router } = await import('../routes/students')
  const app = express(); app.use(express.json()); app.use(router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())) })
beforeEach(() => {
  vi.resetAllMocks()
  prisma.student.findUnique.mockResolvedValue({ id: 'student' })
  prisma.enrollment.findUnique.mockResolvedValue({ studentId: 'student', classId: 'class', archivedAt: null, deck: { id: 'deck' } })
  prisma.class.findUnique.mockResolvedValue({ archivedAt: null })
  prisma.assignment.findMany.mockImplementation(async ({ where }) => sets.filter(s => matches(s, where)).map(s => ({
    cardSetId: s.id, type: s.type, cardSet: { id: s.id, name: s.id, description: null, _count: { cards: 1 } },
  })))
  prisma.assignment.findFirst.mockImplementation(async ({ where }) => sets.find(s => matches(s, where)) ?? null)
  prisma.cardInstance.findMany.mockResolvedValue([{ card: { cardSetId: 'optional' } }])
  prisma.card.findMany.mockResolvedValue([{ id: 'card', word: 'example' }])
})
describe('student class CardSets', () => {
  it('lists only active class assignments with type, counts and opt-in status', async () => {
    const res = await fetch(`${base}/deck/cardsets?enrollmentId=enrollment`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'required', name: 'required', description: null, type: 'MANDATORY', _count: { cards: 1 }, added: true },
      { id: 'optional', name: 'optional', description: null, type: 'OPTIONAL', _count: { cards: 1 }, added: true },
    ])
    expect(prisma.cardInstance.findMany.mock.calls[0][0].where.deckId).toBe('deck')
  })
  it.each(['required', 'optional'])('lets students view %s cards without opting in', async id => {
    prisma.cardInstance.findMany.mockResolvedValue([])
    const res = await fetch(`${base}/deck/cardsets/${id}/cards?enrollmentId=enrollment`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ cards: [{ word: 'example' }], definitionL2Label: 'English' })
  })
  it.each(['other-class', 'archived', 'personal', 'unassigned'])('denies browsing %s', async id => {
    expect((await fetch(`${base}/deck/cardsets/${id}/cards?enrollmentId=enrollment`)).status).toBe(404)
    expect(prisma.card.findMany).not.toHaveBeenCalled()
  })
  it.each(['', '/required/cards'])('rejects another student’s enrollment for %s', async suffix => {
    prisma.enrollment.findUnique.mockResolvedValue({ studentId: 'someone-else' })
    expect((await fetch(`${base}/deck/cardsets${suffix}?enrollmentId=foreign`)).status).toBe(404)
    expect(prisma.assignment.findMany).not.toHaveBeenCalled()
    expect(prisma.assignment.findFirst).not.toHaveBeenCalled()
  })
  it('rejects archived classes', async () => {
    prisma.class.findUnique.mockResolvedValue({ archivedAt: new Date() })
    expect((await fetch(`${base}/deck/cardsets?enrollmentId=enrollment`)).status).toBe(404)
  })
  it('keeps legacy optional browsing restricted to optional assignments', async () => {
    const res = await fetch(`${base}/deck/optional?enrollmentId=enrollment`)
    expect((await res.json() as { id: string }[]).map(s => s.id)).toEqual(['optional'])
    expect((await fetch(`${base}/deck/optional/required/cards?enrollmentId=enrollment`)).status).toBe(404)
  })
})
