import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Terminal rendering
// ─────────────────────────────────────────────

const TOTAL_CHECKS = 52;
const BAR_WIDTH    = 40;

let passed       = 0;
let failed       = 0;
let completed    = 0;
let currentSection = '';

// Reserve one line at the top for the progress bar.
// We print the bar first, then all check output scrolls below it.
// After each check we move up, redraw the bar, and move back down.

function drawBar(): void {
  const done    = passed + failed;
  const fill    = Math.round((done / TOTAL_CHECKS) * BAR_WIDTH);
  const empty   = BAR_WIDTH - fill;
  const pct     = Math.round((done / TOTAL_CHECKS) * 100);
  const bar     = '█'.repeat(fill) + '░'.repeat(empty);
  const status  = failed > 0
    ? `\x1b[31m${passed} passed, ${failed} failed\x1b[0m`
    : `\x1b[32m${passed} passed\x1b[0m`;

  // Move to column 0, overwrite the bar line
  process.stdout.write(`\r\x1b[K[${bar}] ${pct}%  ${status}`);
}

function printCheck(ok: boolean, label: string, detail: string): void {
  const symbol = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  // Move to a new line below the bar, print the check, then redraw the bar
  process.stdout.write(`\n  ${symbol} ${label}${detail ? ': ' + detail : ''}`);
  // Move cursor up to the bar line, redraw, then move back down
  process.stdout.write(`\x1b[${1}A\r`);
  drawBar();
  process.stdout.write(`\x1b[${1}B`);
}

function printSection(title: string): void {
  process.stdout.write(`\n\n\x1b[1m── ${title}\x1b[0m`);
  // Move up, redraw bar, move back down 2 (section header took 2 lines via \n\n)
  process.stdout.write(`\x1b[2A\r`);
  drawBar();
  process.stdout.write(`\x1b[2B`);
  currentSection = title;
}

// ─────────────────────────────────────────────
// Check runner
// ─────────────────────────────────────────────

async function check(
  label: string,
  query: () => Promise<number | boolean>,
  expected: number | boolean,
): Promise<void> {
  const actual = await query();
  const ok     = actual === expected;
  ok ? passed++ : failed++;
  completed++;

  const detail = ok
    ? String(actual)
    : `\x1b[31mgot ${actual}, expected ${expected}\x1b[0m`;

  printCheck(ok, label, detail);
}

// ─────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────

