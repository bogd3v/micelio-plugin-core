const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago `iso` was, worked out against `now` and written in `locale` ("2 minutes ago",
 * "hace 2 minutos"; "now" under a second).
 *
 * @param iso - The moment, an ISO 8601 date.
 * @param now - The current time in milliseconds since the epoch.
 * @param locale - The admin's language, a BCP 47 tag.
 * @remarks
 * The largest unit that fits, rounded down: 119 seconds is "1 minute ago". A moment in the future
 * (a clock a little behind the server's) reads as now, never as "in 3 seconds".
 */
export function relativeTime(iso: string, now: number, locale: string): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (seconds < MINUTE) return format.format(-seconds, 'second')
  if (seconds < HOUR) return format.format(-Math.floor(seconds / MINUTE), 'minute')
  if (seconds < DAY) return format.format(-Math.floor(seconds / HOUR), 'hour')
  return format.format(-Math.floor(seconds / DAY), 'day')
}
