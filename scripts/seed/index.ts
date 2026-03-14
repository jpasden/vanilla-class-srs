import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from root .env (DATABASE_URL lives there)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient, FSRSState, CardOrigin } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { STUDENT_NAMES } from './data/names';
import { CARD_SETS } from './data/words';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

/** Returns a Date that is `daysAgo` days before now */
function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Returns a Date that is `daysFromNow` days after now */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ─────────────────────────────────────────────
// Wipe before seeding
// ─────────────────────────────────────────────

async function wipe(): Promise<void> {
  process.stdout.write('Wiping existing data... ');
  await prisma.reviewEvent.deleteMany();
  await prisma.reviewSession.deleteMany();
  await prisma.cardInstance.deleteMany();
  await prisma.deck.deleteMany();
  await prisma.homeworkRequirement.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.subjectGradeAssignment.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.card.deleteMany();
  await prisma.cardSet.deleteMany();
  await prisma.teacherSubjectGrade.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.subjectGrade.deleteMany();
  await prisma.department.deleteMany();
  console.log('done.');
}

// ─────────────────────────────────────────────
// Main seed
// ─────────────────────────────────────────────

async function seed(): Promise<void> {
  // ── Hash password once, reuse for all users ──
  const SALT_ROUNDS = 10;
  process.stdout.write('Hashing passwords... ');
  const passwordHash = await bcrypt.hash('password123', SALT_ROUNDS);
  console.log('done.');

  // ── Department ──
  console.log('Creating department...');
  const department = await prisma.department.create({
    data: { name: 'Language Department' },
  });

  // ── SubjectGrades ──
  console.log('Creating subject grades...');
  const sg11 = await prisma.subjectGrade.create({
    data: { name: 'English B HL Grade 11', departmentId: department.id },
  });
  const sg12 = await prisma.subjectGrade.create({
    data: { name: 'English B HL Grade 12', departmentId: department.id },
  });

  // ── Admin user ──
  console.log('Creating admin...');
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@test.com',
      passwordHash,
      name: 'Sarah Chen',
      role: 'ADMIN',
    },
  });

  // ── Teacher users ──
  console.log('Creating teachers...');
  const teacherDefs = [
    // Grade 11
    { email: 'teacher1@test.com', name: 'James Harrington', sgId: sg11.id },
    { email: 'teacher2@test.com', name: 'Emily Torres',     sgId: sg11.id },
    { email: 'teacher3@test.com', name: 'David Kim',        sgId: sg11.id },
    // Grade 12
    { email: 'teacher4@test.com', name: 'Rachel Patel',     sgId: sg12.id },
    { email: 'teacher5@test.com', name: 'Marcus Webb',      sgId: sg12.id },
    { email: 'teacher6@test.com', name: 'Olivia Chen',      sgId: sg12.id },
  ];

  const teachers: Array<{
    userId: string;
    teacherId: string;
    email: string;
    sgId: string;
  }> = [];

  for (const def of teacherDefs) {
    const user = await prisma.user.create({
      data: { email: def.email, passwordHash, name: def.name, role: 'TEACHER' },
    });
    const teacher = await prisma.teacher.create({ data: { userId: user.id } });
    await prisma.teacherSubjectGrade.create({
      data: { teacherId: teacher.id, subjectGradeId: def.sgId },
    });
    teachers.push({ userId: user.id, teacherId: teacher.id, email: def.email, sgId: def.sgId });
  }

  // Convenience references
  const t1 = teachers[0]; // Grade 11
  const t2 = teachers[1];
  const t3 = teachers[2];
  const t4 = teachers[3]; // Grade 12
  const t5 = teachers[4];
  const t6 = teachers[5];

  // ── Classes (2 per teacher) ──
  console.log('Creating classes...');
  const classDefs = [
    { name: '11A', teacherId: t1.teacherId, sgId: sg11.id },
    { name: '11B', teacherId: t1.teacherId, sgId: sg11.id },
    { name: '11C', teacherId: t2.teacherId, sgId: sg11.id },
    { name: '11D', teacherId: t2.teacherId, sgId: sg11.id },
    { name: '11E', teacherId: t3.teacherId, sgId: sg11.id },
    { name: '11F', teacherId: t3.teacherId, sgId: sg11.id },
    { name: '12A', teacherId: t4.teacherId, sgId: sg12.id },
    { name: '12B', teacherId: t4.teacherId, sgId: sg12.id },
    { name: '12C', teacherId: t5.teacherId, sgId: sg12.id },
    { name: '12D', teacherId: t5.teacherId, sgId: sg12.id },
    { name: '12E', teacherId: t6.teacherId, sgId: sg12.id },
    { name: '12F', teacherId: t6.teacherId, sgId: sg12.id },
  ];

  const classes: Array<{
    id: string;
    name: string;
    teacherId: string;
    sgId: string;
  }> = [];

  for (const def of classDefs) {
    const cls = await prisma.class.create({
      data: {
        name: def.name,
        teacherId: def.teacherId,
        subjectGradeId: def.sgId,
      },
    });
    classes.push({ id: cls.id, name: cls.name, teacherId: def.teacherId, sgId: def.sgId });
  }

  // ── Student users (240 total, 20 per class) ──
  console.log('Creating 240 students...');

  // We'll track student records per class for enrollment
  const classStudentDecks: Array<{
    classIndex: number;
    studentIndex: number; // 0-based within class
    studentId: string;
    deckId: string;
    enrollmentId: string;
  }> = [];

  for (let classIndex = 0; classIndex < 12; classIndex++) {
    for (let withinClass = 0; withinClass < 20; withinClass++) {
      const studentNumber = classIndex * 20 + withinClass + 1; // 1-based global student number
      const nameIndex = (studentNumber - 1) % STUDENT_NAMES.length;
      const studentName = STUDENT_NAMES[nameIndex];

      const user = await prisma.user.create({
        data: {
          email: `student${studentNumber}@test.com`,
          passwordHash,
          name: studentName,
          role: 'STUDENT',
        },
      });

      const student = await prisma.student.create({ data: { userId: user.id } });

      const enrollment = await prisma.enrollment.create({
        data: { studentId: student.id, classId: classes[classIndex].id },
      });

      const deck = await prisma.deck.create({ data: { enrollmentId: enrollment.id } });

      classStudentDecks.push({
        classIndex,
        studentIndex: withinClass,
        studentId: student.id,
        deckId: deck.id,
        enrollmentId: enrollment.id,
      });
    }
  }

  // ── CardSets ──
  console.log('Creating CardSets and Cards...');

  // CardSet 1 & 2: DEPARTMENTAL (both SubjectGrades), created by admin (teacherId = null conceptually,
  // but the schema stores the creator teacherId for attribution — admin has no teacherId,
  // so we leave teacherId null for departmental sets created by admin).
  // CardSet 3: DEPARTMENTAL, OPTIONAL
  // CardSet 4: PRIVATE, owned by teacher1
  // CardSet 5: PRIVATE, owned by teacher4

  const createdCardSets: Array<{
    id: string;
    cardIds: string[];
    seedIndex: number; // 0-based index into CARD_SETS
  }> = [];

  for (let i = 0; i < CARD_SETS.length; i++) {
    const seedSet = CARD_SETS[i];

    let status: 'PRIVATE' | 'DEPARTMENTAL';
    let teacherId: string | null = null;
    let subjectGradeId: string | null = null;

    if (i < 3) {
      // CardSets 0, 1, 2 → DEPARTMENTAL
      // For departmental sets visible to both grades, we create one CardSet.
      // The SubjectGradeAssignments will link them to specific SubjectGrades.
      // schema: subjectGradeId on CardSet is where the CardSet "lives" (its primary home).
      // We'll associate with sg11 as primary; assignments will cover both grades.
      status = 'DEPARTMENTAL';
      subjectGradeId = sg11.id; // primary home; SGA rows cover both
    } else if (i === 3) {
      // CardSet 4 (index 3): PRIVATE, teacher1
      status = 'PRIVATE';
      teacherId = t1.teacherId;
    } else {
      // CardSet 5 (index 4): PRIVATE, teacher4
      status = 'PRIVATE';
      teacherId = t4.teacherId;
    }

    const cardSet = await prisma.cardSet.create({
      data: {
        name: seedSet.name,
        description: seedSet.description,
        status,
        teacherId,
        subjectGradeId,
      },
    });

    const cardIds: string[] = [];
    for (const seedCard of seedSet.cards) {
      const card = await prisma.card.create({
        data: {
          cardSetId: cardSet.id,
          word: seedCard.word,
          pos: seedCard.pos,
          definitionL2: seedCard.definitionL2,
          definitionL1: undefined,
          exampleSentence: seedCard.exampleSentence,
        },
      });
      cardIds.push(card.id);
    }

    createdCardSets.push({ id: cardSet.id, cardIds, seedIndex: i });
  }

  const cs1 = createdCardSets[0]; // Unit 1 — DEPARTMENTAL MANDATORY
  const cs2 = createdCardSets[1]; // Unit 2 — DEPARTMENTAL MANDATORY
  const cs3 = createdCardSets[2]; // Unit 3 — DEPARTMENTAL OPTIONAL
  const cs4 = createdCardSets[3]; // Unit 4 — PRIVATE teacher1
  const cs5 = createdCardSets[4]; // Unit 5 — PRIVATE teacher4

  // ── SubjectGradeAssignments ──
  console.log('Creating SubjectGradeAssignments...');

  // CardSets 1 & 2: MANDATORY, pushed to BOTH SubjectGrades by admin
  for (const cs of [cs1, cs2]) {
    for (const sg of [sg11, sg12]) {
      await prisma.subjectGradeAssignment.create({
        data: {
          subjectGradeId: sg.id,
          cardSetId: cs.id,
          type: 'MANDATORY',
          assignedBy: adminUser.id,
        },
      });
    }
  }

  // CardSet 3: OPTIONAL, pushed to BOTH SubjectGrades by admin
  for (const sg of [sg11, sg12]) {
    await prisma.subjectGradeAssignment.create({
      data: {
        subjectGradeId: sg.id,
        cardSetId: cs3.id,
        type: 'OPTIONAL',
        assignedBy: adminUser.id,
      },
    });
  }

  // ── Class Assignments ──
  // For each class, create Assignment rows mirroring SubjectGradeAssignments.
  // Also create class assignments for private CardSets (teacher1's cs4 → classes 11A/11B;
  // teacher4's cs5 → classes 12A/12B).
  console.log('Creating class Assignments...');

  // Map classes by name for convenience
  const classByName = new Map(classes.map((c) => [c.name, c]));

  // Grade 11 classes
  const grade11Classes = classes.filter((c) => c.sgId === sg11.id);
  // Grade 12 classes
  const grade12Classes = classes.filter((c) => c.sgId === sg12.id);

  // Create an Assignment for a class + cardSet; returns the assignment id
  async function createAssignment(
    classId: string,
    cardSetId: string,
    type: 'MANDATORY' | 'OPTIONAL',
    assignedByUserId: string,
    priority: number = 0,
  ): Promise<string> {
    const assignment = await prisma.assignment.create({
      data: { classId, cardSetId, type, priority, assignedBy: assignedByUserId },
    });
    return assignment.id;
  }

  // Grade 11: cs1, cs2 MANDATORY; cs3 OPTIONAL
  for (const cls of grade11Classes) {
    // Find teacher's userId
    const teacherUserId = teachers.find((t) => t.teacherId === cls.teacherId)!.userId;
    await createAssignment(cls.id, cs1.id, 'MANDATORY', teacherUserId, 0);
    await createAssignment(cls.id, cs2.id, 'MANDATORY', teacherUserId, 1);
    await createAssignment(cls.id, cs3.id, 'OPTIONAL', teacherUserId, 2);
  }

  // Grade 12: cs1, cs2 MANDATORY; cs3 OPTIONAL
  for (const cls of grade12Classes) {
    const teacherUserId = teachers.find((t) => t.teacherId === cls.teacherId)!.userId;
    await createAssignment(cls.id, cs1.id, 'MANDATORY', teacherUserId, 0);
    await createAssignment(cls.id, cs2.id, 'MANDATORY', teacherUserId, 1);
    await createAssignment(cls.id, cs3.id, 'OPTIONAL', teacherUserId, 2);
  }

  // teacher1's cs4 (Unit 4) → classes 11A, 11B only — MANDATORY
  for (const className of ['11A', '11B']) {
    const cls = classByName.get(className)!;
    await createAssignment(cls.id, cs4.id, 'MANDATORY', t1.userId, 3);
  }

  // teacher4's cs5 (Unit 5) → classes 12A, 12B only — MANDATORY
  for (const className of ['12A', '12B']) {
    const cls = classByName.get(className)!;
    await createAssignment(cls.id, cs5.id, 'MANDATORY', t4.userId, 3);
  }

  // ── CardInstances ──
  // For MANDATORY assignments, create CardInstances for all enrolled students in affected classes.
  // cs1, cs2 → ALL 12 classes (both grades)
  // cs4 → 11A, 11B only
  // cs5 → 12A, 12B only
  // OPTIONAL (cs3) → NO CardInstances
  console.log('Creating CardInstances...');

  // cardInstancesMap[deckId][cardId] = cardInstanceId
  const cardInstancesMap = new Map<string, Map<string, string>>();

  async function createCardInstancesForCardSet(
    cardIds: string[],
    deckIds: string[],
  ): Promise<void> {
    for (const deckId of deckIds) {
      if (!cardInstancesMap.has(deckId)) {
        cardInstancesMap.set(deckId, new Map());
      }
      const deckMap = cardInstancesMap.get(deckId)!;

      for (const cardId of cardIds) {
        if (deckMap.has(cardId)) continue; // already created (shouldn't happen but be safe)
        const ci = await prisma.cardInstance.create({
          data: {
            deckId,
            cardId,
            origin: CardOrigin.TEACHER_ASSIGNED,
          },
        });
        deckMap.set(cardId, ci.id);
      }
    }
  }

  // Helper: get deckIds for a set of class names
  function deckIdsForClasses(classNames: string[]): string[] {
    const targetClassIds = new Set(
      classNames.map((n) => classByName.get(n)!.id),
    );
    return classStudentDecks
      .filter((r) => targetClassIds.has(classes[r.classIndex].id))
      .map((r) => r.deckId);
  }

  // All class names
  const allClassNames = classes.map((c) => c.name);

  // cs1 & cs2 → all classes
  await createCardInstancesForCardSet(cs1.cardIds, deckIdsForClasses(allClassNames));
  await createCardInstancesForCardSet(cs2.cardIds, deckIdsForClasses(allClassNames));

  // cs4 → 11A, 11B
  await createCardInstancesForCardSet(cs4.cardIds, deckIdsForClasses(['11A', '11B']));

  // cs5 → 12A, 12B
  await createCardInstancesForCardSet(cs5.cardIds, deckIdsForClasses(['12A', '12B']));

  // ── FSRS Review History ──
  console.log('Generating FSRS review history...');

  for (const record of classStudentDecks) {
    const { studentIndex, deckId } = record;
    const deckMap = cardInstancesMap.get(deckId);
    if (!deckMap || deckMap.size === 0) continue; // no cards (e.g., new/middle tier with cs3 OPTIONAL)

    const cardInstanceIds = Array.from(deckMap.values());

    if (studentIndex <= 3) {
      // ── ACTIVE COMPLIANT tier (0-3): REVIEW state, 3+ sessions in last 7 days → homework MET ──
      await seedActiveCompliantStudent(deckId, cardInstanceIds, deckMap);
    } else if (studentIndex <= 5) {
      // ── ACTIVE AT-RISK tier (4-5): REVIEW state, sessions older than 7 days → homework NOT MET ──
      await seedActiveAtRiskStudent(deckId, cardInstanceIds, deckMap);
    } else if (studentIndex <= 13) {
      // ── STARTED tier (6-13): LEARNING state, 1-2 sessions older than 7 days ──
      await seedStartedStudent(deckId, cardInstanceIds, deckMap);
    }
    // else: NEW tier (14-19) — leave defaults, no sessions
  }

  // ── Homework Requirements ──
  console.log('Creating HomeworkRequirements...');

  for (const cls of classes) {
    await prisma.homeworkRequirement.create({
      data: {
        classId: cls.id,
        sessionsRequired: 3,
        minCardsPerSession: 10,
        periodDays: 7,
        alertThresholdDays: 2,
        activeFrom: daysAgo(30),
        activeTo: null,
        isActive: true,
      },
    });
  }

  // ── Summary ──
  console.log('\n=== SEED COMPLETE ===');
  console.log('Admin:      admin@test.com / password123');
  console.log('Teachers:   teacher1@test.com … teacher6@test.com / password123');
  console.log('Students:   student1@test.com … student240@test.com / password123');
  console.log('');
  console.log('Grade 11 classes: 11A-11F (teachers 1-3)');
  console.log('Grade 12 classes: 12A-12F (teachers 4-6)');
  console.log('');
  console.log('CardSets:');
  console.log('  DEPARTMENTAL MANDATORY: "Unit 1: Daily Life", "Unit 2: Travel & Places" (both grades)');
  console.log('  DEPARTMENTAL OPTIONAL:  "Unit 3: Emotions & Character" (both grades)');
  console.log('  PRIVATE (teacher1):     "Unit 4: Environment & Nature" (classes 11A, 11B only)');
  console.log('  PRIVATE (teacher4):     "Unit 5: Society & Culture" (classes 12A, 12B only)');
  console.log('=====================');
}