async function verify(): Promise<void> {
  // Print header then the initial (empty) bar on its own line
  process.stdout.write('=== SEED VERIFICATION ===\n');
  drawBar();

  // ── Users
  printSection('Users');
  await check('Total users',              () => prisma.user.count(),                                   247);
  await check('Admin users',              () => prisma.user.count({ where: { role: 'ADMIN' } }),       1);
  await check('Teacher users',            () => prisma.user.count({ where: { role: 'TEACHER' } }),     6);
  await check('Student users',            () => prisma.user.count({ where: { role: 'STUDENT' } }),     240);
  await check('admin@test.com exists',    () => prisma.user.findUnique({ where: { email: 'admin@test.com' } }).then(u => !!u),     true);
  await check('Admin name is Sarah Chen', () => prisma.user.findUnique({ where: { email: 'admin@test.com' } }).then(u => u?.name === 'Sarah Chen'), true);
  await check('teacher1@test.com exists', () => prisma.user.findUnique({ where: { email: 'teacher1@test.com' } }).then(u => !!u), true);
  await check('teacher6@test.com exists', () => prisma.user.findUnique({ where: { email: 'teacher6@test.com' } }).then(u => !!u), true);
  await check('student1@test.com exists',   () => prisma.user.findUnique({ where: { email: 'student1@test.com' } }).then(u => !!u),   true);
  await check('student240@test.com exists', () => prisma.user.findUnique({ where: { email: 'student240@test.com' } }).then(u => !!u), true);

  // ── Org Structure
  printSection('Org Structure');
  await check('Departments',                    () => prisma.department.count(),   1);
  await check('SubjectGrades',                  () => prisma.subjectGrade.count(), 2);
  await check('"English B HL Grade 11" exists', () => prisma.subjectGrade.findFirst({ where: { name: 'English B HL Grade 11' } }).then(sg => !!sg), true);
  await check('"English B HL Grade 12" exists', () => prisma.subjectGrade.findFirst({ where: { name: 'English B HL Grade 12' } }).then(sg => !!sg), true);

  // ── Teachers & Classes
  printSection('Teachers & Classes');
  await check('Teacher profiles',         () => prisma.teacher.count(), 6);
  await check('Classes (2 per teacher)',  () => prisma.class.count(),   12);
  await check('TeacherSubjectGrade rows', () => prisma.teacherSubjectGrade.count(), 6);
  await check('No teacher has 0 classes', () => prisma.teacher.findMany({ where: { classes: { none: {} } } }).then(r => r.length), 0);
  await check('All teachers have exactly 2 classes', async () => {
    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) AS cnt FROM "Class" c
      GROUP BY c."teacherId"
      HAVING COUNT(*) <> 2
    `;
    return rows.length;
  }, 0);

  // ── Students & Enrollments
  printSection('Students & Enrollments');
  await check('Student profiles',              () => prisma.student.count(),    240);
  await check('Enrollments (1 per student)',   () => prisma.enrollment.count(), 240);
  await check('Decks (1 per enrollment)',      () => prisma.deck.count(),       240);
  await check('Every enrollment has a deck',   () => prisma.enrollment.count({ where: { deck: null } }), 0);
  await check('All classes have exactly 20 students', async () => {
    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) AS cnt FROM "Enrollment" e
      GROUP BY e."classId"
      HAVING COUNT(*) <> 20
    `;
    return rows.length;
  }, 0);

  // ── CardSets & Cards
  printSection('CardSets & Cards');
  await check('Total CardSets',           () => prisma.cardSet.count(),                                     5);
  await check('Total Cards (5×20)',       () => prisma.card.count(),                                        100);
  await check('DEPARTMENTAL CardSets',    () => prisma.cardSet.count({ where: { status: 'DEPARTMENTAL' } }), 3);
  await check('PRIVATE CardSets',         () => prisma.cardSet.count({ where: { status: 'PRIVATE' } }),      2);
  await check('Personal CardSets (none)', () => prisma.cardSet.count({ where: { isPersonal: true } }),       0);
  await check('All cards have at least one definition', () => prisma.card.count({ where: { definitionL1: null, definitionL2: null } }), 0);

  // ── Assignments
  printSection('Assignments');
  await check('Total Assignments',             () => prisma.assignment.count(),                                40);
  await check('MANDATORY Assignments',         () => prisma.assignment.count({ where: { type: 'MANDATORY' } }), 28);
  await check('OPTIONAL Assignments',          () => prisma.assignment.count({ where: { type: 'OPTIONAL' } }),  12);
  await check('SubjectGradeAssignments (3×2)', () => prisma.subjectGradeAssignment.count(),                    6);

  // ── CardInstances
  printSection('CardInstances');
  await check('Total CardInstances',   () => prisma.cardInstance.count(),                                11200);
  await check('NEW instances',         () => prisma.cardInstance.count({ where: { state: 'NEW' } }),      3360);
  await check('LEARNING instances',    () => prisma.cardInstance.count({ where: { state: 'LEARNING' } }), 4480);
  await check('REVIEW instances',      () => prisma.cardInstance.count({ where: { state: 'REVIEW' } }),   3360);
  await check('No OPTIONAL-origin instances', () => prisma.cardInstance.count({ where: { origin: 'OPTIONAL' } }), 0);

  // ── Review History
  printSection('Review History');
  await check('ReviewSessions > 0', () => prisma.reviewSession.count().then(n => n > 0), true);
  await check('ReviewEvents > 0',   () => prisma.reviewEvent.count().then(n => n > 0),   true);
  await check('No abandoned/open sessions', () => prisma.reviewSession.count({ where: { endedAt: null } }), 0);
  await check('All ReviewEvent grades are 1–4', async () => {
    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) AS cnt FROM "ReviewEvent" WHERE grade < 1 OR grade > 4
    `;
    return Number(rows[0].cnt);
  }, 0);
  await check('Active-tier decks (3+ sessions) = 72', async () => {
    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) AS cnt FROM (
        SELECT d.id FROM "Deck" d
        LEFT JOIN "ReviewSession" s ON s."deckId" = d.id
        GROUP BY d.id HAVING COUNT(s.id) >= 3
      ) sub
    `;
    return Number(rows[0].cnt);
  }, 72);
  await check('New-tier decks (0 sessions) = 72', async () => {
    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) AS cnt FROM (
        SELECT d.id FROM "Deck" d
        LEFT JOIN "ReviewSession" s ON s."deckId" = d.id
        GROUP BY d.id HAVING COUNT(s.id) = 0
      ) sub
    `;
    return Number(rows[0].cnt);
  }, 72);

  // ── Homework Requirements
  printSection('Homework Requirements');
  await check('HomeworkRequirements (1 per class)', () => prisma.homeworkRequirement.count(),                              12);
  await check('All HomeworkRequirements active',    () => prisma.homeworkRequirement.count({ where: { isActive: true } }), 12);
  await check('sessionsRequired = 3',    () => prisma.homeworkRequirement.findFirst().then(h => h?.sessionsRequired   === 3),  true);
  await check('minCardsPerSession = 10', () => prisma.homeworkRequirement.findFirst().then(h => h?.minCardsPerSession === 10), true);
  await check('periodDays = 7',          () => prisma.homeworkRequirement.findFirst().then(h => h?.periodDays         === 7),  true);
  await check('alertThresholdDays = 2',  () => prisma.homeworkRequirement.findFirst().then(h => h?.alertThresholdDays === 2),  true);
  await check('activeTo is null',        () => prisma.homeworkRequirement.findFirst().then(h => h?.activeTo === null),         true);

  // ── Final bar + summary
  process.stdout.write('\n\n');
  drawBar();
  process.stdout.write('\n');

  if (failed === 0) {
    console.log(`\n\x1b[32m✓ All ${passed} checks passed.\x1b[0m`);
  } else {
    console.log(`\n\x1b[31m✗ ${failed} check(s) FAILED, ${passed} passed.\x1b[0m`);
    process.exit(1);
  }
}

verify()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('\nVerification error:', err);
    prisma.$disconnect();
    process.exit(1);
  });
