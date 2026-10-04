import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import type { Server } from 'http'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import fs from 'fs'

// Opt-in only: this suite creates synthetic school data in a disposable DB.
const dbUrl = process.env.SL_TEST_DATABASE_URL
const testUrl = dbUrl ? new URL(dbUrl) : null
if (testUrl && (testUrl.hostname !== '127.0.0.1' || testUrl.pathname !== '/sl_fresh'))
  throw new Error('SL integration tests require the disposable localhost sl_fresh database')

describe.runIf(!!dbUrl)('SL workflows with PostgreSQL and authenticated routes', () => {
  let db: PrismaClient, server: Server, base: string
  const ids = Object.fromEntries(
    [
      'admin',
      'leadUser',
      'ownerUser',
      'outsiderUser',
      'studentUser',
      'removedUser',
      'dept',
      'sg',
      'otherSg',
      'lead',
      'owner',
      'outsider',
      'student',
      'removed',
      'a',
      'b',
      'own',
      'foreign',
      'archived',
      'ea',
      'eb',
      'er',
      'da',
      'db',
      'dr',
      'set',
      'card',
    ].map((k) => [k, randomUUID()]),
  )
  let leadCookie: string, adminCookie: string, ownerCookie: string, studentCookie: string
  beforeAll(async () => {
    process.env.DATABASE_URL = dbUrl!
    process.env.JWT_SECRET = 'sl-disposable-test-secret'
    process.env.JWT_REFRESH_SECRET = 'sl-disposable-test-refresh'
    process.env.AUDIT_LOG_DIR = '/tmp/vanilla-sl-audit'
    const [
      { default: prisma },
      { default: teachers },
      { default: admin },
      { default: leadership },
      { default: auth },
      { signAccessToken, hashPassword },
    ] = await Promise.all([
      import('../lib/prisma'),
      import('../routes/teachers'),
      import('../routes/admin'),
      import('../routes/leadership'),
      import('../routes/auth'),
      import('../services/auth.service'),
    ])
    db = prisma
    const hash = await hashPassword('SL-test-only-2026!')
    for (const [key, name, role] of [
      ['admin', 'Admin', 'ADMIN'],
      ['leadUser', 'Subject Lead', 'TEACHER'],
      ['ownerUser', 'Class Teacher', 'TEACHER'],
      ['outsiderUser', 'Unrelated Teacher', 'TEACHER'],
      ['studentUser', 'Shared Student', 'STUDENT'],
      ['removedUser', 'Removed Student', 'STUDENT'],
    ] as const) {
      await db.user.create({
        data: { id: ids[key], email: `${key}-${ids[key]}@sl-test.invalid`, name, role, passwordHash: hash },
      })
    }
    await db.department.create({
      data: { id: ids.dept, name: 'SL Test Department', definitionL1Label: 'Translation' },
    })
    for (const key of ['sg', 'otherSg'])
      await db.subjectGrade.create({
        data: {
          id: ids[key],
          name: key === 'sg' ? 'English Grade 12' : 'English Grade 11',
          departmentId: ids.dept,
        },
      })
    for (const [key, user] of [
      ['lead', 'leadUser'],
      ['owner', 'ownerUser'],
      ['outsider', 'outsiderUser'],
    ])
      await db.teacher.create({ data: { id: ids[key], userId: ids[user] } })
    await db.teacherSubjectGrade.createMany({
      data: [
        { teacherId: ids.lead, subjectGradeId: ids.sg },
        { teacherId: ids.lead, subjectGradeId: ids.otherSg },
        { teacherId: ids.owner, subjectGradeId: ids.sg },
        { teacherId: ids.owner, subjectGradeId: ids.otherSg },
      ],
    })
    await db.subjectGradeLead.create({ data: { subjectGradeId: ids.sg, teacherId: ids.lead } })
    for (const [key, teacher, group] of [
      ['a', 'owner', 'sg'],
      ['b', 'owner', 'sg'],
      ['own', 'lead', 'otherSg'],
      ['foreign', 'owner', 'otherSg'],
      ['archived', 'owner', 'sg'],
    ])
      await db.class.create({
        data: {
          id: ids[key],
          name: `Class ${key}`,
          teacherId: ids[teacher],
          subjectGradeId: ids[group],
          ...(key === 'archived' ? { archivedAt: new Date() } : {}),
        },
      })
    await db.student.createMany({
      data: [
        { id: ids.student, userId: ids.studentUser },
        { id: ids.removed, userId: ids.removedUser },
      ],
    })
    for (const [key, student, cls] of [
      ['ea', 'student', 'a'],
      ['eb', 'student', 'b'],
      ['er', 'removed', 'a'],
    ])
      await db.enrollment.create({
        data: {
          id: ids[key],
          studentId: ids[student],
          classId: ids[cls],
          ...(key === 'er' ? { archivedAt: new Date() } : {}),
        },
      })
    for (const [key, enrollment] of [
      ['da', 'ea'],
      ['db', 'eb'],
      ['dr', 'er'],
    ])
      await db.deck.create({ data: { id: ids[key], enrollmentId: ids[enrollment] } })
    await db.cardSet.create({
      data: { id: ids.set, name: 'Teacher Private Assigned Set', teacherId: ids.owner },
    })
    await db.card.create({
      data: {
        id: ids.card,
        cardSetId: ids.set,
        word: 'example',
        definitionL1: 'Original',
        definitionL2: 'An example',
        exampleSentence: 'Teacher example',
      },
    })
    const instances: { id: string; deckId: string }[] = []
    for (const deck of ['da', 'db', 'dr'])
      instances.push(
        await db.cardInstance.create({
          data: {
            deckId: ids[deck],
            cardId: ids.card,
            origin: 'OPTIONAL',
            state: 'REVIEW',
            definitionL1: deck === 'da' ? 'Student translation' : null,
            exampleSentence: deck === 'da' ? 'Student example' : null,
          },
        }),
      )
    for (const [index, total, correct] of [
      [0, 100, 90],
      [1, 10, 1],
      [2, 20, 20],
    ]) {
      const session = await db.reviewSession.create({
        data: {
          deckId: instances[index].deckId,
          startedAt: new Date(),
          endedAt: new Date(),
          cardsReviewed: total,
        },
      })
      await db.reviewEvent.createMany({
        data: Array.from({ length: total }, (_, i) => ({
          sessionId: session.id,
          cardInstanceId: instances[index].id,
          grade: i < correct ? 3 : 1,
        })),
      })
    }
    await db.assignment.create({
      data: { classId: ids.a, cardSetId: ids.set, type: 'OPTIONAL', assignedBy: ids.ownerUser },
    })
    await db.homeworkRequirement.create({
      data: { classId: ids.a, sessionsRequired: 1, minCardsPerSession: 1, activeFrom: new Date() },
    })
    const app = express()
    app.use(express.json(), cookieParser())
    const { default: cardsets } = await import('../routes/cardsets')
    app.use('/api/teachers/cardsets', cardsets)
    app.use('/api/auth', auth)
    app.use('/api/teachers/leadership', leadership)
    app.use('/api/teachers', teachers)
    app.use('/api/admin', admin)
    // Match production's separate Admin-only mount for shared leadership routes.
    const { requireAuth, requireAdmin, requirePasswordChanged } = await import('../middleware/auth')
    app.use('/api/admin/leadership', requireAuth, requireAdmin, requirePasswordChanged, leadership)
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(error)
      res.status(500).json({ error: 'Internal server error' })
    })
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
    const cookie = (sub: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT') =>
      `access_token=${signAccessToken({ sub, role })}`
    leadCookie = cookie(ids.leadUser, 'TEACHER')
    adminCookie = cookie(ids.admin, 'ADMIN')
    ownerCookie = cookie(ids.ownerUser, 'TEACHER')
    studentCookie = cookie(ids.studentUser, 'STUDENT')
    if (process.env.SL_FIXTURE_FILE)
      fs.writeFileSync(
        process.env.SL_FIXTURE_FILE,
        JSON.stringify({
          ids,
          emails: {
            admin: `admin-${ids.admin}@sl-test.invalid`,
            lead: `leadUser-${ids.leadUser}@sl-test.invalid`,
            owner: `ownerUser-${ids.ownerUser}@sl-test.invalid`,
          },
        }),
      )
  }, 30000)
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (db) await db.$disconnect()
  })
  const request = (path: string, cookie = leadCookie, method = 'GET', body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  it('allows the SL to browse colleague classes, all student stats, personal cards and the full deck', async () => {
    for (const suffix of [
      '',
      '/students',
      '/assignments',
      '/homework',
      '/stats',
      `/students/${ids.student}/cards`,
      ...['summary', 'daily', 'accuracy', 'sessions', 'forecast', 'growth'].map(
        (r) => `/students/${ids.student}/stats/${r}`,
      ),
    ]) {
      expect((await request(`/teachers/classes/${ids.a}${suffix}`)).status, suffix).toBe(200)
    }
    const response = await request(`/teachers/classes/${ids.a}/students/${ids.student}/deck`)
    expect(response.status).toBe(200)
    const data = (await response.json()) as any
    expect(data.cards[0]).toMatchObject({
      definitionL1: 'Student translation',
      exampleSentence: 'Student example',
      state: 'REVIEW',
    })
    expect(data.definitionL1Label).toBe('Translation')
  })
  it('denies access outside led groups and rejects students, removed enrollments and tampered filters', async () => {
    expect((await request(`/teachers/classes/${ids.foreign}`)).status).toBe(404)
    expect((await request(`/teachers/classes/${ids.own}`)).status).toBe(200)
    expect((await request(`/teachers/leadership/${ids.otherSg}/stats`)).status).toBe(404)
    expect((await request(`/admin/leadership/${ids.sg}/stats`)).status).toBe(403)
    expect((await request(`/teachers/classes/${ids.a}`, studentCookie)).status).toBe(403)
    expect((await request(`/teachers/classes/${ids.a}/students/${ids.removed}/deck`)).status).toBe(404)
    expect((await request(`/teachers/classes/${ids.a}/students/${ids.removed}/stats/summary`)).status).toBe(
      404,
    )
    expect((await request(`/teachers/classes/${ids.a}/students/${ids.student}/deck?state=BAD`)).status).toBe(
      400,
    )
    expect((await request(`/teachers/leadership/${ids.sg}/stats?tz=Invalid/Zone`)).status).toBe(400)
    expect((await request(`/teachers/cardsets/${ids.set}`)).status).toBe(404)
  })
  it('does not grant management through write or assignment streaming routes', async () => {
    const writes: [string, string, unknown][] = [
      ['PATCH', '', { name: 'Forbidden' }],
      ['DELETE', '', undefined],
      ['POST', '/students', { name: 'New Student', email: 'new@sl-test.invalid' }],
      ['POST', '/homework', { sessionsRequired: 2 }],
      ['DELETE', `/students/${ids.student}`, undefined],
      ['POST', `/students/${ids.student}/reset-password`, {}],
      ['POST', '/reset-passwords', {}],
      ['POST', '/assignments', { cardSetId: ids.set, type: 'OPTIONAL' }],
    ]
    for (const [method, suffix, body] of writes)
      expect(
        (await request(`/teachers/classes/${ids.a}${suffix}`, leadCookie, method, body)).status,
        `${method} ${suffix}`,
      ).toBe(404)
    for (const action of ['progress', 'resume'])
      expect((await request(`/teachers/classes/${ids.a}/assignments/${randomUUID()}/${action}`)).status).toBe(
        404,
      )
    expect(
      (await request(`/teachers/classes/${ids.a}`, ownerCookie, 'PATCH', { name: 'Class a' })).status,
    ).toBe(200)
  })
  it('aggregates review events with unique students, distinct enrollments and eligible homework/adoption denominators', async () => {
    const result = await request(`/teachers/leadership/${ids.sg}/stats?tz=Asia/Shanghai`)
    expect(result.status).toBe(200)
    const data = (await result.json()) as any
    expect(data.summary).toMatchObject({
      students: 1,
      enrollments: 2,
      classes: 2,
      reviews: 110,
      sessions: 2,
      homeworkEligible: 1,
      withoutRequirement: 1,
    })
    expect(data.summary.accuracy).toBeCloseTo(91 / 110)
    expect(data.students).toBeUndefined()
    const students = (await (await request(`/teachers/leadership/${ids.sg}/students`)).json()) as any
    expect(students.rows).toHaveLength(2)
    expect(new Set(students.rows.map((s: any) => s.enrollmentId)).size).toBe(2)
    expect(data.adoption[0]).toMatchObject({ adopted: 1, eligible: 1 })
    const adminData = (await (
      await request(`/admin/leadership/${ids.sg}/stats?tz=Asia/Shanghai`, adminCookie)
    ).json()) as any
    expect(adminData.summary).toEqual(data.summary)
    const cards = (await (await request(`/teachers/leadership/${ids.sg}/cards`)).json()) as any
    expect(cards.rows[0]).toMatchObject({ possessing: 2, reviewed: 2, reps: 110 })
    expect(cards.rows[0].accuracy).toBeCloseTo(91 / 110)
    const matrix = (await (await request(`/teachers/leadership/${ids.sg}/matrix`)).json()) as any
    expect(matrix.rows).toHaveLength(2)
    expect(matrix.cardTotal).toBe(1)
  })
  it('validates eligibility and keeps the old appointment when an update fails', async () => {
    expect(
      (
        await request(`/admin/subject-grades/${ids.sg}`, adminCookie, 'PATCH', {
          leadTeacherId: ids.outsider,
          name: 'Invalid change',
        })
      ).status,
    ).toBe(400)
    expect((await db.subjectGradeLead.findUnique({ where: { subjectGradeId: ids.sg } }))?.teacherId).toBe(
      ids.lead,
    )
    expect((await db.subjectGrade.findUnique({ where: { id: ids.sg } }))?.name).toBe('English Grade 12')
    expect(
      (await request(`/admin/teachers/${ids.lead}/subject-grades/${ids.sg}`, adminCookie, 'DELETE')).status,
    ).toBe(409)
    expect((await request(`/admin/teachers/${ids.lead}`, adminCookie, 'DELETE')).status).toBe(409)
    await expect(
      db.subjectGradeLead.create({ data: { subjectGradeId: ids.otherSg, teacherId: ids.outsider } }),
    ).rejects.toThrow()
    await expect(
      db.subjectGradeLead.create({ data: { subjectGradeId: ids.sg, teacherId: ids.owner } }),
    ).rejects.toThrow()
  })
  it('revokes and restores SL access with the same signed session; archive suspends access', async () => {
    expect(
      (await request(`/admin/subject-grades/${ids.sg}`, adminCookie, 'PATCH', { leadTeacherId: null }))
        .status,
    ).toBe(200)
    expect((await request(`/teachers/classes/${ids.a}`)).status).toBe(404)
    expect((await request('/teachers/leadership')).status).toBe(200)
    expect((await request(`/teachers/classes/${ids.own}`)).status).toBe(200)
    expect(
      (await request(`/admin/subject-grades/${ids.sg}`, adminCookie, 'PATCH', { leadTeacherId: ids.lead }))
        .status,
    ).toBe(200)
    expect((await request(`/teachers/classes/${ids.a}`)).status).toBe(200)
    await db.subjectGrade.update({ where: { id: ids.sg }, data: { archivedAt: new Date() } })
    expect((await request(`/teachers/classes/${ids.a}`)).status).toBe(404)
    expect((await request(`/teachers/leadership/${ids.sg}/stats`)).status).toBe(404)
    await db.subjectGrade.update({ where: { id: ids.sg }, data: { archivedAt: null } })
    expect((await request(`/teachers/classes/${ids.a}`)).status).toBe(200)
  })
  it('supports multiple led groups and keeps access confined when one appointment is cleared', async () => {
    await request(`/admin/subject-grades/${ids.otherSg}`, adminCookie, 'PATCH', { leadTeacherId: ids.lead })
    expect(await (await request('/teachers/leadership')).json()).toHaveLength(2)
    expect((await request(`/teachers/classes/${ids.foreign}`)).status).toBe(200)
    await request(`/admin/subject-grades/${ids.otherSg}`, adminCookie, 'PATCH', { leadTeacherId: null })
    expect((await request(`/teachers/classes/${ids.foreign}`)).status).toBe(404)
    expect((await request(`/teachers/classes/${ids.a}`)).status).toBe(200)
  })
  it('returns meaningful empty reports for a group with a teacher and no classes', async () => {
    const group = await db.subjectGrade.create({ data: { name: 'Empty Group', departmentId: ids.dept } })
    await db.teacherSubjectGrade.create({ data: { teacherId: ids.lead, subjectGradeId: group.id } })
    await request(`/admin/subject-grades/${group.id}`, adminCookie, 'PATCH', { leadTeacherId: ids.lead })
    const report = (await (await request(`/teachers/leadership/${group.id}/stats`)).json()) as any
    expect(report.summary).toMatchObject({
      classes: 0,
      students: 0,
      enrollments: 0,
      reviews: 0,
      accuracy: null,
      homeworkEligible: 0,
    })
    const matrix = (await (await request(`/teachers/leadership/${group.id}/matrix`)).json()) as any
    expect(matrix).toMatchObject({ rows: [], cards: [], total: 0, cardTotal: 0 })
    await request(`/admin/subject-grades/${group.id}`, adminCookie, 'PATCH', { leadTeacherId: null })
  })
  it('suspends student data access when the parent department is archived', async () => {
    await db.department.update({ where: { id: ids.dept }, data: { archivedAt: new Date() } })
    expect((await request(`/teachers/classes/${ids.a}/students/${ids.student}/deck`)).status).toBe(404)
    expect((await request(`/teachers/classes/${ids.a}/students/${ids.student}/stats/daily`)).status).toBe(404)
    await db.department.update({ where: { id: ids.dept }, data: { archivedAt: null } })
  })
  it('paginates full decks and matrix columns without downloading every card', async () => {
    const cards = Array.from({ length: 51 }, (_, i) => ({
      id: randomUUID(),
      word: `Pagination ${String(i).padStart(2, '0')}`,
      definitionL2: 'Pagination fixture',
      cardSetId: ids.set,
    }))
    await db.card.createMany({ data: cards })
    await db.cardInstance.createMany({ data: cards.map((card) => ({ deckId: ids.da, cardId: card.id })) })
    const deck = (await (
      await request(`/teachers/classes/${ids.a}/students/${ids.student}/deck?page=2`)
    ).json()) as any
    expect(deck).toMatchObject({ total: 52, page: 2, pageSize: 50 })
    expect(deck.cards).toHaveLength(2)
    const matrix = (await (await request(`/teachers/leadership/${ids.sg}/matrix?cardPage=3`)).json()) as any
    expect(matrix).toMatchObject({ cardTotal: 52, cardPage: 3 })
    expect(matrix.cards).toHaveLength(2)
    const search = (await (
      await request(`/teachers/classes/${ids.a}/students/${ids.student}/deck?search=pagination&state=NEW`)
    ).json()) as any
    expect(search.total).toBe(51)
  })
})
