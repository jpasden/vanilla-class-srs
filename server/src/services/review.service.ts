/**
 * Review session logic — spec §24.
 *
 * Session lifecycle:
 *  1. start  — closes any open session, builds ordered card queue, creates ReviewSession
 *  2. grade  — applies FSRS, writes ReviewEvent, handles lapse re-queue
 *  3. finish — closes session, calculates accuracyRate
 */

import { PrismaClient, FSRSState } from '@prisma/client'
import { schedule } from '@vanilla-srs/shared/fsrs'
import type { FSRSParams } from '@vanilla-srs/shared/fsrs'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionCard {
  instanceId: string
  cardId: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null // student override first, then card default
  state: FSRSState
  due: Date
  stability: number
  difficulty: number
  lapses: number
  reps: number
}

export interface StartSessionResult {
  sessionId: string
  cards: SessionCard[]
  deckId: string
}

// ── Helper: close an open session ────────────────────────────────────────────

async function closeSession(prisma: PrismaClient, sessionId: string, now: Date): Promise<void> {
  const events = await prisma.reviewEvent.findMany({ where: { sessionId } })
  const total = events.length
  const correct = events.filter((e) => e.grade >= 2).length
  const accuracyRate = total > 0 ? correct / total : null

  await prisma.reviewSession.update({
    where: { id: sessionId },
    data: {
      endedAt: now,
      cardsReviewed: total,
      accuracyRate,
    },
  })
}

// ── Helper: count new cards introduced today ─────────────────────────────────

async function newCardsReviewedToday(prisma: PrismaClient, deckId: string): Promise<number> {
  // Count ReviewEvents today where the card's state at event time would have been NEW.
  // We detect this by looking at events for CardInstances that were first reviewed today:
  // i.e. ReviewEvents where the CardInstance.reps was 0 before the event.
  // Simplest proxy: CardInstances in this deck whose first ReviewEvent is today.
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // Count distinct cardInstanceIds that have at least one event today and
  // whose CardInstance.state became non-NEW (meaning the review today was their first).
  // Actually the spec says: count ReviewEvents where CardInstance.state was NEW at time of event.
  // We approximate: count CardInstances in this deck whose reps count > 0 and lastReview is today.
  // More precisely: count instances whose createdAt < todayStart (existed before today) is not useful.
  // The spec says: count ReviewEvent records where CardInstance.state was NEW at the time of the event.
  // Since FSRS moves NEW→REVIEW/LEARNING on first grade, and reps increments, we detect first-time reviews:
  // reps=0 → reps=1 on first grade. But we don't snapshot the state at event time.
  //
  // Practical approach: count CardInstances in this deck that have their first ReviewEvent today.
  // "First ReviewEvent" = MIN(reviewedAt) is today.

  const result = await prisma.reviewEvent.groupBy({
    by: ['cardInstanceId'],
    where: {
      session: { deckId },
      reviewedAt: { gte: todayStart },
    },
    _min: { reviewedAt: true },
  })

  // For each card with an event today, check if their EARLIEST event ever is also today.
  // If yes → it was a NEW card today.
  let count = 0
  for (const row of result) {
    const earliest = await prisma.reviewEvent.findFirst({
      where: { cardInstanceId: row.cardInstanceId },
      orderBy: { reviewedAt: 'asc' },
      select: { reviewedAt: true },
    })
    if (earliest && earliest.reviewedAt >= todayStart) {
      count++
    }
  }
  return count
}

// ── start ────────────────────────────────────────────────────────────────────

