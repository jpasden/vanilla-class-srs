# Deployment Guide

## Overview

Vanilla Class SRS is designed to run entirely on your own infrastructure with no external service dependencies (except an SMTP server for password reset emails, which is optional).

---

## Docker Compose (Recommended)

The included `docker-compose.yml` starts three containers:

| Service | Description | Default port |
|---|---|---|
| `db` | PostgreSQL 16 | 5432 |
| `server` | Node.js/Express API | 3000 |
| `client` | Nginx serving the React build | 80 |

### Steps

**1. Copy and configure the environment file**

```bash
cp .env.example .env
```

Required variables to set before first start:

```bash
JWT_SECRET=           # Long random string — openssl rand -base64 64
JWT_REFRESH_SECRET=   # Different long random string
```

All other variables have sensible defaults for local use. For production, also configure SMTP (see below).

**2. Start**

```bash
docker compose up -d
```

**3. Run database migrations**

On first start (and after any update that includes schema changes):

```bash
docker compose exec server npx prisma migrate deploy --schema=/app/prisma/schema.prisma
```

**4. Seed the first admin**

```bash
docker compose exec server npx tsx src/scripts/seed-admin.ts
```

This creates the initial admin user. Record the credentials — there is no other way to recover access.

**5. Access the app**

Open `http://your-server-ip` in a browser.

---

## Environment Variables

Full reference for `.env`:

```bash
# ── Database ─────────────────────────────────────────────────────────────────
# Docker: postgresql://srs_user:changeme@db:5432/vanilla_class_srs
# Local:  postgresql://YOUR_MAC_USERNAME@localhost:5432/vanilla_class_srs
DATABASE_URL=postgresql://srs_user:changeme@db:5432/vanilla_class_srs

# Postgres credentials (used by the db container)
POSTGRES_USER=srs_user
POSTGRES_PASSWORD=changeme

# ── Auth ─────────────────────────────────────────────────────────────────────
# Generate with: openssl rand -base64 64
JWT_SECRET=
JWT_REFRESH_SECRET=

# ── SMTP (required for password reset emails) ─────────────────────────────────
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@yourschool.edu

# ── App ──────────────────────────────────────────────────────────────────────
# The URL the frontend is served from — used in password reset links
CLIENT_URL=http://localhost:5173

# Express server port (inside container)
PORT=3000

# Server timezone — determines when the new-card daily quota resets
# Use IANA timezone names: UTC, Asia/Shanghai, America/New_York, etc.
TZ=UTC
```

---

## SMTP Configuration

Password reset is the only feature that requires email. If you skip SMTP configuration, password reset will not work, but all other features will function normally.

**Using your school's SMTP server:**

```bash
SMTP_HOST=mail.yourschool.edu
SMTP_PORT=587
SMTP_USER=noreply@yourschool.edu
SMTP_PASS=yourpassword
SMTP_FROM=noreply@yourschool.edu
```

**Services available in mainland China:**

- [SendCloud 赛邮](https://sendcloud.sohu.com) — widely used transactional email for China deployments
- [Alibaba Cloud Direct Mail](https://www.alibabacloud.com/product/directmail)
- Your school or institution's own SMTP relay

**No SMTP / development mode:**

If `SMTP_HOST` is not set, the server logs the reset email content to stdout instead of sending it. This is useful for local development.

---

## Production Checklist

Before going live with real student data:

- [ ] Strong random `JWT_SECRET` and `JWT_REFRESH_SECRET` (min 64 chars)
- [ ] `POSTGRES_PASSWORD` changed from the default `changeme`
- [ ] SMTP configured and tested (send a password reset to verify)
- [ ] `CLIENT_URL` set to your actual domain (e.g. `https://srs.yourschool.edu`)
- [ ] TLS/HTTPS configured on your reverse proxy (Nginx, Caddy, etc.)
- [ ] `TZ` set to your school's local timezone
- [ ] Regular database backups configured (see below)

---

## HTTPS / Reverse Proxy

The Docker setup serves HTTP only. For production, run a reverse proxy in front of the client container:

**Nginx example (simplified):**

```nginx
server {
    listen 443 ssl;
    server_name srs.yourschool.edu;

    ssl_certificate     /etc/letsencrypt/live/srs.yourschool.edu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/srs.yourschool.edu/privkey.pem;

    location / {
        proxy_pass http://localhost:80;
    }
}
```

**Caddy (simpler, auto-HTTPS):**

```
srs.yourschool.edu {
    reverse_proxy localhost:80
}
```

---

## Database Backups

```bash
# Dump
docker compose exec db pg_dump -U srs_user vanilla_class_srs > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -i db psql -U srs_user vanilla_class_srs < backup_20260101.sql
```

Set up a cron job or your cloud provider's backup feature to run dumps automatically.

---

## Updates

```bash
git pull
docker compose build
docker compose up -d
docker compose exec server npx prisma migrate deploy --schema=/app/prisma/schema.prisma
```

Always run migrations after updating — new versions may include schema changes.

---

## China Cloud Deployment (Alibaba Cloud / Tencent Cloud)

The stack has no dependencies on services blocked in mainland China:

- No Google APIs, CDN, or fonts
- No external JavaScript bundles loaded at runtime (everything is bundled at build time)
- No OAuth providers
- SMTP providers with China-region support are available (see above)

**Recommended setup:**

1. Provision an ECS instance (2 vCPU / 4 GB RAM minimum)
2. Install Docker and Docker Compose
3. Follow the standard Docker Compose steps above
4. Use an internal NTP server if available; otherwise `TZ=Asia/Shanghai` is sufficient for daily-limit resets
5. If using Alibaba Cloud RDS for PostgreSQL instead of the bundled container, set `DATABASE_URL` accordingly and remove the `db` service from `docker-compose.yml`

**PIPL compliance** is the responsibility of the deploying institution. Vanilla Class SRS stores only the data it needs to function (email address, display name, review history). No data is sent to third parties.

---

## Troubleshooting

**Migrations fail on first start**

The `server` container may start before `db` is ready. Run migrations manually:

```bash
docker compose exec server npx prisma migrate deploy --schema=/app/prisma/schema.prisma
```

**"Invalid JWT" errors after restart**

JWT secrets changed. All active sessions are invalidated. Users need to log in again.

**Password reset emails not arriving**

Check `SMTP_HOST` is set and reachable from the server container. In development, check server logs — the email content is printed to stdout when SMTP is unconfigured.

**Port 80 already in use**

Change the client port mapping in `docker-compose.yml`:

```yaml
client:
  ports:
    - "8080:80"   # serve on port 8080 instead
```
