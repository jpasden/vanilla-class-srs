/**
 * purge-department.ts — surgically remove one Department and everything that
 * exists ONLY because of it. Unlike wipe.ts (which empties the entire database),
 * this is scoped and refuses to cascade into data you want to keep.
 *
 * Usage:
 *   npm run purge -- --department "Test"                            # dry run (default)
 *   npm run purge -- --department "Test" --execute                  # actually delete
 *   npm run purge -- --department "Test" --user admin@test.com --execute
 *
 * Users are deleted only if they become ORPHANED — a student with no remaining
 * enrollments anywhere, or a teacher with no remaining classes or subject-grade
 * memberships anywhere. Anyone who also exists in a department you're keeping is
 * left completely alone.
 *
 * --user <email> additionally removes a specific user (repeatable). Intended for
 * bare admin accounts that have no Teacher/Student profile and so can't be
 * detected as orphans. Refuses if that user still owns anything outside scope.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const EXECUTE = argv.includes('--execute')

function argValues(flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1])
  }
  return out
}

const DEPARTMENT = argValues('--department')[0]
const EXTRA_USER_EMAILS = argValues('--user')

if (!DEPARTMENT) {
  console.error('\nERROR: --department "<name>" is required.\n')
  console.error('  npm run purge -- --department "Test"            (dry run)')
  console.error('  npm run purge -- --department "Test" --execute  (delete)\n')
  process.exit(1)
}

const n = (label: string, count: number) =>
  console.log(`   ${String(count).padStart(6)}  ${label}`)

async function main() {
  console.log(`\n${'='.repeat(66)}`)
  console.log(EXECUTE ? '  PURGE — EXECUTING' : '  PURGE — DRY RUN (nothing will be deleted)')
  console.log('='.repeat(66))

  // ── Resolve the department ────────────────────────────────────────────────
  const depts = await prisma.department.findMany({ where: { name: DEPARTMENT } })
  if (depts.length === 0) {
    const all = await prisma.department.findMany({ select: { name: true } })
    console.error(`\nERROR: no department named "${DEPARTMENT}".`)
    console.error(`Found: ${all.map((d) => `"${d.name}"`).join(', ')}\n`)
    process.exit(1)
  }
  if (depts.length > 1) {
    console.error(`\nERROR: ${depts.length} departments named "${DEPARTMENT}". Resolve by hand.\n`)
    process.exit(1)
  }
  const dept = depts[0]

  const keeping = await prisma.department.findMany({
    where: { id: { not: dept.id } },
    select: { name: true },
  })
  console.log(`\nTarget:  "${dept.name}"`)
  console.log(`Keeping: ${keeping.map((d) => `"${d.name}"`).join(', ') || '(none)'}\n`)

  // ── Scope ─────────────────────────────────────────────────────────────────
  const sgIds = (await prisma.subjectGrade.findMany({
    where: { departmentId: dept.id }, select: { id: true },
  })).map((s) => s.id)

  const classes = await prisma.class.findMany({
    where: { subjectGradeId: { in: sgIds } },
    select: { id: true, teacherId: true },
  })
  const classIds = classes.map((c) => c.id)

  const enrollments = await prisma.enrollment.findMany({
    where: { classId: { in: classIds } },
    select: { id: true, studentId: true },
  })
  const enrollmentIds = enrollments.map((e) => e.id)
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))]

  const decks = await prisma.deck.findMany({
    where: { enrollmentId: { in: enrollmentIds } }, select: { id: true },
  })
  const deckIds = decks.map((d) => d.id)

  const sessions = await prisma.reviewSession.findMany({
    where: { deckId: { in: deckIds } }, select: { id: true },
  })
  const sessionIds = sessions.map((s) => s.id)

  const hwReqs = await prisma.homeworkRequirement.findMany({
    where: { classId: { in: classIds } }, select: { id: true },
  })
  const hwIds = hwReqs.map((h) => h.id)

  // Teachers reachable from this department (via membership or class ownership)
  const memberTeacherIds = (await prisma.teacherSubjectGrade.findMany({
    where: { subjectGradeId: { in: sgIds } }, select: { teacherId: true },
  })).map((m) => m.teacherId)
  const candidateTeacherIds = [...new Set([...memberTeacherIds, ...classes.map((c) => c.teacherId)])]

  // Teachers who keep nothing outside this department
  const orphanTeacherIds: string[] = []
  for (const tid of candidateTeacherIds) {
    const otherClasses = await prisma.class.count({
      where: { teacherId: tid, subjectGradeId: { notIn: sgIds } },
    })
    const otherMemberships = await prisma.teacherSubjectGrade.count({
      where: { teacherId: tid, subjectGradeId: { notIn: sgIds } },
    })
    if (otherClasses === 0 && otherMemberships === 0) orphanTeacherIds.push(tid)
  }

  // CardSets belonging to this department: personal sets tied to in-scope
  // enrollments, departmental sets in these SGs, and private sets owned by
  // teachers who are being removed entirely.
  const scopedCardSets = await prisma.cardSet.findMany({
    where: {
      OR: [
        { enrollmentId: { in: enrollmentIds } },
        { subjectGradeId: { in: sgIds } },
      ],
    },
    select: { id: true },
  })
  const orphanTeacherSets = await prisma.cardSet.findMany({
    where: { teacherId: { in: orphanTeacherIds }, status: 'PRIVATE', isPersonal: false },
    select: { id: true },
  })

  const cardSetIds = [...new Set([...scopedCardSets, ...orphanTeacherSets].map((c) => c.id))]
  const cardIds = (await prisma.card.findMany({
    where: { cardSetId: { in: cardSetIds } }, select: { id: true },
  })).map((c) => c.id)

  // Students with no enrollment outside this department
  const orphanStudentIds: string[] = []
  for (const sid of studentIds) {
    const other = await prisma.enrollment.count({
      where: { studentId: sid, classId: { notIn: classIds } },
    })
    if (other === 0) orphanStudentIds.push(sid)
  }

  const orphanTeacherUserIds = (await prisma.teacher.findMany({
    where: { id: { in: orphanTeacherIds } }, select: { userId: true },
  })).map((t) => t.userId)
  const orphanStudentUserIds = (await prisma.student.findMany({
    where: { id: { in: orphanStudentIds } }, select: { userId: true },
  })).map((s) => s.userId)

  // A user may hold both profiles — only delete the User if BOTH are going
  const userIdsToDelete: string[] = []
  for (const uid of [...new Set([...orphanTeacherUserIds, ...orphanStudentUserIds])]) {
    const t = await prisma.teacher.findUnique({ where: { userId: uid }, select: { id: true } })
    const s = await prisma.student.findUnique({ where: { userId: uid }, select: { id: true } })
    const teacherGoing = !t || orphanTeacherIds.includes(t.id)
    const studentGoing = !s || orphanStudentIds.includes(s.id)
    if (teacherGoing && studentGoing) userIdsToDelete.push(uid)
  }

  // Explicit --user targets (bare admins with no profile)
  for (const email of EXTRA_USER_EMAILS) {
    const u = await prisma.user.findUnique({
      where: { email }, select: { id: true, name: true, role: true },
    })
    if (!u) { console.log(`   note: --user ${email} not found, skipping`); continue }
    const t = await prisma.teacher.findUnique({ where: { userId: u.id }, select: { id: true } })
    const s = await prisma.student.findUnique({ where: { userId: u.id }, select: { id: true } })
    if (t && !orphanTeacherIds.includes(t.id)) {
      console.error(`\nERROR: ${email} has a Teacher profile with data outside "${dept.name}". Aborting.\n`)
      process.exit(1)
    }
    if (s && !orphanStudentIds.includes(s.id)) {
      console.error(`\nERROR: ${email} has a Student profile with data outside "${dept.name}". Aborting.\n`)
      process.exit(1)
    }
    if (!userIdsToDelete.includes(u.id)) userIdsToDelete.push(u.id)
    console.log(`   explicit user: ${email} (${u.name}, ${u.role})`)
  }

  // ── Entanglement checks — refuse rather than cascade ──────────────────────
  console.log('\nSafety checks:')

  const strayInstances = await prisma.cardInstance.count({
    where: { cardId: { in: cardIds }, deckId: { notIn: deckIds } },
  })
  const strayAssignments = await prisma.assignment.findMany({
    where: { cardSetId: { in: cardSetIds }, classId: { notIn: classIds } },
    include: { cardSet: { select: { name: true } }, class: { select: { name: true } } },
  })
  const straySGA = await prisma.subjectGradeAssignment.count({
    where: { cardSetId: { in: cardSetIds }, subjectGradeId: { notIn: sgIds } },
  })

  let blocked = false
  if (strayInstances > 0) {
    console.log(`   x  ${strayInstances} card instances outside this department use its cards`)
    blocked = true
  } else console.log('   ok no outside decks depend on these cards')

  if (strayAssignments.length > 0) {
    console.log(`   x  ${strayAssignments.length} assignments to outside classes use these card sets:`)
    for (const a of strayAssignments) console.log(`        "${a.cardSet.name}" -> class "${a.class.name}"`)
    blocked = true
  } else console.log('   ok no outside classes are assigned these card sets')

  if (straySGA > 0) {
    console.log(`   x  ${straySGA} subject-grade assignments outside this department use these card sets`)
    blocked = true
  } else console.log('   ok no outside subject grades reference these card sets')

  // ── Plan ──────────────────────────────────────────────────────────────────
  console.log('\nWill delete:')
  n('ReviewEvent', await prisma.reviewEvent.count({ where: { sessionId: { in: sessionIds } } }))
  n('ReviewSession', sessionIds.length)
  n('CardInstance', await prisma.cardInstance.count({ where: { deckId: { in: deckIds } } }))
  n('Deck', deckIds.length)
  n('HomeworkRequirementCardSet', await prisma.homeworkRequirementCardSet.count({ where: { homeworkRequirementId: { in: hwIds } } }))
  n('HomeworkRequirement', hwIds.length)
  n('Assignment', await prisma.assignment.count({ where: { classId: { in: classIds } } }))
  n('SubjectGradeAssignment', await prisma.subjectGradeAssignment.count({ where: { subjectGradeId: { in: sgIds } } }))
  n('Card', cardIds.length)
  n('CardSet', cardSetIds.length)
  n('Enrollment', enrollmentIds.length)
  n('Class', classIds.length)
  n('TeacherSubjectGrade', await prisma.teacherSubjectGrade.count({ where: { subjectGradeId: { in: sgIds } } }))
  n('Teacher (orphaned)', orphanTeacherIds.length)
  n('Student (orphaned)', orphanStudentIds.length)
  n('User (orphaned)', userIdsToDelete.length)
  n('SubjectGrade', sgIds.length)
  n('Department', 1)

  const keptTeachers = candidateTeacherIds.length - orphanTeacherIds.length
  const keptStudents = studentIds.length - orphanStudentIds.length
  if (keptTeachers > 0 || keptStudents > 0) {
    console.log(`\nPreserved (they also exist outside "${dept.name}"):`)
    if (keptTeachers > 0) n('teachers kept', keptTeachers)
    if (keptStudents > 0) n('students kept', keptStudents)
  }

  if (blocked) {
    console.error('\nABORTED — this data is entangled with data you are keeping.')
    console.error('Un-assign the card sets listed above, then re-run.\n')
    process.exit(1)
  }

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to apply.\n')
    return
  }

  // ── Delete, FK-safe order, one transaction ────────────────────────────────
  console.log('\nDeleting...')
  await prisma.$transaction(async (tx) => {
    await tx.reviewEvent.deleteMany({ where: { sessionId: { in: sessionIds } } })
    await tx.reviewSession.deleteMany({ where: { id: { in: sessionIds } } })
    await tx.cardInstance.deleteMany({ where: { deckId: { in: deckIds } } })
    await tx.deck.deleteMany({ where: { id: { in: deckIds } } })
    await tx.homeworkRequirementCardSet.deleteMany({ where: { homeworkRequirementId: { in: hwIds } } })
    await tx.homeworkRequirement.deleteMany({ where: { id: { in: hwIds } } })
    await tx.assignment.deleteMany({ where: { classId: { in: classIds } } })
    await tx.subjectGradeAssignment.deleteMany({ where: { subjectGradeId: { in: sgIds } } })
    await tx.card.deleteMany({ where: { id: { in: cardIds } } })
    await tx.cardSet.deleteMany({ where: { id: { in: cardSetIds } } })
    await tx.enrollment.deleteMany({ where: { id: { in: enrollmentIds } } })
    await tx.class.deleteMany({ where: { id: { in: classIds } } })
    await tx.teacherSubjectGrade.deleteMany({ where: { subjectGradeId: { in: sgIds } } })
    await tx.teacher.deleteMany({ where: { id: { in: orphanTeacherIds } } })
    await tx.student.deleteMany({ where: { id: { in: orphanStudentIds } } })
    await tx.passwordResetToken.deleteMany({ where: { userId: { in: userIdsToDelete } } })
    await tx.user.deleteMany({ where: { id: { in: userIdsToDelete } } })
    await tx.subjectGrade.deleteMany({ where: { id: { in: sgIds } } })
    await tx.department.delete({ where: { id: dept.id } })
  }, { timeout: 120_000 })

  console.log(`\nDone. "${dept.name}" removed.\n`)
}

main()
  .catch((err) => { console.error('\nFAILED:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
