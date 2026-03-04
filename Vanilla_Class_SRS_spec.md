# Vanilla Class SRS — Design Specification

## 1. Project Overview

**Name:** Vanilla Class SRS  
**Type:** FOSS, self-hostable classroom spaced repetition system  
**Repository:** Monorepo on GitHub  
**License:** To be determined (recommend MIT or AGPL)  
**Primary use case:** Teachers managing vocabulary SRS for language learning classes. Reference implementation: Chinese high school students learning English (L1: Chinese, L2: English).  
**Design philosophy:** Language-agnostic, deployment-agnostic, fork-friendly. Vanilla means no hardcoded languages, no hardcoded institutions, no hardcoded AI providers. Build a clean core; forks add specifics.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite) |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | Email + password (bcrypt + JWT). No OAuth in vanilla. |
| Containerization | Docker + docker-compose |
| Monorepo structure | npm workspaces |

---

## 3. Monorepo Structure

```
vanilla-class-srs/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── utils/
│   └── package.json
├── server/                  # Node/Express backend
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── services/
│   │   └── utils/
│   └── package.json
├── shared/                  # Shared types, constants, FSRS engine
│   ├── types/
│   ├── fsrs/
│   └── package.json
├── docs/                    # Documentation
│   ├── CSV_TEMPLATE.md      # CSV import template + AI prompt
│   └── DEPLOYMENT.md        # Self-hosting and China cloud guide
├── prisma/
│   └── schema.prisma        # Database schema
├── docker-compose.yml
├── .env.example
└── package.json             # Root workspace config
```

---

## 4. Organizational Hierarchy

```
Department
  └── SubjectGrade  (e.g. "English B HL Grade 12")
        └── Teacher  (independent user object; can belong to multiple SubjectGrades)
              └── Class  (e.g. "Class 12A")
                    └── Student  (independent user object; enrolled via join table)
```

- A **Teacher** can belong to multiple SubjectGrades (many-to-many via join table).
- A **Student** can be enrolled in multiple Classes (many-to-many via enrollment join table), receiving a separate Deck per enrollment.
- A **Teacher** can be promoted to **admin** by another admin. Students cannot be admins.

---

## 5. User Roles & Permissions

| Permission | Admin | Teacher | Student |
|---|---|---|---|
| Manage departments | ✅ | ❌ | ❌ |
| Manage SubjectGrades | ✅ | ❌ | ❌ |
| Create/manage teachers | ✅ | ❌ | ❌ |
| Create/manage classes | ✅ | ✅ (own classes) | ❌ |
| Import students (CSV or manual) | ✅ | ✅ (own classes) | ❌ |
| Create CardSets | ✅ | ✅ | ❌ |
| Promote CardSet to departmental | ✅ | ❌ | ❌ |
| Assign mandatory CardSets to teachers | ✅ | ❌ | ❌ |
| Assign CardSets to classes | ✅ | ✅ (own classes) | ❌ |
| Make optional CardSets available to class | ✅ | ✅ (own classes) | ❌ |
| Add own cards to deck | ❌ | ❌ | ✅ |
| Select optional CardSets | ❌ | ❌ | ✅ |
| Edit own card example sentences | ❌ | ❌ | ✅ |
| View own review stats | ❌ | ❌ | ✅ |
| View class review stats | ✅ | ✅ (own classes) | ❌ |
| Promote teacher to admin | ✅ | ❌ | ❌ |

---

## 6. Database Schema

### 6.1 Users & Auth

```prisma
model User {
  id                  String   @id @default(uuid())
  email               String   @unique
  passwordHash        String
  name                String
  role                Role     @default(STUDENT)
  mustChangePassword  Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  teacherProfile  Teacher?
  studentProfile  Student?
}

enum Role {
  ADMIN
  TEACHER
  STUDENT
}
```

### 6.2 Organizational Structure

```prisma
model Department {
  id            String         @id @default(uuid())
  name          String
  createdAt     DateTime       @default(now())
  archivedAt    DateTime?
  subjectGrades SubjectGrade[]
}

model SubjectGrade {
  id                     String       @id @default(uuid())
  name                   String       // e.g. "English B HL Grade 12"
  departmentId           String
  department             Department   @relation(fields: [departmentId], references: [id])
  teachers               TeacherSubjectGrade[]
  classes                Class[]
  cardSets               CardSet[]    // departmental CardSets live here
  subjectGradeAssignments SubjectGradeAssignment[]
  createdAt              DateTime     @default(now())
  archivedAt             DateTime?
}

model Teacher {
  id             String       @id @default(uuid())
  userId         String       @unique
  user           User         @relation(fields: [userId], references: [id])
  subjectGrades  TeacherSubjectGrade[]
  classes        Class[]
  cardSets       CardSet[]    // teacher-owned CardSets
  createdAt      DateTime     @default(now())
}

model TeacherSubjectGrade {
  teacherId      String
  subjectGradeId String
  teacher        Teacher      @relation(fields: [teacherId], references: [id])
  subjectGrade   SubjectGrade @relation(fields: [subjectGradeId], references: [id])
  @@id([teacherId, subjectGradeId])
}

model Class {
  id             String       @id @default(uuid())
  name           String       // e.g. "Class 12A"
  teacherId      String
  teacher        Teacher      @relation(fields: [teacherId], references: [id])
  subjectGradeId String
  subjectGrade   SubjectGrade @relation(fields: [subjectGradeId], references: [id])
  enrollments    Enrollment[]
  assignments    Assignment[]
  homeworkReqs   HomeworkRequirement[]
  createdAt      DateTime     @default(now())
  archivedAt     DateTime?
}
```

