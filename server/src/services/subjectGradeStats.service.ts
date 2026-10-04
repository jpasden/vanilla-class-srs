import { PrismaClient } from '@prisma/client'
import { getClassCompliance } from './homework.service'
import { accuracy, dayKey, reportRange, shiftDay } from './reportRange.service'

/** One server-derived group scope shared by the Admin and SL reports. */
export async function subjectGradeStats(
  db: PrismaClient,
  subjectGradeId: string,
  days: number,
  tz: string,
  now = new Date(),
  studentPage?: number,
) {
  const range = reportRange(days, tz, now)
  const classes = await db.class.findMany({
    where: { subjectGradeId, archivedAt: null },
    include: { teacher: { include: { user: { select: { name: true } } } } },
    orderBy: { name: 'asc' },
  })
  const enrollments = await db.enrollment.findMany({
    where: { classId: { in: classes.map((c) => c.id) }, archivedAt: null },
    include: { student: { include: { user: { select: { name: true } } } }, deck: { select: { id: true } } },
  })
  const deckIds = enrollments.flatMap((e) => (e.deck ? [e.deck.id] : []))
  const [events, instances, optional, compliance, sessions] = await Promise.all([
    db.reviewEvent.findMany({
      where: { reviewedAt: { gte: range.trendStart, lte: now }, session: { deckId: { in: deckIds } } },
      select: { grade: true, reviewedAt: true, session: { select: { deckId: true } } },
    }),
    db.cardInstance.findMany({
      where: { deckId: { in: deckIds } },
      select: {
        deckId: true,
        state: true,
        due: true,
        createdAt: true,
        origin: true,
        card: { select: { cardSetId: true } },
      },
    }),
    db.assignment.findMany({
      where: { classId: { in: classes.map((c) => c.id) }, type: 'OPTIONAL' },
      include: { cardSet: { select: { name: true } } },
    }),
    Promise.all(
      classes.map(async (c) => ({ classId: c.id, compliance: await getClassCompliance(db, c.id, now) })),
    ),
    db.reviewSession.findMany({
      where: { deckId: { in: deckIds }, endedAt: { gte: range.start, lte: now } },
      select: { deckId: true },
    }),
  ])
  const recent = events.filter((e) => e.reviewedAt >= range.start)
  const eventsByDeck = new Map<string, typeof recent>()
  const instancesByDeck = new Map<string, typeof instances>()
  for (const e of recent) {
    const list = eventsByDeck.get(e.session.deckId) ?? []
    list.push(e)
    eventsByDeck.set(e.session.deckId, list)
  }
  for (const i of instances) {
    const list = instancesByDeck.get(i.deckId) ?? []
    list.push(i)
    instancesByDeck.set(i.deckId, list)
  }
  const enrollmentRows = enrollments
    .map((e) => {
      const cls = classes.find((c) => c.id === e.classId)!
      const reviews = e.deck ? (eventsByDeck.get(e.deck.id) ?? []) : []
      const cards = e.deck ? (instancesByDeck.get(e.deck.id) ?? []) : []
      const hw = compliance
        .find((c) => c.classId === e.classId)
        ?.compliance?.students.find((s) => s.studentId === e.studentId)
      return {
        enrollmentId: e.id,
        studentId: e.studentId,
        studentName: e.student.user.name,
        classId: cls.id,
        className: cls.name,
        teacherName: cls.teacher.user.name,
        reviews: reviews.length,
        accuracy: accuracy(reviews.map((r) => r.grade)),
        cards: cards.length,
        overdue: cards.filter((c) => c.state !== 'NEW' && c.due < now).length,
        homeworkStatus: hw?.status ?? null,
      }
    })
    .sort((a, b) => b.reviews - a.reviews || a.studentName.localeCompare(b.studentName))
  const classRows = classes.map((c) => {
    const rows = enrollmentRows.filter((e) => e.classId === c.id)
    const decks = new Set(
      enrollments.filter((e) => e.classId === c.id).flatMap((e) => (e.deck ? [e.deck.id] : [])),
    )
    const ev = recent.filter((e) => decks.has(e.session.deckId))
    const eligible = rows.filter((e) => e.homeworkStatus !== null)
    return {
      classId: c.id,
      className: c.name,
      teacherName: c.teacher.user.name,
      students: rows.length,
      reviews: ev.length,
      accuracy: accuracy(ev.map((e) => e.grade)),
      sessions: sessions.filter((s) => decks.has(s.deckId)).length,
      homeworkMet: eligible.filter((e) => e.homeworkStatus === 'MET').length,
      homeworkEligible: eligible.length,
      additions: instances.filter(
        (i) =>
          decks.has(i.deckId) &&
          i.origin === 'STUDENT_ADDED' &&
          i.createdAt >= range.start &&
          i.createdAt <= now,
      ).length,
    }
  })
  const dayCounts = new Map<string, { reviews: number; correct: number; growth: number; due: number }>()
  const bucket = (key: string) => {
    let value = dayCounts.get(key)
    if (!value) {
      value = { reviews: 0, correct: 0, growth: 0, due: 0 }
      dayCounts.set(key, value)
    }
    return value
  }
  for (const event of events) {
    const value = bucket(dayKey(event.reviewedAt, tz))
    value.reviews++
    if (event.grade >= 2) value.correct++
  }
  for (const instance of instances) {
    if (instance.createdAt >= range.start && instance.createdAt <= now)
      bucket(dayKey(instance.createdAt, tz)).growth++
    if (instance.state !== 'NEW' && instance.due >= now) bucket(dayKey(instance.due, tz)).due++
  }
  const daily = Array.from({ length: days }, (_, i) => {
    const date = shiftDay(range.first, i)
    const window = Array.from({ length: 7 }, (_, offset) => bucket(shiftDay(date, -offset)))
    const reps = window.reduce((n, v) => n + v.reviews, 0)
    return {
      date,
      reviews: bucket(date).reviews,
      growth: bucket(date).growth,
      accuracy: reps ? window.reduce((n, v) => n + v.correct, 0) / reps : null,
    }
  })
  const forecast = Array.from({ length: 30 }, (_, i) => {
    const date = shiftDay(range.today, i)
    return { date, due: bucket(date).due }
  })
  const adoption = [...new Set(optional.map((a) => a.cardSetId))].map((cardSetId) => {
    const assignments = optional.filter((a) => a.cardSetId === cardSetId)
    const classIds = new Set(assignments.map((a) => a.classId))
    const eligible = enrollments.filter((e) => classIds.has(e.classId))
    const adopted = eligible.filter(
      (e) =>
        e.deck &&
        (instancesByDeck.get(e.deck.id) ?? []).some(
          (i) => i.origin === 'OPTIONAL' && i.card.cardSetId === cardSetId,
        ),
    )
    return {
      cardSetId,
      name: assignments[0].cardSet.name,
      adopted: adopted.length,
      eligible: eligible.length,
    }
  })
  return {
    range,
    summary: {
      classes: classes.length,
      students: new Set(enrollments.map((e) => e.studentId)).size,
      enrollments: enrollments.length,
      reviews: recent.length,
      accuracy: accuracy(recent.map((e) => e.grade)),
      sessions: sessions.length,
      deckStates: Object.fromEntries(
        ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'].map((state) => [
          state,
          instances.filter((i) => i.state === state).length,
        ]),
      ),
      overdue: instances.filter((i) => i.state !== 'NEW' && i.due < now).length,
      homeworkMet: enrollmentRows.filter((e) => e.homeworkStatus === 'MET').length,
      homeworkEligible: enrollmentRows.filter((e) => e.homeworkStatus !== null).length,
      homeworkAtRisk: enrollmentRows.filter((e) => e.homeworkStatus === 'AT_RISK').length,
      homeworkNotMet: enrollmentRows.filter((e) => e.homeworkStatus === 'NOT_MET').length,
      withoutRequirement: enrollmentRows.filter((e) => e.homeworkStatus === null).length,
    },
    classes: classRows,
    students: studentPage ? enrollmentRows.slice((studentPage - 1) * 50, studentPage * 50) : undefined,
    studentTotal: enrollmentRows.length,
    daily,
    forecast,
    adoption,
  }
}

