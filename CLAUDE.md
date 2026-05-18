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

## Git Workflow
At the end of every session, before stopping:
1. Run `git add -A`
2. Run `git commit -m "Session: <brief summary of what changed>"`
3. Run `git push origin main`

Always do this unless I explicitly say "don't push."