### 6.3 Students & Enrollment

```prisma
model Student {
  id          String       @id @default(uuid())
  userId      String       @unique
  user        User         @relation(fields: [userId], references: [id])
  enrollments Enrollment[]
  createdAt   DateTime     @default(now())
}

model Enrollment {
  id          String    @id @default(uuid())
  studentId   String
  classId     String
  student     Student   @relation(fields: [studentId], references: [id])
  class       Class     @relation(fields: [classId], references: [id])
  deck        Deck?
  // Personal CardSet is NOT a direct relation here to avoid Prisma ambiguity.
  // Look up personal CardSet via: CardSet.where(enrollmentId == this.id, isPersonal == true)
  joinedAt    DateTime  @default(now())
  @@unique([studentId, classId])
}
```

### 6.4 Cards & CardSets

```prisma
model CardSet {
  id             String        @id @default(uuid())
  name           String        // e.g. "Unit 3 Vocabulary"
  description    String?
  status         CardSetStatus @default(PRIVATE)

  // Ownership: either teacher-owned or departmental (subjectGrade-owned)
  // When promoted to DEPARTMENTAL, teacherId is retained for attribution
  // but editing rights transfer to admin only.
  teacherId      String?       // original creator (attribution)
  teacher        Teacher?      @relation(fields: [teacherId], references: [id])
  subjectGradeId String?       // set when promoted to DEPARTMENTAL
  subjectGrade   SubjectGrade? @relation(fields: [subjectGradeId], references: [id])

  // Personal CardSet fields — only set for auto-created student personal sets
  isPersonal     Boolean       @default(false)
  enrollmentId   String?       @unique  // links personal CardSet to a specific Enrollment
  enrollment     Enrollment?   @relation(fields: [enrollmentId], references: [id])

  cards                   Card[]
  assignments             Assignment[]
  subjectGradeAssignments SubjectGradeAssignment[]
  createdAt               DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  archivedAt     DateTime?
}

enum CardSetStatus {
  PRIVATE       // visible only to creating teacher
  DEPARTMENTAL  // visible to all teachers in subjectGrade; admin-editable only
}

model Card {
  id           String   @id @default(uuid())
  cardSetId    String
  cardSet      CardSet  @relation(fields: [cardSetId], references: [id])

  // fields object — only word + at least one definition required
  word            String
  pos             String?  // part of speech
  definitionL2    String?  // target language definition (e.g. English)
  definitionL1    String?  // native language definition (e.g. Chinese)
  // Validation: at least one of definitionL1 or definitionL2 must be non-null
  exampleSentence String?  // teacher-provided example sentence

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  instances    CardInstance[]
}
```

### 6.5 Assignments

```prisma
model Assignment {
  id          String         @id @default(uuid())
  classId     String
  class       Class          @relation(fields: [classId], references: [id])
  cardSetId   String
  cardSet     CardSet        @relation(fields: [cardSetId], references: [id])
  type        AssignmentType
  priority    Int            @default(0)  // lower = higher priority for new card introduction
  assignedAt  DateTime       @default(now())
  assignedBy  String         // userId of teacher or admin
  @@unique([classId, cardSetId])
}

enum AssignmentType {
  MANDATORY  // all students in class get CardInstances created automatically
  OPTIONAL   // students can choose to add to their deck
}

// SubjectGradeAssignment — created by admin to push a CardSet to all teachers in a SubjectGrade.
// Teachers see these in their dashboard and then create Class-level Assignments from them.
// For MANDATORY type: when a teacher creates a Class Assignment from a SubjectGradeAssignment,
//   CardInstances are auto-created for all enrolled students (same retroactive logic as §10).
// For OPTIONAL type: when the teacher opts the class in, the CardSet appears in each student's
//   available optional list (no CardInstances created).
model SubjectGradeAssignment {
  id             String         @id @default(uuid())
  subjectGradeId String
  subjectGrade   SubjectGrade   @relation(fields: [subjectGradeId], references: [id])
  cardSetId      String
  cardSet        CardSet        @relation(fields: [cardSetId], references: [id])
  type           AssignmentType
  assignedAt     DateTime       @default(now())
  assignedBy     String         // userId of admin
  @@unique([subjectGradeId, cardSetId])
}
```

### 6.6 Decks & FSRS