/** Paginated card/matrix details are loaded separately from the summary. */
export async function subjectGradeCardStats(
  db: PrismaClient,
  subjectGradeId: string,
  page: number,
  days: number,
  tz: string,
) {
  const scope = { archivedAt: null, class: { subjectGradeId, archivedAt: null } }
  const instances = { deck: { enrollment: scope } }
  const [cards, total] = await Promise.all([
    db.card.findMany({
      where: { instances: { some: instances } },
      skip: (page - 1) * 25,
      take: 25,
      orderBy: [{ word: 'asc' }, { id: 'asc' }],
      include: { cardSet: { select: { name: true } } },
    }),
    db.card.count({ where: { instances: { some: instances } } }),
  ])
  const range = reportRange(days, tz)
  const [possessions, grades] = await Promise.all([
    db.cardInstance.findMany({
      where: { ...instances, cardId: { in: cards.map((c) => c.id) } },
      select: { id: true, cardId: true },
    }),
    db.reviewEvent.groupBy({
      by: ['cardInstanceId', 'grade'],
      where: {
        reviewedAt: { gte: range.start, lt: range.end },
        cardInstance: { ...instances, cardId: { in: cards.map((c) => c.id) } },
      },
      _count: true,
    }),
  ])
  const instanceCards = new Map(possessions.map((i) => [i.id, i.cardId]))
  const counts = new Map(
    cards.map((c) => [c.id, { possessing: 0, reviewed: new Set<string>(), reps: 0, correct: 0 }]),
  )
  for (const instance of possessions) counts.get(instance.cardId)!.possessing++
  for (const group of grades) {
    const cardId = instanceCards.get(group.cardInstanceId)
    if (!cardId) continue
    const count = counts.get(cardId)!
    count.reviewed.add(group.cardInstanceId)
    count.reps += group._count
    if (group.grade >= 2) count.correct += group._count
  }
  const rows = cards.map((card) => {
    const count = counts.get(card.id)!
    return {
      cardId: card.id,
      word: card.word,
      cardSetName: card.cardSet.name,
      possessing: count.possessing,
      reviewed: count.reviewed.size,
      reps: count.reps,
      accuracy: count.reps ? count.correct / count.reps : null,
    }
  })
  return { rows, total, page, pageSize: 25 }
}

