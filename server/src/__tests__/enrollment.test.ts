import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateEnrollRows, enrollStudents } from '../services/enrollment.service'

// ── validateEnrollRows (pure function, no mocking needed) ─────────────────────

describe('validateEnrollRows', () => {
  it('returns empty array for valid rows', () => {
    const errors = validateEnrollRows([
      { email: 'alice@school.edu', name: 'Alice' },
      { email: 'bob@school.edu', name: 'Bob' },
    ])
    expect(errors).toHaveLength(0)
  })

  it('flags missing name', () => {
    const errors = validateEnrollRows([{ email: 'alice@school.edu', name: '' }])
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/name/)
    expect(errors[0].row).toBe(1)
  })

  it('flags missing email', () => {
    const errors = validateEnrollRows([{ email: '', name: 'Alice' }])
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/email/)
  })

  it('flags invalid email format', () => {
    const errors = validateEnrollRows([{ email: 'not-an-email', name: 'Alice' }])
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/invalid email/)
    expect(errors[0].email).toBe('not-an-email')
  })

  it('flags multiple errors across multiple rows', () => {
    const errors = validateEnrollRows([
      { email: 'good@school.edu', name: 'Good' },
      { email: '', name: 'No Email' },
      { email: 'bad-email', name: 'Bad Email' },
      { email: 'ok@school.edu', name: '' },
    ])
    expect(errors).toHaveLength(3)
    expect(errors[0].row).toBe(2)
    expect(errors[1].row).toBe(3)
    expect(errors[2].row).toBe(4)
  })

  it('handles whitespace-only name as missing', () => {
    const errors = validateEnrollRows([{ email: 'alice@school.edu', name: '   ' }])
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/name/)
  })

  it('returns empty array for empty input', () => {
    expect(validateEnrollRows([])).toHaveLength(0)
  })
})

// ── enrollStudents (mocked Prisma) ────────────────────────────────────────────