```prisma
model Deck {
  id           String   @id @default(uuid())
  enrollmentId String   @unique
  enrollment   Enrollment @relation(fields: [enrollmentId], references: [id])

  // Per-deck FSRS parameters (defaults shown; admin/teacher can tune)
  // "w" contains the 19 FSRS v5 weight parameters. An empty array means "use published defaults".
  // The FSRS engine in shared/fsrs/ must substitute the published FSRS v5 defaults when w is empty or missing.
  // Published FSRS v5 default weights (19 values) should be defined as a constant in shared/fsrs/constants.ts.
  fsrsParams   Json     @default("{\"requestRetention\":0.9,\"maximumInterval\":36500,\"w\":[]}")

  instances    CardInstance[]
  sessions     ReviewSession[]
  createdAt    DateTime @default(now())
}

model CardInstance {
  id           String   @id @default(uuid())
  deckId       String
  deck         Deck     @relation(fields: [deckId], references: [id])
  cardId       String
  card         Card     @relation(fields: [cardId], references: [id])

  // Student override of exampleSentence. If null, fall back to Card.exampleSentence at render time.
  exampleSentence String?

  // How this instance arrived in the student's deck
  origin       CardOrigin @default(TEACHER_ASSIGNED)

  // FSRS state
  stability    Float    @default(0)
  difficulty   Float    @default(0)
  retrievability Float  @default(0)
  due          DateTime @default(now())
  lastReview   DateTime?
  reps         Int      @default(0)
  lapses       Int      @default(0)
  state        FSRSState @default(NEW)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  reviewEvents ReviewEvent[]
  @@unique([deckId, cardId])
}

enum CardOrigin {
  TEACHER_ASSIGNED  // arrived via mandatory assignment
  OPTIONAL          // student opted into an optional CardSet
  STUDENT_ADDED     // student manually created
}

enum FSRSState {
  NEW
  LEARNING
  REVIEW
  RELEARNING
}
```

### 6.7 Review Stats

```prisma
model ReviewSession {
  id            String   @id @default(uuid())
  deckId        String
  deck          Deck     @relation(fields: [deckId], references: [id])
  startedAt     DateTime
  endedAt       DateTime?
  cardsReviewed Int      @default(0)
  accuracyRate  Float?   // calculated on session end (correct / total)
  events        ReviewEvent[]
}

model ReviewEvent {
  id              String       @id @default(uuid())
  sessionId       String
  session         ReviewSession @relation(fields: [sessionId], references: [id])
  cardInstanceId  String
  cardInstance    CardInstance @relation(fields: [cardInstanceId], references: [id])
  grade           Int          // FSRS grades: 1 (Again) 2 (Hard) 3 (Good) 4 (Easy)
  responseTimeMs  Int?
  reviewedAt      DateTime     @default(now())
}
```

---

## 7. FSRS Implementation

- FSRS v5 algorithm, implemented in `shared/fsrs/`.
- Scheduling runs **server-side** to prevent client-side tampering.
- Per-deck FSRS parameters stored as JSON in `Deck.fsrsParams`.
- Default parameters follow FSRS v5 published defaults. The 19 weight values are defined as a constant in `shared/fsrs/constants.ts` and substituted automatically when `Deck.fsrsParams.w` is empty.
- `CardInstance` stores the full FSRS state: `stability`, `difficulty`, `retrievability`, `due`, `lastReview`, `reps`, `lapses`, `state`.
- On each review event: grade is submitted to server → FSRS calculates new state → `CardInstance` updated → `ReviewEvent` written.
- Retrievability is recalculated at review time from stability + elapsed days (not stored as a static value; the stored value is a snapshot).

---

## 8. Card Validation Rules

Applied consistently at three levels: CSV import, API endpoint, and frontend form.

| Field | Rule |
|---|---|
| `word` | Required, non-empty string |
| `pos` | Optional, free text |
| `definitionL2` | Optional, but at least one of `definitionL1` / `definitionL2` must be present |
| `definitionL1` | Optional, but at least one of `definitionL1` / `definitionL2` must be present |
| `exampleSentence` | Optional, no validation, free text (students may write bilingual hints) |

Error message for missing definitions: `"At least one definition (L1 or L2) is required."`

---

## 9. Card Display (Flashcard Review View)

**Front of card:**
- `word` (large, prominent)
- `pos` (if present, small label beneath word)

**Back of card (revealed on flip):**
- `definitionL2` (if present, shown first — target language reinforcement)
- `definitionL1` (if present, shown below — native language support)
- `exampleSentence` (if present on CardInstance, shown last as context/reinforcement)

Empty fields are never rendered. No "Definition:" label appears if definition is absent.

---

## 10. CardSet Ownership & Promotion Flow

```
Teacher creates CardSet → status: PRIVATE, teacherId: set, subjectGradeId: null
Admin promotes CardSet  → status: DEPARTMENTAL, subjectGradeId: set, teacherId: retained (attribution only)
                          Original teacher loses edit rights. Only admins can edit DEPARTMENTAL sets.
```

**Assignment flows:**

1. **Mandatory (admin → teacher → class):**
   Admin creates a `SubjectGradeAssignment` (type: MANDATORY) linking a CardSet to a SubjectGrade → Teachers in that SubjectGrade see it in their dashboard → Teacher creates a Class-level `Assignment` record for their Class → CardInstances auto-created for all enrolled students.

2. **Optional (admin → teacher → class → student):**
   Admin creates a `SubjectGradeAssignment` (type: OPTIONAL) → Teacher opts to make it available to their Class by creating a Class-level `Assignment` (type: OPTIONAL) → Students see it as an available optional set and can add it to their Deck.

3. **Teacher-created optional:**  
   Teacher creates private CardSet → assigns it as optional to own Class → Students can opt in. Admin can promote to DEPARTMENTAL at any time.

**Retroactive assignment (class already has enrolled students):**  
When a mandatory CardSet is assigned to a class that already has enrolled students, the system immediately creates `CardInstances` for all currently enrolled students. This operation runs as a database transaction — either all instances are created successfully or none are. Students who are mid-session when this happens will see the new cards at their next session start, not during an active session. For optional CardSets assigned retroactively, no CardInstances are created — the set simply appears in each student's available optional list.

---

## 11. Student Card Management

