/**
 * Minimal audit log for account/auth events — login, logout, password
 * change/reset, account creation. One JSON line per event, appended to a
 * file that's bind-mounted to the host (see docker-compose.yml's `server`
 * service `volumes:`) so it survives container rebuilds and is readable
 * via plain SSH without `docker exec`.
 *
 * Deliberately minimal (no winston/pino, no DB table) — this exists to
 * give a real answer to "what happened to this account" during the first
 * weeks of real student use, not to be a general-purpose logging system.
 * Never log passwords, tokens, or full request bodies.
 */

import fs from 'fs'
import path from 'path'

// Compiled location is server/dist/lib/auditLog.js, with WORKDIR /app in the
// runtime image (see server/Dockerfile) — three levels up from __dirname
// (lib -> dist -> server -> app) lands on /app, where docker-compose.yml
// bind-mounts ./logs to /app/logs.
const LOG_DIR = process.env.AUDIT_LOG_DIR ?? path.join(__dirname, '../../../logs')
const LOG_FILE = path.join(LOG_DIR, 'audit.log')

export function logAuditEvent(event: string, details: Record<string, unknown> = {}): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch (err) {
    // A logging failure (full disk, permissions) must never break the
    // request it's trying to record — surface it to stderr and move on.
    console.error('Failed to write audit log entry:', err)
  }
}
