/** A fixed-window counter per key. */
export interface RateLimiter {
  /**
   * Counts one request for a key.
   *
   * @returns `0` when the request is allowed, else the seconds until the window of the key ends.
   */
  hit(key: string): number
}

/**
 * A fixed-window rate limiter that keeps its counts in this process.
 *
 * @remarks
 * Each process of a multi-process host counts for itself, so the real limit is `limit` times the
 * number of processes. Keys are identifiers (an admin user id, an API token id), never an address.
 *
 * @param limit - Requests a key may make in a window.
 * @param windowSeconds - The length of the window.
 * @param now - The clock, in milliseconds since the Unix epoch.
 */
export function createRateLimiter(
  limit: number,
  windowSeconds: number,
  now: () => number = Date.now
): RateLimiter {
  const windows = new Map<string, { endsAt: number; count: number }>()
  return {
    hit(key) {
      const moment = now()
      for (const [other, window] of windows) {
        if (window.endsAt <= moment) windows.delete(other)
      }
      const window = windows.get(key) ?? { endsAt: moment + windowSeconds * 1000, count: 0 }
      window.count += 1
      windows.set(key, window)
      return window.count > limit ? Math.ceil((window.endsAt - moment) / 1000) : 0
    },
  }
}