// ─────────────────────────────────────────────
// FSRS seeding helpers
// ─────────────────────────────────────────────

/** Shared helper: set all CardInstances in a deck to REVIEW state with realistic FSRS values. */
async function setReviewState(deckMap: Map<string, string>): Promise<void> {
  for (const [_cardId, ciId] of deckMap) {
    await prisma.cardInstance.update({
      where: { id: ciId },
      data: {
        state: FSRSState.REVIEW,
        stability: parseFloat(randomBetween(8, 30).toFixed(4)),
        difficulty: parseFloat(randomBetween(4, 7).toFixed(4)),
        retrievability: parseFloat(randomBetween(0.7, 0.99).toFixed(4)),
        reps: randomIntBetween(5, 15),
        lapses: randomIntBetween(0, 2),
        due: randomDate(daysAgo(1), daysFromNow(14)),
        lastReview: randomDate(daysAgo(7), daysAgo(1)),
      },
    });
  }
}

/** Shared helper: create one completed ReviewSession with weighted grades. */
async function createSession(
  deckId: string,
  cardInstanceIds: string[],
  startedAt: Date,
  eventsCount: number,
  gradeWeights: Array<{ grade: number; weight: number }>,
): Promise<void> {
  const endedAt = new Date(startedAt.getTime() + randomIntBetween(5, 25) * 60 * 1000);
  const sessionCardIds = shuffleArray([...cardInstanceIds]).slice(0, eventsCount);

  let correctCount = 0;
  const eventData: Array<{ grade: number; cardInstanceId: string }> = [];
  for (const ciId of sessionCardIds) {
    const grade = weightedGrade(gradeWeights);
    if (grade >= 3) correctCount++;
    eventData.push({ grade, cardInstanceId: ciId });
  }

  const accuracyRate = eventData.length > 0 ? correctCount / eventData.length : null;
  const session = await prisma.reviewSession.create({
    data: { deckId, startedAt, endedAt, cardsReviewed: eventData.length, accuracyRate },
  });

  const sessionDurationMs = endedAt.getTime() - startedAt.getTime();
  for (let i = 0; i < eventData.length; i++) {
    const reviewedAt = new Date(startedAt.getTime() + (i / eventData.length) * sessionDurationMs);
    await prisma.reviewEvent.create({
      data: {
        sessionId: session.id,
        cardInstanceId: eventData[i].cardInstanceId,
        grade: eventData[i].grade,
        responseTimeMs: randomIntBetween(1500, 8000),
        reviewedAt,
      },
    });
  }
}

