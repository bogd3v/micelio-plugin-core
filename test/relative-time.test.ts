import { describe, expect, it } from 'vitest'
import { relativeTime } from '../admin/src/utils/relativeTime'

const NOW = Date.parse('2026-11-11T16:00:00.000Z')
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

describe('relativeTime', () => {
  it('uses the largest unit that fits, rounded down', () => {
    expect(relativeTime(ago(0), NOW, 'en')).toBe('now')
    expect(relativeTime(ago(30), NOW, 'en')).toBe('30 seconds ago')
    expect(relativeTime(ago(119), NOW, 'en')).toBe('1 minute ago')
    expect(relativeTime(ago(125), NOW, 'en')).toBe('2 minutes ago')
    expect(relativeTime(ago(3 * 3600 + 10), NOW, 'en')).toBe('3 hours ago')
    expect(relativeTime(ago(2 * 86400), NOW, 'en')).toBe('2 days ago')
  })

  it('writes it in the language of the admin', () => {
    expect(relativeTime(ago(125), NOW, 'es')).toBe('hace 2 minutos')
  })

  it('reads a moment in the future as now', () => {
    expect(relativeTime(ago(-3), NOW, 'en')).toBe('now')
  })
})
