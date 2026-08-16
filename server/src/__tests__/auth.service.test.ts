import { describe, it, expect } from 'vitest'
import { generateTempPassword } from '../services/auth.service'
import { PASSWORD_WORDS } from '../data/passwordWords'

describe('generateTempPassword', () => {
  it('produces three lowercase words from the word list plus a two-digit number, hyphen-joined', () => {
    const password = generateTempPassword()
    const parts = password.split('-')
    expect(parts).toHaveLength(4)
    for (const word of parts.slice(0, 3)) {
      expect(PASSWORD_WORDS).toContain(word)
    }
    expect(parts[3]).toMatch(/^\d{2}$/)
  })

  it('is not derived from any input — every call is independent', () => {
    // No teacher name, no date: the whole point of C1 is that nothing
    // guessable feeds into this anymore.
    expect(generateTempPassword.length).toBe(0)
  })

  it('generates distinct passwords across many calls', () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generateTempPassword()))
    // With ~209 words^3 * 100 combinations, 200 draws colliding would be
    // astronomically unlikely — this just guards against a broken RNG that
    // always returns the same value.
    expect(passwords.size).toBeGreaterThan(190)
  })
})