// Minimal Prisma mock — only models/methods used by enrollStudents
function makePrisma({
  existingUser = null as null | { id: string; email: string },
  existingStudent = null as null | { id: string; userId: string },
  existingEnrollment = null as null | { id: string; archivedAt?: Date | null; deck?: { id: string } | null },
  mandatoryCardIds = [] as string[],
} = {}) {
  // Track created student so findUnique returns it after create (mirrors real DB behaviour)
  let createdStudent: { id: string; userId: string } | null = null

  const newStudentRecord = { id: 'student-new', userId: existingUser?.id ?? 'user-new' }

  const txMock = {
    user: {
      findUnique: vi.fn().mockResolvedValue(existingUser),
      create: vi.fn().mockResolvedValue({ id: 'user-new', email: 'test@test.com', name: 'Test' }),
    },
    student: {
      findUnique: vi.fn().mockImplementation(() =>
        Promise.resolve(createdStudent ?? existingStudent),
      ),
      create: vi.fn().mockImplementation(() => {
        createdStudent = newStudentRecord
        return Promise.resolve(newStudentRecord)
      }),
    },
    enrollment: {
      findUnique: vi.fn().mockResolvedValue(existingEnrollment),
      create: vi.fn().mockResolvedValue({ id: 'enrollment-new', studentId: 'student-new', classId: 'class-1' }),
      update: vi.fn().mockResolvedValue({ id: existingEnrollment?.id, archivedAt: null }),
    },
    deck: {
      create: vi.fn().mockResolvedValue({ id: 'deck-new', enrollmentId: 'enrollment-new' }),
    },
    cardInstance: {
      createMany: vi.fn().mockResolvedValue({ count: mandatoryCardIds.length }),
    },
  }

  const prisma = {
    assignment: {
      findMany: vi.fn().mockResolvedValue(
        mandatoryCardIds.length > 0
          ? [{ cardSet: { cards: mandatoryCardIds.map((id) => ({ id })) } }]
          : [],
      ),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
    _tx: txMock,
  }

  return prisma
}

describe('enrollStudents', () => {
  it('creates user, student, enrollment, deck for a new student', async () => {
    const prisma = makePrisma()
    const results = await enrollStudents(prisma as any, 'class-1', [
      { email: 'new@school.edu', name: 'New Student' },
    ], 'actor-1')

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('created')
    expect(results[0].tempPassword).toBeDefined()
    expect(results[0].email).toBe('new@school.edu')
    expect(results[0].name).toBe('New Student')

    expect(prisma._tx.user.create).toHaveBeenCalledOnce()
    expect(prisma._tx.student.create).toHaveBeenCalledOnce()
    expect(prisma._tx.enrollment.create).toHaveBeenCalledOnce()
    expect(prisma._tx.deck.create).toHaveBeenCalledOnce()
  })

  it('returns already_enrolled when student is already in the class', async () => {
    const prisma = makePrisma({
      existingUser: { id: 'user-1', email: 'existing@school.edu' },
      existingStudent: { id: 'student-1', userId: 'user-1' },
      existingEnrollment: { id: 'enrollment-1' },
    })

    const results = await enrollStudents(prisma as any, 'class-1', [
      { email: 'existing@school.edu', name: 'Existing' },
    ], 'actor-1')

    expect(results[0].status).toBe('already_enrolled')
    expect(results[0].tempPassword).toBeUndefined()
    expect(prisma._tx.enrollment.create).not.toHaveBeenCalled()
    expect(prisma._tx.deck.create).not.toHaveBeenCalled()
  })

  it('reactivates a previously-unenrolled (archived) enrollment instead of erroring or duplicating', async () => {
    const prisma = makePrisma({
      existingUser: { id: 'user-1', email: 'existing@school.edu' },
      existingStudent: { id: 'student-1', userId: 'user-1' },
      existingEnrollment: { id: 'enrollment-1', archivedAt: new Date('2026-01-01'), deck: { id: 'deck-1' } },
      mandatoryCardIds: ['card-1'],
    })

    const results = await enrollStudents(prisma as any, 'class-1', [
      { email: 'existing@school.edu', name: 'Existing' },
    ], 'actor-1')

    expect(results[0].status).toBe('enrolled')
    expect(prisma._tx.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enrollment-1' },
      data: { archivedAt: null },
    })
    // Should not create a new Enrollment/Deck row — reuses the archived one
    expect(prisma._tx.enrollment.create).not.toHaveBeenCalled()
    expect(prisma._tx.deck.create).not.toHaveBeenCalled()
    // Picks up mandatory assignments added while archived, into the existing deck
    expect(prisma._tx.cardInstance.createMany).toHaveBeenCalledWith({
      data: [{ deckId: 'deck-1', cardId: 'card-1', origin: 'TEACHER_ASSIGNED' }],
      skipDuplicates: true,
    })
  })

  it('enrolls existing user without creating a new User row', async () => {
    const prisma = makePrisma({
      existingUser: { id: 'user-1', email: 'existing@school.edu' },
      existingStudent: { id: 'student-1', userId: 'user-1' },
    })

    const results = await enrollStudents(prisma as any, 'class-1', [
      { email: 'existing@school.edu', name: 'Existing' },
    ], 'actor-1')

    expect(results[0].status).toBe('enrolled')
    expect(results[0].tempPassword).toBeUndefined()
    expect(prisma._tx.user.create).not.toHaveBeenCalled()
    expect(prisma._tx.enrollment.create).toHaveBeenCalledOnce()
  })

  it('creates Student profile for a user who has no student record yet', async () => {
    // e.g. a former teacher being enrolled as a student
    const prisma = makePrisma({
      existingUser: { id: 'user-1', email: 'teacher@school.edu' },
      existingStudent: null,
    })

    const results = await enrollStudents(prisma as any, 'class-1', [
      { email: 'teacher@school.edu', name: 'Teacher Turned Student' },
    ], 'actor-1')

    expect(results[0].status).toBe('enrolled')
    expect(prisma._tx.user.create).not.toHaveBeenCalled()
    expect(prisma._tx.student.create).toHaveBeenCalledOnce()
  })

  it('creates CardInstances for MANDATORY assignments on new enrollment', async () => {
    const prisma = makePrisma({ mandatoryCardIds: ['card-1', 'card-2', 'card-3'] })

    await enrollStudents(prisma as any, 'class-1', [
      { email: 'new@school.edu', name: 'New' },
    ], 'actor-1')

    expect(prisma._tx.cardInstance.createMany).toHaveBeenCalledOnce()
    const call = prisma._tx.cardInstance.createMany.mock.calls[0][0]
    expect(call.data).toHaveLength(3)
    expect(call.data[0].origin).toBe('TEACHER_ASSIGNED')
    expect(call.skipDuplicates).toBe(true)
  })

  it('skips CardInstance creation when class has no MANDATORY assignments', async () => {
    const prisma = makePrisma({ mandatoryCardIds: [] })

    await enrollStudents(prisma as any, 'class-1', [
      { email: 'new@school.edu', name: 'New' },
    ], 'actor-1')

    expect(prisma._tx.cardInstance.createMany).not.toHaveBeenCalled()
  })

  it('processes multiple rows independently — error on one does not abort others', async () => {
    const prisma = makePrisma()
    // Make the transaction fail on second call
    let callCount = 0
    prisma.$transaction = vi.fn().mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
      callCount++
      if (callCount === 2) throw new Error('DB exploded')
      return fn(prisma._tx)
    })

    const results = await enrollStudents(prisma as any, 'class-1', [
      { email: 'first@school.edu', name: 'First' },
      { email: 'second@school.edu', name: 'Second' },
      { email: 'third@school.edu', name: 'Third' },
    ], 'actor-1')

    expect(results).toHaveLength(3)
    expect(results[0].status).toBe('created')
    expect(results[1].status).toBe('error')
    expect(results[1].error).toMatch(/DB exploded/)
    expect(results[2].status).toBe('created')
  })

  it('loads MANDATORY assignments once before processing all rows', async () => {
    const prisma = makePrisma()

    await enrollStudents(prisma as any, 'class-1', [
      { email: 'a@school.edu', name: 'A' },
      { email: 'b@school.edu', name: 'B' },
      { email: 'c@school.edu', name: 'C' },
    ], 'actor-1')

    // Should query assignments exactly once regardless of number of students
    expect(prisma.assignment.findMany).toHaveBeenCalledOnce()
  })
})
