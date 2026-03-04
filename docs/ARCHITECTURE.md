# Architecture

## Overview

Vanilla Class SRS is a monorepo with three packages:

| Package | Tech | Role |
|---|---|---|
| `client` | React 18, Vite, TypeScript | Browser UI |
| `server` | Node.js, Express, TypeScript | REST API + business logic |
| `shared` | TypeScript | Shared types, FSRS engine |

The database is PostgreSQL, accessed via Prisma ORM. All scheduling logic runs server-side.

---

## Organizational Hierarchy

```
Department
  └── SubjectGrade         (e.g. "English B HL Grade 12")
        ├── Teacher         (can belong to multiple SubjectGrades)
        │     └── Class     (e.g. "Class 12A")
        │           └── Enrollment  ──► Student
        │                             └── Deck  (one per Enrollment)
        │                                   └── CardInstance  (FSRS state per card)
        │
        └── CardSet [DEPARTMENTAL]   (admin-promoted; visible to all teachers in SubjectGrade)
```

A **Teacher** creates **CardSets** (initially PRIVATE). An admin can promote a CardSet to DEPARTMENTAL, making it visible to all teachers in the same SubjectGrade.

A **Class** has **Assignments** — links between the class and a CardSet, either MANDATORY or OPTIONAL.

When a MANDATORY Assignment is created, **CardInstances** are immediately created for all enrolled students. This is done atomically in a transaction.

A **Student** has one **Deck** per Enrollment. The Deck holds per-card FSRS state and per-deck scheduling parameters.

---

## Data Model

### Users & Auth

```
User
  ├── id, email, passwordHash, name, role, mustChangePassword
  ├── teacherProfile → Teacher
  ├── studentProfile → Student
  └── passwordResetTokens → PasswordResetToken[]

PasswordResetToken
  └── tokenHash (SHA-256 of emailed raw token), expiresAt, usedAt
```

Roles: `ADMIN`, `TEACHER`, `STUDENT`. A teacher can be promoted to admin. Students cannot be admins.

### Org Structure

```
Department
  └── SubjectGrade
        ├── TeacherSubjectGrade (many-to-many join: Teacher ↔ SubjectGrade)
        ├── Class
        │     ├── Enrollment (join: Student ↔ Class)
        │     ├── Assignment (join: Class ↔ CardSet)
        │     └── HomeworkRequirement
        └── SubjectGradeAssignment (admin pushes CardSet to all teachers in SubjectGrade)
```

Soft deletes: Departments, SubjectGrades, and Classes have an `archivedAt` field. Records are never hard-deleted.

### Cards

```
CardSet
  ├── status: PRIVATE | DEPARTMENTAL
  ├── teacherId (attribution; edit rights transfer to admin on promotion)
  ├── subjectGradeId (set on promotion to DEPARTMENTAL)
  ├── isPersonal + enrollmentId (for student-owned personal sets)
  └── cards → Card[]

Card
  ├── word, pos, definitionL2, definitionL1, exampleSentence
  └── instances → CardInstance[]
```

**Card display rule (front/back):**
- Front: `word` + `pos` (if present)
- Back: `definitionL2` (if present), then `definitionL1`, then `exampleSentence` (student override takes priority over Card default)

### Deck & FSRS State

```
Deck
  ├── enrollmentId (one Deck per Enrollment)
  ├── fsrsParams: { requestRetention, maximumInterval, w[], newCardsPerDay }
  ├── instances → CardInstance[]
  └── sessions → ReviewSession[]

CardInstance
  ├── deckId, cardId
  ├── origin: TEACHER_ASSIGNED | OPTIONAL | STUDENT_ADDED
  ├── exampleSentence (student override; null = use Card.exampleSentence)
  ├── FSRS state: stability, difficulty, retrievability, due, lastReview, reps, lapses, state
  └── reviewEvents → ReviewEvent[]
```

FSRS states: `NEW → LEARNING → REVIEW` (stable), `REVIEW → RELEARNING` (on lapse).

### Review

```
ReviewSession
  ├── deckId, startedAt, endedAt (null = in progress or abandoned)
  ├── cardsReviewed, accuracyRate
  └── events → ReviewEvent[]

ReviewEvent
  ├── sessionId, cardInstanceId
  ├── grade: 1 (Again) | 2 (Hard) | 3 (Good) | 4 (Easy)
  └── responseTimeMs
```

---

## Review Session Flow

