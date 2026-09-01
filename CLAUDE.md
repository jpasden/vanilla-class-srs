# vanilla-class-srs — Classroom SRS

FOSS self-hostable classroom spaced repetition system for language teachers. React + Node/Express + PostgreSQL + Docker monorepo.

**Spec:** `Vanilla_Class_SRS_spec.md`

## Tech Stack
- Frontend: React + Vite (client/)
- Backend: Node.js + Express (server/)
- Shared: types + FSRS engine (shared/)
- Database: PostgreSQL via Prisma ORM
- Auth: email + password (bcrypt + JWT)
- Docker + docker-compose for local dev
- npm workspaces monorepo

## Design Pattern: Admin/Teacher Feature Parity

Every teacher-facing action, button, or route must also be visible and
usable on the equivalent admin page. Admin accounts here are commonly
dual-role (admin + teacher, via "Add Admin as Teacher" on the Teachers
page), specifically so one login can do both jobs — hiding a teacher
feature from the admin view of the same entity (e.g. admin's
`/admin/classes/:id` vs teacher's `/teacher/classes/:id`) breaks that.
When adding a new teacher-facing capability, add the same capability to
the corresponding admin page in the same session, not as a follow-up.

## Git Workflow
At the end of every session, before stopping:
1. Run `git add -A`
2. Run `git commit -m "Session: <brief summary of what changed>"`
3. Run `git push origin main`

Always do this unless I explicitly say "don't push."