export async function startSession(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
): Promise<StartSessionResult | { error: string; status: number }> {
  // Resolve enrollment → deck
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true },
  })
  if (!enrollment || enrollment.studentId !== studentId) {
    return { error: 'Enrollment not found', status: 404 }
  }
  if (!enrollment.deck) {
    return { error: 'Deck not found', status: 404 }
  }
  const deck = enrollment.deck
  const params = deck.fsrsParams as unknown as FSRSParams

  // Close any open (abandoned) session — spec §24 decision 3
  const openSession = await prisma.reviewSession.findFirst({
    where: { deckId: deck.id, endedAt: null },
  })
  if (openSession) {
    await closeSession(prisma, openSession.id, now)
  }

  // Build session card list — spec §24 decisions 1, 2, 4
  // Due cards: LEARNING / REVIEW / RELEARNING where due <= now, ordered by due asc
  const dueInstances = await prisma.cardInstance.findMany({
    where: {
      deckId: deck.id,
      state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] },
      due: { lte: now },
    },
    include: { card: true },
    orderBy: { due: 'asc' },
  })

  // New cards: NEW state, ordered by CardSet assignment priority (§24 decision 2)
  // Priority comes from Assignment.priority on the assignment linking the CardSet to the class
  const newCardsAlreadyToday = await newCardsReviewedToday(prisma, deck.id)
  const newCardLimit = (params as any).newCardsPerDay ?? 10
  const newCardSlots = Math.max(0, newCardLimit - newCardsAlreadyToday)

  let newInstances: typeof dueInstances = []
  if (newCardSlots > 0) {
    // Get all NEW instances, join through card → cardSet → assignments for priority
    const allNew = await prisma.cardInstance.findMany({
      where: { deckId: deck.id, state: 'NEW' },
      include: {
        card: {
          include: {
            cardSet: {
              include: {
                assignments: {
                  where: { class: { enrollments: { some: { id: enrollmentId } } } },
                  select: { priority: true },
                },
              },
            },
          },
        },
      },
    })

    // Sort by assignment priority (lower = higher priority), then by cardInstance createdAt
    allNew.sort((a, b) => {
      const aPrio = a.card.cardSet.assignments[0]?.priority ?? 9999
      const bPrio = b.card.cardSet.assignments[0]?.priority ?? 9999
      if (aPrio !== bPrio) return aPrio - bPrio
      return a.createdAt.getTime() - b.createdAt.getTime()
    })

    newInstances = allNew.slice(0, newCardSlots)
  }

  const allInstances = [...dueInstances, ...newInstances]

  // Create the ReviewSession record
  const session = await prisma.reviewSession.create({
    data: {
      deckId: deck.id,
      startedAt: now,
    },
  })

  const cards: SessionCard[] = allInstances.map((inst) => ({
    instanceId: inst.id,
    cardId: inst.cardId,
    word: inst.card.word,
    pos: inst.card.pos,
    definitionL2: inst.card.definitionL2,
    definitionL1: inst.definitionL1 ?? inst.card.definitionL1,
    exampleSentence: inst.exampleSentence ?? inst.card.exampleSentence,
    state: inst.state,
    due: inst.due,
    stability: inst.stability,
    difficulty: inst.difficulty,
    lapses: inst.lapses,
    reps: inst.reps,
  }))

  return { sessionId: session.id, cards, deckId: deck.id }
}

// ── restudy ──────────────────────────────────────────────────────────────────

export async function startRestudy(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  instanceIds: string[],
  now: Date = new Date(),
): Promise<StartSessionResult | { error: string; status: number }> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true },
  })
  if (!enrollment || enrollment.studentId !== studentId) {
    return { error: 'Enrollment not found', status: 404 }
  }
  if (!enrollment.deck) {
    return { error: 'Deck not found', status: 404 }
  }
  const deck = enrollment.deck

  // Close any open (abandoned) session
  const openSession = await prisma.reviewSession.findFirst({
    where: { deckId: deck.id, endedAt: null },
  })
  if (openSession) {
    await closeSession(prisma, openSession.id, now)
  }

  const instances = await prisma.cardInstance.findMany({
    where: { id: { in: instanceIds }, deckId: deck.id },
    include: { card: true },
  })

  const session = await prisma.reviewSession.create({
    data: { deckId: deck.id, startedAt: now },
  })

  // Preserve the caller's ordering
  const byId = Object.fromEntries(instances.map((i) => [i.id, i]))
  const cards: SessionCard[] = instanceIds
    .filter((id) => byId[id])
    .map((id) => {
      const inst = byId[id]
      return {
        instanceId: inst.id,
        cardId: inst.cardId,
        word: inst.card.word,
        pos: inst.card.pos,
        definitionL2: inst.card.definitionL2,
        definitionL1: inst.definitionL1 ?? inst.card.definitionL1,
        exampleSentence: inst.exampleSentence ?? inst.card.exampleSentence,
        state: inst.state,
        due: inst.due,
        stability: inst.stability,
        difficulty: inst.difficulty,
        lapses: inst.lapses,
        reps: inst.reps,
      }
    })

  return { sessionId: session.id, cards, deckId: deck.id }
}