Students can:
- Add their own cards manually (`CardOrigin: STUDENT_ADDED`) to their own Deck.
- Opt into optional CardSets made available by their teacher.
- Edit the `exampleSentence` field on any `CardInstance` in their Deck (stored on `CardInstance`, not the source `Card`).
- Export their own deck contents as CSV (see Section 23).

Students cannot:
- Edit `word`, `pos`, `definitionL1`, `definitionL2` on source Cards.
- Remove mandatory cards from their Deck.
- See other students' decks or stats.

**Personal CardSet for student-added cards:**  
When a student adds their first manual card, a personal CardSet is auto-created silently for that Enrollment (named e.g. "My Words — Class 12A"). All subsequent student-added cards for that Enrollment go into this CardSet. It is never visible to other students. Teachers can view the cards in a student's personal CardSet (read-only) via the class dashboard — this is intended for pastoral awareness and monitoring engagement. Teachers cannot edit any fields. One personal CardSet per Enrollment, created lazily on first use.

---

## 12. Multi-Class Enrollment & Deck Selection

A student may be enrolled in more than one Class (e.g. two different language courses). Each Enrollment has its own independent Deck.

**How deck selection works:**
- On login, if a student has only one active Enrollment, they are taken directly to that Deck's dashboard.
- If a student has multiple active Enrollments, they are shown a class picker screen ("Which class would you like to study?") listing each Class by name (and SubjectGrade for context). They select one and are taken to that Deck's dashboard.
- The class picker is accessible at any time from the student nav so they can switch between decks.
- Review sessions, stats, streaks, and homework compliance are all scoped per Enrollment/Deck. There is no cross-deck aggregation in vanilla.
- The student's active enrollment context is held in the client session state (not in the database). No "last active class" is persisted.

**API impact:**
- Student API endpoints that are Deck-scoped (e.g. `/api/students/deck`, `/api/students/review/*`, `/api/students/stats/*`) require an `enrollmentId` query parameter or derive it from a selected-enrollment context set at session start.
- `POST /api/students/review/start` must accept and validate the `enrollmentId`.

---

## 13. Student Import

**CSV format for batch student import:**
```
email,name
student1@school.edu,Zhang Wei
student2@school.edu,Li Na
```

- Teacher or admin uploads CSV to a specific Class.
- System creates `User` (role: STUDENT) + `Student` profile + `Enrollment` for each row.
- If email already exists in system, student is enrolled in the new Class without creating a duplicate User.
- On enrollment, an empty `Deck` is created for the student in that Class.
- Mandatory CardSets already assigned to the Class have `CardInstances` created immediately for the new student.
- Teachers can also add students one by one via a form (same logic, single record).
- Temporary passwords are auto-generated and displayed once for the teacher to distribute. Students should be prompted to change password on first login.

---

## 14. Teacher Stats View

Stats are read-only for teachers. No editing of student review data. Admins can view stats across all classes in a SubjectGrade.

All views support filtering by **CardSet** and **date range** where relevant.

---

### 14.1 Mastery Matrix
The primary class overview. Student names down the left axis, words (Cards) across the top. Each cell is a circle:
- **Color:** Green (high accuracy) → Yellow → Red (low accuracy). Grey = not yet reviewed.
- **Size:** Proportional to number of sessions in which the student has reviewed that card. A tiny circle means rarely seen; a full circle means frequently reviewed.
- Filterable by CardSet. Scrollable/zoomable for large classes.
- This is the view teachers open most often — it should be the default landing view for a class dashboard.

---

### 14.2 Student Leaderboard
Ranked list of students by total reps (cards reviewed) within a configurable time period (default: current week). Secondary sort by accuracy rate. Visible to teacher only — not shown to students.

---

### 14.3 Accuracy Highlighting
Per-student accuracy rate with automatic flagging:
- **Suspiciously high (>95% with low session count):** Possible avoidance of new/hard cards.
- **Very low (<50%):** Student may be struggling or disengaged.
Both extremes are surfaced with a visual flag in the student list. Thresholds are configurable per class.

---

### 14.4 Card Leaderboard
Ranked list of Cards by class-wide accuracy rate (ascending = hardest cards first). Shows:
- Average accuracy across all students who have reviewed the card
- Number of students who have reviewed it vs. total enrolled
- Cards with <30% accuracy class-wide are highlighted as "problem words"

---

### 14.5 Recent Student Additions
A reverse-chronological feed of cards students have added to their personal decks, across the class. Shows student name, word added, and timestamp. Useful for teachers monitoring engagement and catching inappropriate entries.

---

### 14.6 Optional CardSet Adoption
Which optional CardSets have been taken up, by how many students, and when. Breakdown per student of which optional sets they have added. Helps teachers understand which optional material resonates.

---

### 14.7 Time-Based Graphs (per student and class aggregate)
- **Cards reviewed per day** — bar chart, the core daily activity view
- **Review time per day** — minutes studied per day (derived from session duration)
- **Rolling 7-day accuracy rate** — retention trend line
- **Interval distribution histogram** — are card intervals spacing out healthily or bunching?
- **Due card forecast** — cards due in the next 7 / 14 / 30 days (useful before assessments)
- **Study streak calendar** — GitHub-style contribution heatmap per student (days reviewed vs. not). Visible to teacher per student and to the student themselves.
- **Review time-of-day heatmap** — when is the student studying? (evening/morning, weekday/weekend)
- **Due card backlog** — overdue cards accumulating; leading indicator of a struggling student
- **Deck growth over time** — total CardInstances per student over time (mandatory + optional + self-added)

