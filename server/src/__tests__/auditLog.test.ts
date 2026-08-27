import { describe, it, expect, vi, beforeEach } from 'vitest'

const mkdirSync = vi.fn()
const appendFileSync = vi.fn()
vi.mock('fs', () => ({
  default: {
    mkdirSync: (...args: unknown[]) => mkdirSync(...args),
    appendFileSync: (...args: unknown[]) => appendFileSync(...args),
  },
}))

import { logAuditEvent } from '../lib/auditLog'

beforeEach(() => {
  mkdirSync.mockReset()
  appendFileSync.mockReset()
})

describe('logAuditEvent', () => {
  it('writes a single JSON line containing the event name, timestamp, and details', () => {
    logAuditEvent('login_success', { email: 'alice@school.edu', ip: '1.2.3.4' })

    expect(appendFileSync).toHaveBeenCalledTimes(1)
    const [, line] = appendFileSync.mock.calls[0]
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line.trim())
    expect(parsed.event).toBe('login_success')
    expect(parsed.email).toBe('alice@school.edu')
    expect(parsed.ip).toBe('1.2.3.4')
    expect(typeof parsed.timestamp).toBe('string')
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow()
  })

  it('ensures the log directory exists before writing', () => {
    logAuditEvent('logout', { userId: 'user-1' })
    expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
  })

  it('never throws even if the underlying file write fails', () => {
    appendFileSync.mockImplementation(() => { throw new Error('disk full') })
    expect(() => logAuditEvent('login_failure', { email: 'bob@school.edu' })).not.toThrow()
  })

  it('never throws even if creating the log directory fails', () => {
    mkdirSync.mockImplementation(() => { throw new Error('permission denied') })
    expect(() => logAuditEvent('password_change', { userId: 'user-2' })).not.toThrow()
  })

  it('defaults details to an empty object when omitted', () => {
    expect(() => logAuditEvent('logout')).not.toThrow()
    const [, line] = appendFileSync.mock.calls[0]
    const parsed = JSON.parse(line.trim())
    expect(parsed.event).toBe('logout')
  })
})
