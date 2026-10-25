import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../server/src/utils/rate-limit'

describe('the rate limiter', () => {
  it('allows the limit in a window and then answers the seconds left', () => {
    let now = 1_000_000
    const limiter = createRateLimiter(2, 60, () => now)
    expect(limiter.hit('a')).toBe(0)
    expect(limiter.hit('a')).toBe(0)
    now += 10_000
    expect(limiter.hit('a')).toBe(50)
  })

  it('counts each key on its own', () => {
    const limiter = createRateLimiter(1, 60, () => 0)
    expect(limiter.hit('a')).toBe(0)
    expect(limiter.hit('b')).toBe(0)
    expect(limiter.hit('a')).toBeGreaterThan(0)
  })

  it('starts a new window when the old one ends', () => {
    let now = 0
    const limiter = createRateLimiter(1, 60, () => now)
    limiter.hit('a')
    expect(limiter.hit('a')).toBeGreaterThan(0)
    now = 60_000
    expect(limiter.hit('a')).toBe(0)
  })
})