export async function subjectGradeMatrix(
  db: PrismaClient,
  subjectGradeId: string,
  page: number,
  cardPage: number,
) {
  const scope = { archivedAt: null, class: { subjectGradeId, archivedAt: null } }
  const [enrollments, total, cards, cardTotal] = await Promise.all([
    db.enrollment.findMany({
      where: scope,
      skip: (page - 1) * 25,
      take: 25,
      orderBy: { id: 'asc' },
      include: {
        student: { include: { user: { select: { name: true } } } },
        class: { select: { name: true } },
        deck: { select: { id: true } },
      },
    }),
    db.enrollment.count({ where: scope }),
    db.card.findMany({
      where: { instances: { some: { deck: { enrollment: scope } } } },
      skip: (cardPage - 1) * 25,
      take: 25,
      orderBy: [{ word: 'asc' }, { id: 'asc' }],
      select: { id: true, word: true, cardSet: { select: { name: true } } },
    }),
    db.card.count({ where: { instances: { some: { deck: { enrollment: scope } } } } }),
  ])
  const values = await db.cardInstance.findMany({
    where: {
      deckId: { in: enrollments.flatMap((e) => (e.deck ? [e.deck.id] : [])) },
      cardId: { in: cards.map((c) => c.id) },
    },
    select: { id: true, deckId: true, cardId: true },
  })
  const grades = await db.reviewEvent.groupBy({
    by: ['cardInstanceId', 'grade'],
    where: { cardInstanceId: { in: values.map((v) => v.id) } },
    _count: true,
  })
  const counts = new Map(values.map((v) => [v.id, { reps: 0, correct: 0 }]))
  for (const group of grades) {
    const count = counts.get(group.cardInstanceId)!
    count.reps += group._count
    if (group.grade >= 2) count.correct += group._count
  }
  return {
    page,
    cardPage,
    total,
    cardTotal,
    cards,
    rows: enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      classId: e.classId,
      name: e.student.user.name,
      className: e.class.name,
      cells: Object.fromEntries(
        values
          .filter((v) => v.deckId === e.deck?.id)
          .map((v) => [
            v.cardId,
            {
              reps: counts.get(v.id)!.reps,
              accuracy: counts.get(v.id)!.reps ? counts.get(v.id)!.correct / counts.get(v.id)!.reps : null,
            },
          ]),
      ),
    })),
  }
}