---

### 14.8 Homework Compliance View
See Section 20 for homework requirement configuration. This view shows:
- Per-student compliance status for the current period (Met / Not Met / At Risk)
- Sessions completed this period vs. required
- Cards reviewed per session vs. minimum threshold
- A single-glance class compliance summary (e.g. "22/30 students on track")
- Students flagged as "At Risk" (past the alert threshold but period not yet ended) highlighted in amber
- Students who have not met the requirement by period end highlighted in red

---

## 15. CSV Import for CardSets

**CSV template columns:**
```
word,pos,definition_l2,definition_l1,example_sentence
```

**Validation on import:**
- `word` must be non-empty.
- At least one of `definition_l2` or `definition_l1` must be non-empty per row.
- Rows failing validation are surfaced in an import preview with clear error messages.
- Teacher reviews a preview table before committing the import.
- Partial imports are rejected — either all valid rows import, or the teacher fixes errors first. (This can be relaxed in a fork.)

**AI-assisted workflow:**  
See `docs/CSV_TEMPLATE.md` in the repository for the CSV template and a ready-to-use prompt for Claude, ChatGPT, or any LLM to generate a fully-formed CSV from a word list. This is the recommended workflow for CardSet creation. No AI infrastructure is built into Vanilla Class SRS itself.

---

## 16. Authentication & Session Management

- Email + password only. No OAuth in vanilla.
- Passwords hashed with bcrypt (minimum 12 rounds).
- JWT tokens for session management. Access token (short-lived: 15 min) + refresh token (long-lived: 7 days), stored in httpOnly cookies.
- First-login flag on User: `mustChangePassword: Boolean`. Students imported via CSV are flagged; they are redirected to a password change screen on first login.
- Password reset via email token (requires SMTP configuration in `.env`).
- Role is encoded in JWT payload. Middleware checks role on protected routes.

---

## 17. API Structure (REST)

```
/api/auth
  POST   /login
  POST   /logout
  POST   /refresh
  POST   /change-password
  POST   /forgot-password     (sends reset email with token)
  POST   /reset-password      (consumes token, sets new password)

/api/admin
  GET/POST/PATCH/DELETE  /departments
  GET/POST/PATCH/DELETE  /subject-grades
  GET/POST/PATCH/DELETE  /teachers
  POST                   /teachers/:id/promote-admin
  POST                   /cardsets/:id/promote
  GET/POST/DELETE        /subject-grades/:id/assignments  (SubjectGradeAssignments)

/api/teachers
  GET/POST/PATCH/DELETE  /classes
  POST                   /classes/:id/students        (add single)
  POST                   /classes/:id/students/import (CSV bulk)
  GET/POST               /cardsets
  PATCH/DELETE           /cardsets/:id
  POST                   /classes/:id/assignments
  GET                    /classes/:id/stats
  GET                    /classes/:id/homework        (get requirement)
  POST                   /classes/:id/homework        (create/update requirement)
  GET                    /classes/:id/students/:studentId/cards  (view student's personal CardSet — read-only)

/api/students
  GET                    /deck
  POST                   /deck/cards                  (add own card)
  PATCH                  /deck/cards/:instanceId      (edit exampleSentence)
  GET                    /deck/cards/:instanceId/history
  GET                    /deck/optional               (available optional sets)
  POST                   /deck/optional/:cardSetId    (opt in)
  GET                    /deck/export                 (CSV download)
  POST                   /review/start
  POST                   /review/grade
  GET                    /stats/summary
  GET                    /stats/daily
  GET                    /stats/accuracy
  GET                    /stats/forecast
  GET                    /stats/sessions
```

---

## 18. Deployment

### Environment Variables (`.env.example`)
```
DATABASE_URL=postgresql://user:password@localhost:5432/vanilla_class_srs
JWT_SECRET=
JWT_REFRESH_SECRET=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
CLIENT_URL=http://localhost:5173
PORT=3000
```

### docker-compose.yml (target structure)
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: vanilla_class_srs
      POSTGRES_USER: ...
      POSTGRES_PASSWORD: ...
    volumes:
      - pgdata:/var/lib/postgresql/data

  server:
    build: ./server
    depends_on: [db]
    env_file: .env
    ports: ["3000:3000"]

  client:
    build: ./client
    ports: ["80:80"]

volumes:
  pgdata:
```

### Deployment targets
- **Self-hosted at school:** Clone repo, configure `.env`, run `docker-compose up`. No external dependencies required.
- **China cloud (Alibaba Cloud / Tencent Cloud):** Same docker-compose setup. Choose a China-region instance. No Google services, no blocked external APIs. PIPL compliance is the deploying institution's responsibility.
- **SMTP:** Required for password reset emails. Schools can use their own SMTP server or a transactional email service available in China (e.g. SendCloud 赛邮, Mailgun has China-accessible alternatives).

---

## 19. Extension Points for Forks

The following are deliberately **not** in vanilla but are natural fork targets. Document these as extension points in the GitHub README:

- **Audio fields** on Card (`audioUrl`, TTS integration)
- **Cloze card type** (templateType: "cloze")
- **OAuth / SSO** (WeChat, school SSO)
- **L1/L2 language config** (UI language, card language labels)
- **Additional card fields** (image, IPA pronunciation, register)
- **Advanced gamification** (badges, points, inter-class leaderboards — streaks and weekly goals are vanilla)
- **Parent/observer role** (read-only stats view)
- **Bulk deck operations** (reset, export)
- **Analytics dashboard** (department-wide stats)
- **Mobile app** (React Native sharing `shared/` package)

---

## 20. Homework Requirements

Teachers can define a minimum review requirement per class per time period.

**Requirement model: Sessions per period (Model B)**
- Teacher specifies: number of required sessions per period (e.g. 3 sessions per week)
- Teacher specifies: minimum cards per session for it to count (e.g. at least 10 cards reviewed)
- A session that does not meet the minimum card threshold is not counted toward the requirement
- Period options: daily, weekly, custom (N days). Default: weekly.
- Requirements are set per Class, not per CardSet. All assigned cards are reviewed together in sessions.

**Card priority ordering within sessions:**
- Teachers set a priority order for CardSets assigned to a class (e.g. "Unit 3 Vocab" before "Unit 2 Vocab")
- New cards (FSRSState: NEW) are introduced in priority order — higher-priority CardSets surface new cards first
- Due cards (LEARNING / REVIEW / RELEARNING) are always shown regardless of priority, ordered by due date
- Priority is a per-assignment integer field on the Assignment model

**Prisma addition:**
```prisma
// Assignment.priority is already defined in §6.5.
// The HomeworkRequirement model is new:

model HomeworkRequirement {
  id                  String   @id @default(uuid())
  classId             String
  class               Class    @relation(fields: [classId], references: [id])
  sessionsRequired    Int      // e.g. 3
  minCardsPerSession  Int      // e.g. 10
  periodDays          Int      @default(7)  // 7 = weekly
  alertThresholdDays  Int      @default(2)  // alert if requirement not on track with N days remaining
  activeFrom          DateTime
  activeTo            DateTime?  // null = ongoing
  isActive            Boolean  @default(true)
  createdAt           DateTime @default(now())
}
// Only one HomeworkRequirement per class may have isActive = true at a time.
// Enforced at the application layer: when a teacher creates or updates a requirement,
// any existing active requirement for that class is set to isActive = false first (within a transaction).
```

**Alert behavior:**
- When a student has not met their session requirement and `alertThresholdDays` remain in the period, they receive an in-app alert: "You have X sessions remaining this week. Minimum: Y."
- Teacher dashboard flags the student as "At Risk" (amber) at the same threshold.
- At period end, unmet requirements are marked red in the compliance view.
- Alerts are in-app only in vanilla. Email/push notification is a fork concern.

---

## 21. Student Stats & Gamification

Students have access to their own stats dashboard. No other students' data is visible.

### 21.1 Gamification Elements
- **Streak counter:** Consecutive days on which the student completed at least one qualifying session (meeting the minimum card threshold). Displayed prominently on the student dashboard.
- **Weekly goal progress bar:** "X / Y sessions this week" tied to the current HomeworkRequirement. Updates in real time after each session.
- **Personal bests:** Longest streak ever, most cards reviewed in a single day, displayed as a simple stat block.
- These three elements constitute vanilla gamification. Badges, points, and leaderboards are fork territory.

### 21.2 Student Stats Views
The following views are available to students for their own data only:

- **Deck summary:** Total cards in deck broken down by FSRS state (New / Learning / Review / Relearning). Due today count.
- **Cards reviewed per day** — bar chart (last 30 days default, adjustable)
- **Rolling 7-day accuracy rate** — trend line showing retention over time
- **Study streak calendar** — GitHub-style heatmap of days studied (same view teacher sees for that student)
- **Due card forecast** — cards due in the next 7 / 14 / 30 days
- **Deck growth over time** — how many cards have accumulated in their deck
- **Per-card history:** Student can tap any card in their deck to see their personal review history for that card (dates reviewed, grade given each time). No FSRS internals exposed.
- **Session log:** Reverse-chronological list of past sessions with date, duration, cards reviewed, accuracy rate.

### 21.3 Student Stats API Endpoints
```
/api/students
  GET  /stats/summary         (deck state breakdown, streak, weekly goal)
  GET  /stats/daily           (cards reviewed per day, query param: days=30)
  GET  /stats/accuracy        (rolling accuracy rate)
  GET  /stats/forecast        (due card forecast)
  GET  /stats/sessions        (session log)
  GET  /deck/cards/:instanceId/history  (per-card review history)
```

---

## 22. Archiving Model

Archiving hides records from active dashboards without permanently deleting data. All archivable models include an `archivedAt DateTime?` field. A non-null value means archived. Archived records are excluded from all normal queries by default but remain in the database for historical stats and audit purposes.

**Who can archive what:**

| Entity | Who can archive |
|---|---|
| Class | Teacher (own), Admin |
| SubjectGrade | Admin only |
| Department | Admin only |
| CardSet | Creating teacher (if PRIVATE), Admin (any) |

**Permanent deletion** is not in vanilla scope. Hard deletes are a fork concern. Admins can un-archive any entity.

**Cascade behavior:** Archiving a Class does not archive its students (they may be enrolled in other classes). Archiving a SubjectGrade archives all its Classes. Student Decks and ReviewSessions within archived Classes remain intact and queryable for stats, but students can no longer submit review grades to archived Class decks.

**Year-end workflow (recommended practice, documented in `docs/DEPLOYMENT.md`):**  
At year-end, admin archives the current SubjectGrade (e.g. "English B HL Grade 12 — 2025/26") and creates a new one for the next cohort. Historical data is preserved. This is not automated in vanilla — it is a manual admin action.

---

## 23. Student Data Export

Students can export the contents of their own Deck as a CSV file from their dashboard.

**CSV columns exported:**
```
word,pos,definition_l2,definition_l1,example_sentence
```

- `example_sentence` reflects the student's own customized version if they have edited it.
- FSRS state data (stability, due date, reps, etc.) is NOT included. This is a fork concern.
- Export includes all CardInstances in the student's Deck regardless of origin (teacher-assigned, optional, or student-added).
- Export is scoped per Enrollment (per Class deck). If a student is enrolled in multiple classes, they export each deck separately.
- Export is triggered client-side as a file download. No server-side storage of export files.

**API endpoint:**
```
/api/students
  GET  /deck/export   (returns CSV as file download, scoped to current enrollment)
