import { describe, it, expect } from 'vitest'
import { isNewPersonalBestDay } from '../services/review.service'

describe('isNewPersonalBestDay', () => {
  it('is true when today strictly exceeds every other day on record', () => {
    const cardsPerDay = { '2026-09-08': 15, '2026-09-07': 10, '2026-09-01': 12 }
    expect(isNewPersonalBestDay(cardsPerDay, '2026-09-08')).toBe(true)
  })

  it('is false when today ties the existing best (repeat of an already-standing record)', () => {
    const cardsPerDay = { '2026-09-08': 12, '2026-09-01': 12 }
    expect(isNewPersonalBestDay(cardsPerDay, '2026-09-08')).toBe(false)
  })

  it('is false when today is below the existing best', () => {
    const cardsPerDay = { '2026-09-08': 5, '2026-09-01': 12 }
    expect(isNewPersonalBestDay(cardsPerDay, '2026-09-08')).toBe(false)
  })

  it('is true on a student\'s very first-ever qualifying day (no other days to beat)', () => {
    const cardsPerDay = { '2026-09-08': 3 }
    expect(isNewPersonalBestDay(cardsPerDay, '2026-09-08')).toBe(true)
  })

  it('is false when today has zero cards (e.g. an abandoned/empty session)', () => {
    const cardsPerDay = { '2026-09-07': 10 }
    expect(isNewPersonalBestDay(cardsPerDay, '2026-09-08')).toBe(false)
  })

  it('never compares today against itself when computing the "other days" max', () => {
    // If today were accidentally included in its own comparison, a lone
    // highest day would still read as "not a best" because it'd tie itself.
    const cardsPerDay = { '2026-09-08': 20 }
    expect(isNewPersonalBestDay(cardsPerDay, '2026-09-08')).toBe(true)
  })
})