```
POST /api/students/review/start
  1. Close any open session (endedAt = now, calculate accuracyRate from existing events)
  2. Build card queue:
       a. Due cards (state ≠ NEW, due ≤ now) — ascending due date
       b. New cards (state = NEW) — by Assignment.priority, up to daily new-card limit
  3. Return ordered SessionCard[]

POST /api/students/review/grade  (called per card)
  1. Apply FSRS v5 algorithm → new stability, difficulty, due date
  2. Write ReviewEvent
  3. Lapse logic: grade=1 → re-queue card once. Second grade=1 = no re-queue
  4. Return { requeue: boolean }

POST /api/students/review/finish
  1. Set endedAt, calculate accuracyRate, set cardsReviewed
```

Session ends when: (a) queue exhausted, OR (b) student clicks Finish.

Abandoned sessions (app closed mid-session) are silently closed on the next `review/start` call.

---

## CardSet Lifecycle

```
Teacher creates CardSet (PRIVATE)
  │
  ├── Teacher can edit cards, share with own classes
  │
  └── Admin promotes → DEPARTMENTAL
        │
        ├── Teacher loses edit rights (admin-only after promotion)
        ├── Visible to all teachers in the same SubjectGrade
        └── Admin can push via SubjectGradeAssignment to all teachers at once
```

---

## Assignment Flow

```
Admin creates SubjectGradeAssignment
  └── Teachers in that SubjectGrade see it in their dashboard

Teacher creates Class Assignment from SubjectGradeAssignment (or independently)
  ├── MANDATORY → CardInstances auto-created for all enrolled students (transaction)
  │               Retroactive: students enrolled after assignment still get instances
  │               on enrollment.
  └── OPTIONAL  → No CardInstances created; appears in student's opt-in list
                   Student opts in → CardInstances created for that student only
```

---

## Auth Flow

```
POST /api/auth/login
  → Access token (15 min) + Refresh token (7 days) in httpOnly cookies

POST /api/auth/refresh
  → New access token

POST /api/auth/logout
  → Clears cookies

POST /api/auth/forgot-password
  → Generates reset token (SHA-256 hashed in DB), emails raw token

POST /api/auth/reset-password
  → Validates token hash, sets new password, marks token used

mustChangePassword flag
  → Teachers created by admin have temp passwords; flag forces change on first login
```

---

## Key Design Decisions

**FSRS runs server-side.** The shared FSRS engine is in `shared/fsrs/`. The server calls it on every grade event. The client never runs FSRS logic.

**Per-deck FSRS parameters.** Each `Deck` stores its own `fsrsParams` JSON. Teachers can tune `newCardsPerDay`. The `w[]` weight array defaults to FSRS v5 published defaults (from `shared/fsrs/constants.ts`) when empty.

**No hard deletes.** Everything is soft-archived. Archiving a SubjectGrade cascades to its Classes. Students and teachers are never deleted — their records are needed for historical stats.

**All-or-nothing imports.** CSV imports (cards and students) validate every row before any database write. A single invalid row rejects the entire import.

**One active HomeworkRequirement per class.** Enforced at the app layer using a transaction: deactivate existing → create new. There is no unique DB constraint.

**Multi-class enrollment.** A student can be enrolled in multiple classes. Each enrollment gets its own Deck and its own FSRS progression. The client tracks the active enrollment in context; there is no server-side "active enrollment" state.

**Personal CardSets.** Each enrollment has one personal CardSet (isPersonal: true), created lazily on the student's first card addition. It is queried by `(enrollmentId, isPersonal: true)` rather than a direct Prisma relation.

**No OAuth, no external services.** Email + password only. No third-party auth providers. SMTP is the only external dependency, and it is only needed for password reset.

---

## Directory Structure

```
vanilla-class-srs/
├── client/src/
│   ├── components/       # Reusable UI (Modal, CsvImportModal, etc.)
│   ├── hooks/            # useApi and other shared hooks
│   ├── pages/            # One file per page/view
│   │   ├── admin/        # Admin pages (Departments, SubjectGrades, Teachers, CardSets)
│   │   ├── teacher/      # Teacher pages (Classes, CardSets, Stats)
│   │   ├── student/      # Student pages (Deck, Review, Stats, OptionalSets)
│   │   └── auth/         # Login, ForgotPassword, ResetPassword, ChangePassword
│   └── utils/            # API client, auth utilities
│
├── server/src/
│   ├── middleware/        # auth.ts (requireAuth, requireTeacher, etc.), validate.ts
│   ├── routes/            # Express routers (auth, admin, teachers, students, cardsets, stats)
│   ├── services/          # Business logic (auth, review, enrollment, card, assignment)
│   └── lib/               # Prisma client singleton
│
├── shared/
│   ├── fsrs/              # FSRS v5 engine: schedule(), constants, types
│   └── types/             # Shared TypeScript types
│
└── prisma/
    ├── schema.prisma      # Full data model
    └── migrations/        # Applied migrations
```
