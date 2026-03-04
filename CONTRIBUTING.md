# Contributing

Contributions are welcome. This document explains how to get set up and what to keep in mind.

---

## Getting Started

1. Fork the repository and clone your fork.
2. Follow the development setup in [README.md](README.md).
3. Create a feature branch: `git checkout -b your-feature-name`
4. Make your changes.
5. Open a pull request against `main`.

---

## Guiding Principles

**Vanilla means generic.** The core must remain language-agnostic, institution-agnostic, and AI-agnostic. Do not add hardcoded language names, institution names, or third-party service integrations. Those belong in forks.

**Minimal scope.** Only build what is in the spec. Do not add features, configuration flags, or abstractions for hypothetical future requirements. Three similar lines of code is better than a premature abstraction.

**Soft deletes only.** Never hard-delete records. Use `archivedAt` timestamps. Historical stats depend on the integrity of old data.

**No external runtime dependencies.** Everything runs on-premise. Do not introduce dependencies that call out to external APIs at runtime.

**Out of scope (do not add):**
- OAuth or SSO
- Audio fields or TTS
- Cloze card types
- Email or push notifications (alerts are in-app only)
- Any AI integration
- Any analytics beyond what is specified in §14 and §21 of the spec

---

## Code Style

- TypeScript throughout. No untyped `any` except where Prisma forces it.
- Express route handlers should stay thin — move business logic into `services/`.
- Validate all input at route boundaries with Zod schemas.
- Transactions for any multi-step database write that must be atomic.
- Mark non-obvious decisions with a comment: `// DECISION: [what and why]`

---

## Pull Request Checklist

- [ ] No new external runtime dependencies added
- [ ] All new API routes require auth middleware
- [ ] Input validation added (Zod) for any new request bodies
- [ ] Multi-step DB writes use a transaction
- [ ] No hard deletes
- [ ] Frontend changes tested at mobile viewport (min 375px wide)

---

## Third-Party Assets

### Fonts

The following fonts are self-hosted in `client/public/fonts/` and served as woff2 files. They are **not** loaded from Google Fonts at runtime.

| Font | Designer | License |
|------|----------|---------|
| [Pacifico](https://fonts.google.com/specimen/Pacifico) | Vernon Adams, Jacques Le Bailly, Botjo Nikoltchev, Ani Petrova | [OFL 1.1](https://openfontlicense.org/) |
| [Fredoka](https://fonts.google.com/specimen/Fredoka) | Milena Brandão, Hafontia | [OFL 1.1](https://openfontlicense.org/) |
| [Nunito](https://fonts.google.com/specimen/Nunito) | Vernon Adams, Cyreal, Jacques Le Bailly | [OFL 1.1](https://openfontlicense.org/) |

All three fonts are released under the [SIL Open Font License 1.1](https://openfontlicense.org/), which permits use, modification, and redistribution in both open and closed source projects, with or without charge, provided the fonts are not sold on their own.

---

## Reporting Bugs

Open an issue on GitHub. Include:

- Steps to reproduce
- Expected behaviour
- Actual behaviour
- Server logs (if relevant), with any sensitive data redacted
