// A stand-in for a site's frontend that plays its half of the weight report (ADR-0019, amendment of
// 2026-10-25): `GET /api/preview/<uid>/<documentId>/weight` redeems the system grant of the header with
// the real CMS (the draft route, which says who the grant acts for) and answers a report of the draft it
// got. The CMS is real; only the frontend is not (its image is built from bogd3v/micelio, not here).

import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** How the stub answers one request, instead of a report. */
export type WeightAnswer =
  { status: number; retryAfter?: string } | 'redirect' | 'not-json' | 'wrong-shape'

/** A request the stub received. */
export interface WeightRequestSeen {
  path: string
  query: Record<string, string>
  /** The grant the request carried, which the suites compare and never print. */
  grant: string | null
  /** Where it came from: the header is the CMS's system grant, the cookie the editor's. */
  via: 'header' | 'cookie' | null
}

/** How a stub answers weight requests: what the suites change between tests. */
export interface WeightBehaviour {
  /** Every request to the weight route, in order. */
  readonly requests: WeightRequestSeen[]
  /** Answers the next requests with these, in order, before it answers reports again. */
  queue: WeightAnswer[]
  /** The weight of the page without its blocks, in kB. */
  baseKb: number
  /** The weight each block adds, in kB; or the weight of each block by catalogue id. */
  blockKb: number | Record<string, number>
  /** The script a block's island loads only once used, in kB, by catalogue id; none by default. */
  onDemandKb?: Record<string, number>
  /** Where a `'redirect'` answer sends the caller; a port nobody listens on by default. */
  redirectTo?: string
  /** Runs when a request arrives, before the frontend asks the CMS for the draft: a test saves the draft here. */
  beforeRead?: () => Promise<void>
  /** Runs after the grant was redeemed, while the page renders: a test saves the draft here. */
  onRender?: () => Promise<void>
}

/** The stub frontend of the budget suites. */
export interface WeightSite extends WeightBehaviour {
  origin: string
  close(): Promise<void>
}

/** What the stub needs of the CMS it plays the frontend of. */
export interface WeightSiteCms {
  base: string
  /** The frontend's API token. */
  apiToken: string
  siteSlug: string
  /**
   * The admin's origin. Its pages may read the weight route with the editor's own grant, in the
   * cookie `grantCookie` names, as the frontend allows (ADR-0019, amendment of 2026-10-25).
   */
  admin?: { origin: string; grantCookie: string }
  /** The `populate` the frontend reads the draft with, as query pairs; every first-level relation by default. */
  populate?: Record<string, string>
}

/** A fresh behaviour: a 10 kB page that gains 5 kB for each block. */
export function newWeightBehaviour(): WeightBehaviour {
  return { requests: [], queue: [], baseKb: 10, blockKb: 5 }
}

interface Draft {
  blocks?: { __component?: string }[]
  sections?: { __component?: string }[]
}

const round = (value: number) => Math.round(value * 10) / 10

function report(site: WeightBehaviour, draft: Draft) {
  const zone = draft.blocks ?? draft.sections ?? []
  const blocks = zone.map((block) => {
    const id = (block.__component ?? 'unknown').split('.').pop() ?? 'unknown'
    const kb = typeof site.blockKb === 'number' ? site.blockKb : (site.blockKb[id] ?? 0)
    return { id, kb, onDemandKb: site.onDemandKb?.[id] ?? 0 }
  })
  const totalKb = round(site.baseKb + blocks.reduce((sum, block) => sum + block.kb, 0))
  return {
    mode: 'dynamic',
    htmlKb: round(totalKb / 4),
    cssKb: round(totalKb / 4),
    jsKb: round(totalKb / 4),
    fontKb: round(totalKb / 4),
    imagesKb: 0,
    totalKb,
    onDemandKb: round(blocks.reduce((sum, block) => sum + block.onDemandKb, 0)),
    blocks,
  }
}

/**
 * Answers a request if it is for the weight route, as the frontend does; `false` for any other.
 *
 * @remarks
 * The CMS confirms the grant of the header once, with the draft route, and says who it acts for.
 */
export async function answerWeight(
  behaviour: WeightBehaviour,
  cms: WeightSiteCms,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://stub')
  const match = /^\/api\/preview\/([^/]+)\/([^/]+)\/weight$/.exec(url.pathname)
  if (!match) return false
  const header = request.headers['x-micelio-preview-grant']
  const cookie = cms.admin
    ? (request.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cms.admin!.grantCookie}=`))
        ?.slice(cms.admin.grantCookie.length + 1)
    : undefined
  // The header is the CMS's (a system grant); the cookie is the editor's (an admin grant).
  const grant = typeof header === 'string' ? header : cookie
  const actor = typeof header === 'string' ? 'system' : 'admin'
  if (cms.admin && request.headers.origin === cms.admin.origin) {
    response.setHeader('Access-Control-Allow-Origin', cms.admin.origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Vary', 'Origin')
  }
  behaviour.requests.push({
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    grant: typeof grant === 'string' ? grant : null,
    via: typeof header === 'string' ? 'header' : cookie ? 'cookie' : null,
  })
  if (typeof grant !== 'string') {
    response.writeHead(404).end()
    return true
  }
  const next = behaviour.queue.shift()
  if (next === 'redirect') {
    response
      .writeHead(302, { Location: behaviour.redirectTo ?? 'http://127.0.0.1:1/elsewhere' })
      .end()
    return true
  }
  if (typeof next === 'object') {
    response.writeHead(next.status, next.retryAfter ? { 'Retry-After': next.retryAfter } : {}).end()
    return true
  }
  await behaviour.beforeRead?.()
  const query = new URLSearchParams({
    site: cms.siteSlug,
    documentId: decodeURIComponent(match[2] ?? ''),
  })
  const locale = url.searchParams.get('locale')
  if (locale) query.set('locale', locale)
  for (const [key, value] of Object.entries(cms.populate ?? { populate: '*' }))
    query.set(key, value)
  const read = await fetch(`${cms.base}/api/micelio/preview/draft?${query}`, {
    headers: { Authorization: `Bearer ${cms.apiToken}`, 'X-Micelio-Preview-Grant': grant },
  })
  if (!read.ok) {
    response.writeHead(404).end()
    return true
  }
  const { data, meta } = (await read.json()) as { data: Draft; meta: { actor: string } }
  if (meta.actor !== actor) {
    response.writeHead(404).end()
    return true
  }
  await behaviour.onRender?.()
  if (next === 'not-json') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>')
    return true
  }
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(
    JSON.stringify(
      next === 'wrong-shape' ? { data: { totalKb: 'heavy' } } : { data: report(behaviour, data) }
    )
  )
  return true
}

/** Starts the stub on 127.0.0.1. */
export async function startWeightSite(cms: WeightSiteCms): Promise<WeightSite> {
  const behaviour = newWeightBehaviour()
  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        if (!(await answerWeight(behaviour, cms, request, response))) response.writeHead(404).end()
      } catch {
        response.writeHead(500).end()
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return Object.assign(behaviour, {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  })
}
