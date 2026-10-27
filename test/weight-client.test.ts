import { describe, expect, it, vi } from 'vitest'
import {
  requestWeight,
  retryDelayMs,
  weightUrl,
  WeightUnavailableError,
  type WeightDeps,
  type WeightRequest,
} from '../server/src/budget/weight-client'

const request: WeightRequest = {
  siteUrl: 'https://example.com',
  uid: 'api::page.page',
  documentId: 'abc123',
  locale: 'es',
}

const report = {
  data: {
    mode: 'dynamic',
    htmlKb: 1,
    cssKb: 1,
    jsKb: 1,
    fontKb: 1,
    imagesKb: 0,
    totalKb: 4,
    onDemandKb: 0,
    blocks: [],
  },
}

const ok = () => Response.json(report)
const tooMany = (retryAfter?: string) =>
  new Response(null, { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} })

/** Deps whose network answers with the given responses, in order, and whose clock records the waits. */
function deps(...answers: (Response | Error)[]) {
  const grants: string[] = []
  const waits: number[] = []
  const calls = vi.fn(async () => {
    const next = answers.shift()
    if (next instanceof Error) throw next
    return next ?? ok()
  })
  const value: WeightDeps = {
    issueGrant: async () => {
      grants.push(`grant-${grants.length + 1}`)
      return grants.at(-1)!
    },
    fetch: calls as unknown as typeof fetch,
    sleep: async (ms) => {
      waits.push(ms)
    },
  }
  return { value, grants, waits, calls }
}

describe('the weight request', () => {
  it('asks the dynamic mode of the weight route of the site, with the locale of the grant', () => {
    expect(weightUrl(request).href).toBe(
      'https://example.com/api/preview/api%3A%3Apage.page/abc123/weight?mode=dynamic&locale=es'
    )
  })

  it('leaves the locale out for a type that is not localised and keeps the path of a site behind a proxy', () => {
    expect(weightUrl({ ...request, locale: null, siteUrl: 'https://example.com/site/' }).href).toBe(
      'https://example.com/site/api/preview/api%3A%3Apage.page/abc123/weight?mode=dynamic'
    )
  })

  it('sends the grant in the header, follows no redirect and answers the report', async () => {
    const { value, calls } = deps()
    const answer = await requestWeight(value, request)
    expect(answer.totalKb).toBe(4)
    const [, init] = calls.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({ 'x-micelio-preview-grant': 'grant-1' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('when the frontend rate limits', () => {
  it('asks again with a new grant after what Retry-After says', async () => {
    const { value, grants, waits } = deps(tooMany('2'), tooMany('1'), ok())
    expect((await requestWeight(value, request)).totalKb).toBe(4)
    expect(grants).toEqual(['grant-1', 'grant-2', 'grant-3'])
    expect(waits).toEqual([2000, 1000])
  })

  it('gives up after three retries and refuses', async () => {
    const { value, grants } = deps(tooMany('0'), tooMany('0'), tooMany('0'), tooMany('0'), ok())
    await expect(requestWeight(value, request)).rejects.toThrow(WeightUnavailableError)
    expect(grants).toHaveLength(4)
  })

  it.each([
    ['a number of seconds', '3', 3000],
    ['more than the cap', '120', 5000],
    ['nothing', undefined, 1000],
    ['something unreadable', 'soon', 1000],
    ['zero', '0', 0],
  ])('waits for %s', (_name, header, expected) => {
    expect(retryDelayMs(header ?? null)).toBe(expected)
  })

  it('reads an HTTP date, capped, and a date in the past as no wait', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    expect(retryDelayMs('Tue, 27 Oct 2026 12:00:03 GMT', now)).toBe(3000)
    expect(retryDelayMs('Tue, 27 Oct 2026 12:10:00 GMT', now)).toBe(5000)
    expect(retryDelayMs('Tue, 27 Oct 2026 11:00:00 GMT', now)).toBe(0)
  })
})

describe('when the weight cannot be had', () => {
  it.each([
    ['the connection fails', new TypeError('fetch failed')],
    [
      'the frontend redirects',
      new TypeError('fetch failed', { cause: new Error('unexpected redirect') }),
    ],
    [
      'the request times out',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    ],
    ['the route answers 404', new Response(null, { status: 404 })],
    ['the route answers 500', new Response(null, { status: 500 })],
    ['the answer is not JSON', new Response('<html></html>')],
    ['the answer is not a report', Response.json({ data: { totalKb: 'heavy' } })],
    [
      'the answer is a report of the static mode',
      Response.json({ data: { ...report.data, mode: 'static' } }),
    ],
  ])('refuses when %s, and never lets the page through', async (_name, answer) => {
    const { value } = deps(answer)
    await expect(requestWeight(value, request)).rejects.toThrow(WeightUnavailableError)
  })

  it('names no grant in the reason', async () => {
    const { value } = deps(new TypeError('fetch failed'))
    await expect(requestWeight(value, request)).rejects.not.toThrow(/grant-1/)
  })
})
