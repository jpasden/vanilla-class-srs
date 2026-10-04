const dayFormatters = new Map<string, Intl.DateTimeFormat>()

export function dayKey(date: Date, timeZone: string) {
  let formatter = dayFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    if (dayFormatters.size >= 100) dayFormatters.clear()
    dayFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function shiftDay(key: string, days: number) {
  return new Date(Date.parse(key + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10)
}
export function midnight(key: string, timeZone: string) {
  const target = Date.parse(key + 'T00:00:00Z')
  let value = target
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value))
    const get = (type: string) => parts.find((p) => p.type === type)!.value
    const displayed = Date.parse(
      `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
    )
    value += target - displayed
  }
  return new Date(value)
}
export function reportRange(days: number, tz: string, now = new Date()) {
  const today = dayKey(now, tz)
  const first = shiftDay(today, 1 - days)
  return {
    days,
    timeZone: tz,
    today,
    first,
    start: midnight(first, tz),
    end: midnight(shiftDay(today, 1), tz),
    trendStart: midnight(shiftDay(first, -6), tz),
  }
}
export function accuracy(grades: number[]) {
  return grades.length ? grades.filter((g) => g >= 2).length / grades.length : null
}