// ── grade ────────────────────────────────────────────────────────────────────

export interface GradeResult {
  instanceId: string
  state: FSRSState
  due: Date
  stability: number
  difficulty: number
  retrievability: number
  lapses: number
  reps: number
  /** If true, card should be re-appended to the session queue at the client. */
  requeue: boolean
}

export async function gradeCard(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  instanceId: string,
  grade: number,
  responseTimeMs: number | undefined,
  now: Date = new Date(),
): Promise<GradeResult | { error: string; status: number }> {
  if (grade < 1 || grade > 4) {
    return { error: 'Grade must be 1–4', status: 400 }
  }

  // Verify session belongs to student's deck
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { deck: { include: { enrollment: true } } },
  })
  if (!session || session.endedAt) {
    return { error: 'Session not found or already closed', status: 404 }
  }
  if (session.deck.enrollment.studentId !== studentId) {
    return { error: 'Session not found', status: 404 }
  }

  // Verify instance belongs to deck
  const instance = await prisma.cardInstance.findUnique({
    where: { id: instanceId },
    include: { card: true },
  })
  if (!instance || instance.deckId !== session.deckId) {
    return { error: 'Card instance not found', status: 404 }
  }

  const params = session.deck.fsrsParams as unknown as FSRSParams

  // Apply FSRS scheduling
  const fsrsResult = schedule(
    {
      stability: instance.stability,
      difficulty: instance.difficulty,
      reps: instance.reps,
      lapses: instance.lapses,
      state: instance.state as any,
      lastReview: instance.lastReview,
      due: instance.due,
    },
    grade,
    params,
    now,
  )

  // Update CardInstance
  await prisma.cardInstance.update({
    where: { id: instanceId },
    data: {
      stability: fsrsResult.stability,
      difficulty: fsrsResult.difficulty,
      retrievability: fsrsResult.retrievability,
      reps: fsrsResult.reps,
      lapses: fsrsResult.lapses,
      state: fsrsResult.state,
      due: fsrsResult.due,
      lastReview: fsrsResult.lastReview,
    },
  })

  // Write ReviewEvent
  const event = await prisma.reviewEvent.create({
    data: {
      sessionId,
      cardInstanceId: instanceId,
      grade,
      responseTimeMs: responseTimeMs ?? null,
      reviewedAt: now,
    },
  })

  // Lapse re-queue logic: if grade=1 (Again), re-queue up to 3 times per card per session.
  let requeue = false
  if (grade === 1) {
    const priorAgainCount = await prisma.reviewEvent.count({
      where: {
        sessionId,
        cardInstanceId: instanceId,
        grade: 1,
        NOT: { id: event.id },
      },
    })
    requeue = priorAgainCount < 3
  }

  return {
    instanceId,
    state: fsrsResult.state,
    due: fsrsResult.due,
    stability: fsrsResult.stability,
    difficulty: fsrsResult.difficulty,
    retrievability: fsrsResult.retrievability,
    lapses: fsrsResult.lapses,
    reps: fsrsResult.reps,
    requeue,
  }
}

// ── finish ───────────────────────────────────────────────────────────────────

export async function finishSession(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; cardsReviewed: number; accuracyRate: number | null } | { error: string; status: number }> {
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { deck: { include: { enrollment: true } } },
  })
  if (!session || session.endedAt) {
    return { error: 'Session not found or already closed', status: 404 }
  }
  if (session.deck.enrollment.studentId !== studentId) {
    return { error: 'Session not found', status: 404 }
  }

  await closeSession(prisma, sessionId, now)

  const updated = await prisma.reviewSession.findUnique({ where: { id: sessionId } })
  return {
    ok: true,
    cardsReviewed: updated?.cardsReviewed ?? 0,
    accuracyRate: updated?.accuracyRate ?? null,
  }
}
