/**
 * Formats a UTC ISO timestamp for display in Asia/Shanghai time, in the
 * fixed "2026 Aug 27, 13:45" order (year, short month, day, 24h time) —
 * no Intl locale outputs this exact sequence natively, so the parts are
 * pulled out and reassembled by hand.
 */
export function formatLastLogin(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')} ${get('month')} ${get('day')}, ${get('hour')}:${get('minute')}`
}