```

---

## 24. Review Session — Confirmed Decisions

All six questions below were confirmed before implementation. These are binding decisions.

1. **Session size:** A session serves all currently due cards (LEARNING / REVIEW / RELEARNING state, `due <= now`) plus new cards up to the daily new-card quota (see decision 4). There is no separate per-session card cap beyond those two constraints.

2. **Card ordering within a session:** Due cards (LEARNING / REVIEW / RELEARNING) are served in strict FSRS due-date ascending order — most overdue first. New cards (FSRSState: NEW) are appended after due cards, ordered by CardSet assignment priority (lower `Assignment.priority` integer = shown first).

3. **Session abandonment:** If a student closes the app mid-session, grades already submitted are saved and the `ReviewSession` is marked incomplete (`endedAt` remains null). On the next `review/start` call, any open session for that deck with null `endedAt` is closed first (its `endedAt` set to now, `accuracyRate` calculated from events already written) before a new session is created. The student does not see a resume prompt — the abandoned session is silently closed.

4. **New cards per day:** A maximum of **10 new cards (FSRSState: NEW) per deck per calendar day** are introduced. This is a per-deck, per-day counter derived by counting `ReviewEvent` records where the associated `CardInstance.state` was NEW at the time of the event, within the current calendar day (server timezone). The limit is stored in `Deck.fsrsParams` as `newCardsPerDay` (default: 10). Teachers and admins can tune it per deck. Once the daily limit is reached, no further NEW cards are included in that deck's sessions for the remainder of the day; due cards are still served normally.

   **Schema addition to `Deck.fsrsParams` default:**
   ```
   {"requestRetention": 0.9, "maximumInterval": 36500, "w": [], "newCardsPerDay": 10}
   ```

5. **Session end trigger:** A session ends when (a) all due cards have been reviewed AND the daily new-card limit has been reached or no NEW cards remain, OR (b) the student explicitly clicks "Finish session" early. In case (b), partial progress is saved — all grades submitted so far are written as `ReviewEvent` records, the `ReviewSession` is closed with `endedAt` set and `accuracyRate` calculated from events so far. The session is considered complete (not abandoned) in either case.

6. **Relearning after lapse:** When a card is graded "Again" (grade 1), it is added to the **end of the current session queue** for one re-show (maximum 1 re-entry per card per session). Its FSRS state updates immediately to RELEARNING with a new due date. If it is graded Again a second time in the same session, it is **not** re-queued again — it exits the session and will appear in the next session naturally via its new due date.

---

## 25. Coding Procedure

This section is addressed directly to Claude Code. Follow it exactly.

---

### 25.1 Pre-Flight: Answer Open Questions First

All six review session questions from Section 24 have been answered and recorded as binding decisions. Do not re-open them. Implement exactly as specified in §24.

---

### 25.2 Build Order

Follow this sequence strictly. Do not skip ahead. Do not build UI for a phase until the API layer for that phase is tested.

1. **Database schema** — run `prisma migrate dev`, confirm all tables exist
2. **Auth** — login, logout, refresh, change-password, mustChangePassword redirect, role middleware
3. **Org hierarchy** — Department, SubjectGrade, Teacher, Class CRUD (admin only)
4. **Student management** — enrollment, CSV import, single-add, Deck auto-creation
5. **CardSets and Cards** — CRUD, CSV import, promotion flow, personal CardSet auto-creation
6. **Assignments** — mandatory and optional, retroactive CardInstance creation (transaction)
7. **Review session loop** — start, grade, FSRS scheduling, session close (answers from §24 required)
8. **Homework requirements** — HomeworkRequirement model, compliance tracking, alerts
9. **Teacher stats** — all views in §14, in subsection order (14.1 through 14.8)
10. **Student stats and gamification** — all views in §21
11. **Frontend** — build UI only after all API endpoints are tested. Mirror the build order above.

---

### 25.3 Hard Stop Gates

At each gate below, you must stop completely. Write a summary of exactly what was built and what was tested. Then output the following line verbatim and wait:

> **GATE [N] COMPLETE — type "confirmed" to continue to the next phase.**

Do not proceed until the user types "confirmed". Do not interpret any other response as confirmation.

| Gate | Trigger |
|---|---|
| **Gate 1** | Prisma migration runs cleanly and all tables are verified in the database |
| **Gate 2** | Auth is fully working: login returns JWT, refresh works, mustChangePassword redirect works, role middleware correctly rejects wrong roles on at least one protected route |
| **Gate 3** | Student import (CSV and single-add), enrollment, and Deck auto-creation are working end-to-end |
| **Gate 4** | CardSet/Card CRUD, CSV import, and Assignment creation (including retroactive CardInstance transaction) are working |
| **Gate 5** | Review session loop is working end-to-end: a student can start a session, grade cards, FSRS state updates correctly, session closes and writes ReviewSession + ReviewEvents |
| **Gate 6** | All API endpoints for stats (§14 and §21) return correct data before any stats UI is built |
| **Gate 7** | Frontend is complete and all features are smoke-tested end-to-end |

---

### 25.4 Handling Ambiguity

If you encounter any situation not covered by this spec:

1. Choose the most conservative, least destructive option available
2. Implement that option
3. Add a comment in the code: `// DECISION: [what you chose and why — flag for review]`
4. Add the ambiguity to a running list
5. Surface the full list at the next hard stop gate

