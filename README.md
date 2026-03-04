# Vanilla Class SRS

A free, open-source, self-hostable spaced repetition system for classroom vocabulary study.

**Designed for language teachers.** Manage word lists, assign them to classes, and let students study using FSRS v5 scheduling. Built for schools that need full data ownership and zero reliance on external services.

---

## Features

- FSRS v5 scheduling (server-side, per-deck)
- Teacher-managed CardSets with CSV import
- Admin-promoted departmental CardSets shared across teachers
- Mandatory and optional assignments per class
- Per-enrollment decks — one student, multiple classes, isolated progress
- Homework requirements with compliance tracking
- Teacher stats: mastery matrix, leaderboards, accuracy heatmaps
- Student stats: streaks, forecasts, session history
- Students can add their own cards and customise example sentences
- Email + password auth (no OAuth, no external identity providers)
- Fully self-hostable with Docker

---

## Quick Start

### Prerequisites

- Docker and Docker Compose
- An SMTP server for password reset emails (optional for local dev)

### 1. Clone the repo

```bash
git clone https://github.com/your-org/vanilla-class-srs.git
cd vanilla-class-srs
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
JWT_SECRET=<random string, e.g. openssl rand -base64 64>
JWT_REFRESH_SECRET=<different random string>
```

### 3. Start

```bash
docker compose up
```

The app will be available at `http://localhost`.

### 4. Seed the first admin

Run the seed script to create the initial admin account:

```bash
docker compose exec server npx tsx src/scripts/seed-admin.ts
```

Follow the prompts to set the admin email and password.

---

## Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use `docker compose up db` to run only the database)

### Install dependencies

```bash
npm install
```

### Configure environment

```bash
cp .env.example .env
# Edit DATABASE_URL to point to your local Postgres instance
```

### Run migrations

```bash
npm run db:migrate
```

### Start dev servers

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

### Database tools

```bash
npm run db:studio    # Prisma Studio GUI
npm run db:migrate   # Run pending migrations
npm run db:generate  # Regenerate Prisma client after schema changes
```

---

## Project Structure

```
vanilla-class-srs/
├── client/          # React + Vite frontend
├── server/          # Node.js + Express backend
├── shared/          # Shared types and FSRS engine
├── prisma/          # Database schema and migrations
├── docs/            # Extended documentation
└── docker-compose.yml
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full overview of the data model and system design.

---

## Fork Guide

Vanilla Class SRS is intentionally generic. It has no hardcoded languages, institutions, or AI providers. To adapt it for your context:

- **Language labels** — `definitionL1` / `definitionL2` are plain strings. Rename them in your fork's UI to whatever makes sense (e.g. "Chinese" / "English").
- **Institution structure** — Department → SubjectGrade → Class is a general hierarchy. Rename to match your school's terminology.
- **AI card generation** — see [docs/CSV_TEMPLATE.md](docs/CSV_TEMPLATE.md) for a ready-to-use LLM prompt. No AI is built into the core.
- **SMTP** — swap `nodemailer` for any provider. The email service is isolated in `server/src/services/email.service.ts`.

---

## Documentation

| File | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, hierarchy, key design decisions |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Self-hosting, Docker, China cloud deployment |
| [docs/CSV_TEMPLATE.md](docs/CSV_TEMPLATE.md) | CSV formats and AI prompt for card generation |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

---

## License

MIT. See [LICENSE](LICENSE).
