import { describe, it, expect } from 'vitest'
import type { Request } from 'express'
import { authRateLimitKey } from '../routes/auth'

function makeReq(ip: string, email?: unknown): Request {
  return { ip, body: email === undefined ? {} : { email } } as unknown as Request
}

describe('authRateLimitKey', () => {
  it('produces different keys for two different students behind the same IP', () => {
    const keyA = authRateLimitKey(makeReq('1.2.3.4', 'alice@school.edu'))
    const keyB = authRateLimitKey(makeReq('1.2.3.4', 'bob@school.edu'))
    expect(keyA).not.toBe(keyB)
  })

  it('produces the same key for the same student retrying from the same IP', () => {
    const key1 = authRateLimitKey(makeReq('1.2.3.4', 'alice@school.edu'))
    const key2 = authRateLimitKey(makeReq('1.2.3.4', 'alice@school.edu'))
    expect(key1).toBe(key2)
  })

  it('is case-insensitive and trims whitespace on the email, matching login lookup semantics', () => {
    const key1 = authRateLimitKey(makeReq('1.2.3.4', 'Alice@School.edu'))
    const key2 = authRateLimitKey(makeReq('1.2.3.4', '  alice@school.edu  '))
    expect(key1).toBe(key2)
  })

  it('still differentiates by IP when the email is missing or malformed', () => {
    const keyA = authRateLimitKey(makeReq('1.2.3.4'))
    const keyB = authRateLimitKey(makeReq('5.6.7.8'))
    expect(keyA).not.toBe(keyB)
  })

  it('does not throw when email is a non-string value', () => {
    expect(() => authRateLimitKey(makeReq('1.2.3.4', 12345))).not.toThrow()
  })
})