Do not invent new features. Do not expand scope. Do not silently make opinionated choices without flagging them.

---

### 25.5 Definition of "Done" Per Phase

Do not call a phase complete until its checklist is fully satisfied.

**Schema (Gate 1):**
- [ ] `prisma migrate dev` runs with zero errors
- [ ] All models from §6 exist in the database with correct field types
- [ ] All enums exist: Role, CardSetStatus, AssignmentType, CardOrigin, FSRSState

**Auth (Gate 2):**
- [ ] `POST /api/auth/login` returns access + refresh tokens in httpOnly cookies
- [ ] `POST /api/auth/refresh` issues a new access token
- [ ] `POST /api/auth/logout` clears cookies
- [ ] `POST /api/auth/change-password` works and clears `mustChangePassword` flag
- [ ] Middleware rejects requests with wrong role on at least one route per role
- [ ] A student with `mustChangePassword: true` is redirected on login
- [ ] `POST /api/auth/forgot-password` sends a reset email (requires SMTP config)
- [ ] `POST /api/auth/reset-password` consumes the token and sets the new password

**Student management (Gate 3):**
- [ ] CSV import creates User + Student + Enrollment + Deck per row
- [ ] Duplicate email is handled (enroll, don't duplicate User)
- [ ] Single-add student works identically
- [ ] Temp password is generated and surfaced to teacher
- [ ] Mandatory CardInstances are created on enrollment if assignments already exist

**CardSets / Assignments (Gate 4):**
- [ ] Teacher can create, edit, delete a private CardSet
- [ ] CSV card import validates correctly and shows preview
- [ ] Admin can promote CardSet to DEPARTMENTAL (teacher loses edit rights)
- [ ] Mandatory assignment triggers CardInstance creation for all enrolled students (transaction)
- [ ] Retroactive mandatory assignment creates CardInstances for existing students
- [ ] Optional assignment does not create CardInstances — appears in student's available list
- [ ] Personal CardSet is auto-created on first student card addition (isPersonal: true)
- [ ] Assignment.priority field is respected in new card ordering

**Review loop (Gate 5):**
- [ ] `POST /api/students/review/start` returns a correctly ordered set of cards
- [ ] `POST /api/students/review/grade` updates CardInstance FSRS state correctly
- [ ] ReviewSession and ReviewEvent are written correctly
- [ ] Session close calculates and stores accuracyRate
- [ ] Abandoned session (null endedAt) is closed on next `review/start` call (§24 decision 3)
- [ ] Daily new-card limit (default 10/day) is enforced correctly (§24 decision 4)
- [ ] Session ends when due cards exhausted + new-card limit reached, or student clicks Finish (§24 decision 5)
- [ ] Lapsed card re-enters session queue once; second Again in same session does not re-queue (§24 decision 6)

**Stats APIs (Gate 6):**
- [ ] All endpoints in §16 under `/api/students/stats` return data
- [ ] All endpoints implied by §14 return data for a teacher
- [ ] Mastery matrix data endpoint returns per-student per-card accuracy and rep count
- [ ] Homework compliance endpoint correctly identifies Met / At Risk / Not Met students

**Frontend (Gate 7):**
- [ ] All teacher views render without errors
- [ ] All student views render without errors
- [ ] Mastery matrix renders with correct circle sizes and colors
- [ ] Review session UI works end-to-end on mobile viewport (min 375px wide)
- [ ] CSV import UI shows preview and validation errors correctly
- [ ] Student export downloads a correctly formatted CSV

---

### 25.6 What Not To Build

The following are explicitly out of scope for this implementation. Do not build them, scaffold them, or leave TODOs for them:

- OAuth or SSO of any kind
- Audio fields or TTS
- Cloze card types
- Email or push notifications (alerts are in-app only)
- Hard delete of any record
- Any analytics beyond what is specified in §14 and §21
- Any AI integration

## 26. Repository Documentation Checklist

The following must exist in the repo before v1.0:

- [ ] `README.md` — project overview, quick-start, fork guide
- [ ] `docs/DEPLOYMENT.md` — self-hosting and China cloud instructions
- [ ] `docs/CSV_TEMPLATE.md` — CSV template + AI prompt for CardSet generation
- [ ] `docs/ARCHITECTURE.md` — hierarchy diagram, data flow, key design decisions
- [ ] `.env.example` — all required environment variables with comments
- [ ] `CONTRIBUTING.md` — contribution guidelines
- [ ] `LICENSE` — to be decided (MIT recommended for maximum fork-friendliness)

---

*Specification version: 0.3 — pre-implementation (all review session decisions confirmed; spec is implementation-ready)*
*Last updated: February 2026*
