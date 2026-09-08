import { describe, it, expect } from 'vitest'
import { isAbandoned, ABANDON_THRESHOLD_MS } from '../scripts/close-abandoned-sessions'

describe('isAbandoned', () => {
  const now = new Date('2026-09-08T12:00:00Z')

  it('is not abandoned when the last event is within the 3-hour threshold', () => {
    const session = {
      id: 's1',
      startedAt: new Date('2026-09-08T09:00:00Z'),
      events: [{ reviewedAt: new Date('2026-09-08T10:00:00Z') }], // 2h ago
    }
    expect(isAbandoned(session, now)).toBe(false)
  })

  it('is abandoned once the last event is older than the 3-hour threshold', () => {
    const session = {
      id: 's1',
      startedAt: new Date('2026-09-08T07:00:00Z'),
      events: [{ reviewedAt: new Date('2026-09-08T08:00:00Z') }], // 4h ago
    }
    expect(isAbandoned(session, now)).toBe(true)
  })

  it('falls back to startedAt when the session has no events at all', () => {
    const recentNoEvents = {
      id: 's1',
      startedAt: new Date('2026-09-08T10:30:00Z'), // 1.5h ago
      events: [],
    }
    expect(isAbandoned(recentNoEvents, now)).toBe(false)

    const staleNoEvents = {
      id: 's2',
      startedAt: new Date('2026-09-08T07:00:00Z'), // 5h ago
      events: [],
    }
    expect(isAbandoned(staleNoEvents, now)).toBe(true)
  })

  it('is not abandoned exactly at the threshold boundary (strictly greater-than)', () => {
    const session = {
      id: 's1',
      startedAt: new Date('2026-09-08T09:00:00Z'),
      events: [{ reviewedAt: new Date(now.getTime() - ABANDON_THRESHOLD_MS) }],
    }
    expect(isAbandoned(session, now)).toBe(false)
  })

  it('uses the most recent event when multiple are present (caller passes events sorted desc, take 1)', () => {
    // The real query orders desc and takes only 1, so this mirrors that shape —
    // only the single most-recent event is ever passed in.
    const session = {
      id: 's1',
      startedAt: new Date('2026-09-08T05:00:00Z'),
      events: [{ reviewedAt: new Date('2026-09-08T11:00:00Z') }], // 1h ago
    }
    expect(isAbandoned(session, now)).toBe(false)
  })
})
