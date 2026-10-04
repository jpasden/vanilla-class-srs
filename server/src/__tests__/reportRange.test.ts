import { describe, it, expect } from 'vitest'
import { accuracy, reportRange, dayKey } from '../services/reportRange.service'

describe('Subject/Grade report boundaries', () => {
  it('uses Shanghai local calendar days rather than UTC days', () => {
    const range = reportRange(7, 'Asia/Shanghai', new Date('2026-10-04T16:30:00Z'))
    expect(range.today).toBe('2026-10-05')
    expect(range.start.toISOString()).toBe('2026-09-28T16:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-10-05T16:00:00.000Z')
    expect(dayKey(new Date('2026-10-04T16:00:00Z'), 'Asia/Shanghai')).toBe('2026-10-05')
  })
  it('accounts for a DST transition in a reporting window', () => {
    const range = reportRange(2, 'America/New_York', new Date('2026-03-08T17:00:00Z'))
    expect(range.start.toISOString()).toBe('2026-03-07T05:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })
  it('rejects an invalid timezone', () => expect(() => reportRange(30, 'Invalid/Zone')).toThrow())
  it('weights accuracy by events and returns null for no reviews', () => {
    expect(accuracy([...Array(90).fill(3), ...Array(10).fill(1), 3, ...Array(9).fill(1)])).toBeCloseTo(
      91 / 110,
    )
    expect(accuracy([])).toBeNull()
  })
})