const ACTIVE_GRADES = [
  { grade: 1, weight: 5 },
  { grade: 2, weight: 15 },
  { grade: 3, weight: 45 },
  { grade: 4, weight: 35 },
];

/**
 * ACTIVE COMPLIANT: REVIEW state, 2 older sessions (8-30 days ago) + 3 sessions
 * within the last 7 days → homework requirement MET.
 */
async function seedActiveCompliantStudent(
  deckId: string,
  cardInstanceIds: string[],
  deckMap: Map<string, string>,
): Promise<void> {
  await setReviewState(deckMap);

  // 2 older sessions (8-30 days ago) for history
  for (let s = 0; s < 2; s++) {
    const daysBack = randomBetween(10 + s * 8, 18 + s * 8);
    await createSession(deckId, cardInstanceIds, daysAgo(daysBack), randomIntBetween(10, 20), ACTIVE_GRADES);
  }

  // 3 sessions within the last 7 days (on distinct days: ~5, ~3, ~1 days ago)
  const recentOffsets = [randomBetween(4, 5.5), randomBetween(2, 3.5), randomBetween(0.5, 1.5)];
  for (const offset of recentOffsets) {
    await createSession(deckId, cardInstanceIds, daysAgo(offset), randomIntBetween(10, 20), ACTIVE_GRADES);
  }
}

/**
 * ACTIVE AT-RISK: REVIEW state, 3-5 sessions but all older than 7 days
 * → homework requirement NOT MET (lapsed).
 */
async function seedActiveAtRiskStudent(
  deckId: string,
  cardInstanceIds: string[],
  deckMap: Map<string, string>,
): Promise<void> {
  await setReviewState(deckMap);

  // 3-5 sessions, all between 8 and 30 days ago
  const sessionCount = randomIntBetween(3, 5);
  for (let s = 0; s < sessionCount; s++) {
    const daysBack = randomBetween(8 + s * 4, 14 + s * 4);
    await createSession(deckId, cardInstanceIds, daysAgo(daysBack), randomIntBetween(10, 20), ACTIVE_GRADES);
  }
}

/**
 * Updates CardInstances to LEARNING state and creates 1-2 completed ReviewSessions
 * with 5-15 ReviewEvents each.
 */
async function seedStartedStudent(
  deckId: string,
  cardInstanceIds: string[],
  deckMap: Map<string, string>,
): Promise<void> {
  // Update all card instances to LEARNING state
  for (const [_cardId, ciId] of deckMap) {
    await prisma.cardInstance.update({
      where: { id: ciId },
      data: {
        state: FSRSState.LEARNING,
        stability: parseFloat(randomBetween(1, 5).toFixed(4)),
        difficulty: parseFloat(randomBetween(5, 8).toFixed(4)),
        retrievability: parseFloat(randomBetween(0.4, 0.75).toFixed(4)),
        reps: randomIntBetween(1, 3),
        lapses: 0,
        due: randomDate(new Date(), daysFromNow(3)),
        lastReview: randomDate(daysAgo(3), daysAgo(1)),
      },
    });
  }

  // Create 1-2 completed sessions over the past 14 days
  const sessionCount = randomIntBetween(1, 2);

  for (let s = 0; s < sessionCount; s++) {
    const sessionDaysAgo = 14 - s * 7 - randomBetween(0, 3);
    const startedAt = daysAgo(Math.max(sessionDaysAgo, 0.1));
    const endedAt = new Date(startedAt.getTime() + randomIntBetween(3, 20) * 60 * 1000);

    const eventsCount = randomIntBetween(5, 15);
    const sessionCardIds = shuffleArray([...cardInstanceIds]).slice(0, eventsCount);

    let correctCount = 0;
    const eventData: Array<{ grade: number; cardInstanceId: string }> = [];

    for (const ciId of sessionCardIds) {
      // Started students have more varied performance
      const grade = weightedGrade([
        { grade: 1, weight: 20 },
        { grade: 2, weight: 30 },
        { grade: 3, weight: 35 },
        { grade: 4, weight: 15 },
      ]);
      if (grade >= 3) correctCount++;
      eventData.push({ grade, cardInstanceId: ciId });
    }

    const accuracyRate = eventData.length > 0 ? correctCount / eventData.length : null;

    const session = await prisma.reviewSession.create({
      data: {
        deckId,
        startedAt,
        endedAt,
        cardsReviewed: eventData.length,
        accuracyRate,
      },
    });

    const sessionDurationMs = endedAt.getTime() - startedAt.getTime();
    for (let i = 0; i < eventData.length; i++) {
      const reviewedAt = new Date(
        startedAt.getTime() + (i / eventData.length) * sessionDurationMs,
      );
      await prisma.reviewEvent.create({
        data: {
          sessionId: session.id,
          cardInstanceId: eventData[i].cardInstanceId,
          grade: eventData[i].grade,
          responseTimeMs: randomIntBetween(2000, 12000),
          reviewedAt,
        },
      });
    }
  }
}

// ─────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────

function randomDate(from: Date, to: Date): Date {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  return new Date(fromMs + Math.random() * (toMs - fromMs));
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

interface GradeWeight {
  grade: number;
  weight: number;
}

function weightedGrade(options: GradeWeight[]): number {
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
  let random = Math.random() * totalWeight;
  for (const option of options) {
    random -= option.weight;
    if (random <= 0) return option.grade;
  }
  return options[options.length - 1].grade;
}

// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  await wipe();
  await seed();
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Seed failed:', err);
    prisma.$disconnect();
    process.exit(1);
  });
