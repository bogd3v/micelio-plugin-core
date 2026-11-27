// A stand-in for a site's frontend that plays its half of the preview (ADR-0019, sections 3 to 5):
// `/_preview` trades the token for a grant with the CMS, the draft route reads the draft by grant and
// the page it answers posts `ready` to the admin and loads the draft again on `load-draft`. The CMS
// is real; only the frontend is not (the image is built from bogd3v/micelio, not from this repository).

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { blocksScript, markBlocks, runScript, type RunBehaviour } from './preview-site-blocks'
import { solidPng } from './png'
import { themeRoutes, type ThemeRoutes } from './theme-site'
import { answerWeight, newWeightBehaviour, type WeightBehaviour } from './weight-site'

/** One pair of the contrast matrix, as the frontend's contrast route answers it. */
export interface ContrastPairAnswer {
  role: string
  surface: string
  ratio: number | null
  min: number
  passes: boolean
}

/** How one mode of the stub's theme answers the contrast route. */
export interface ContrastModeBehaviour {
  /**
   * The accent a candidate of the mode resolves to: the candidate itself, another colour (the
   * frontend would move it) or `null` (none passes). A mode with no candidate answers `null`.
   */
  accent: 'candidate' | string | null
  pairs: ContrastPairAnswer[]
}

/** How the stub's contrast route answers (`GET /_micelio/contrast`, bogd3v/micelio#737). */
export interface ContrastBehaviour {
  /** The modes of the theme, in order, and what each answers. */
  modes: Record<string, ContrastModeBehaviour>
  /** Answers this status to every request instead, as a frontend without the route answers 404. */
  status?: number
  /** Every request, in order: its query, and whether it carried a grant (which the suites never print). */
  readonly requests: { documentId: string | null; accents: string[]; hasGrant: boolean }[]
}

/** A theme with the modes `light` and `dark` whose candidates pass as given. */
export function newContrastBehaviour(): ContrastBehaviour {
  const pairs = (): ContrastPairAnswer[] => [
    { role: 'accent', surface: 'surface', ratio: 5.12, min: 4.5, passes: true },
    { role: 'on-accent', surface: 'accent', ratio: 6.3, min: 4.5, passes: true },
    { role: 'ink', surface: 'surface', ratio: 14.2, min: 4.5, passes: true },
  ]
  return {
    modes: {
      light: { accent: 'candidate', pairs: pairs() },
      dark: { accent: 'candidate', pairs: pairs() },
    },
    requests: [],
  }
}

/** The stub site of the browser suite. */
export interface PreviewSite {
  origin: string
  /** Points the stub at the CMS and the API token it calls it with. */
  connect: (cms: { base: string; apiToken: string; adminOrigin: string }) => void
  /**
   * How its weight route answers (`GET /api/preview/<uid>/<documentId>/weight`): the weight of the
   * page and of each block, which the cost meter shows. Like the frontend's it takes the editor's
   * grant in its cookie, from the admin's origin, and a system grant in the header.
   */
  weight: WeightBehaviour
  /**
   * How its contrast route answers (`GET /_micelio/contrast`): like the frontend's it takes the
   * editor's grant in its cookie, with `documentId` the document it names, sends the CORS headers of
   * its card route to the admin's origin, and answers the same 404 to anything else.
   */
  contrast: ContrastBehaviour
  /** How many tokens it exchanged. */
  readonly exchanges: number
  /** How many times the draft route answered a page. */
  readonly draftLoads: number
  /**
   * The requests its card route got (`GET /api/preview/<uid>/<documentId>/card`, bogd3v/micelio#734): it
   * answers a PNG of 1200 by 630 to the editor's grant in the cookie, with the CORS headers of the
   * admin's credentialed `fetch`, and a 404 to anything else, as the frontend does.
   */
  readonly cardRequests: { uid: string; documentId: string; grant: string | undefined }[]
  /** The envelope versions its page lists in `ready`; `[2]` plays a frontend this plugin cannot talk to. */
  speaks: number[]
  /**
   * How its page answers `micelio:run`, read when the page loads (`runScript`); `{ kind: 'answer' }`
   * by default.
   */
  run: RunBehaviour
  /**
   * Its theme routes (`GET /api/theme/status` and `/api/theme/catalogue`, `theme-site.ts`). A token bound to a
   * theme no store holds answers `409` `themeNotInstalled` from `/_preview`, and a draft page names the theme it
   * renders in `data-theme` of its `<html>`: the token's, else the active one (bogd3v/micelio#736).
   */
  themes: ThemeRoutes
  /** Its page never posts `ready`, as a frame that gets the 404 page of a refused cookie, or an older frontend. */
  isSilent: boolean
  /**
   * Its draft route answers what WebKit gets when it sends no cookie in the frame: a 404 that refuses to
   * be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).
   */
  isRefused: boolean
  close: () => Promise<void>
}

interface Section {
  __component?: string
  body?: string
  alt?: string
  title?: string
  columns?: string
  items?: { title?: string; icon?: { url?: string } | null }[]
  poster?: { url?: string }
  images?: { url?: string; alternativeText?: string | null }[]
  code?: string
}

interface Draft {
  documentId: string
  title: string
  locale?: string | null
  updatedAt: string
  sections?: Section[]
}

const GRANT_COOKIE = 'stub_preview_grant'

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

// A heavy island on the page, or its static alternative: the poster, described by the scene's alt text.
function sectionHtml(section: Section, isStatic: boolean, cmsBase: string): string {
  if (section.__component === 'shared.rich-text') {
    return `<section data-section="prose"><p data-field="body">${escapeHtml(section.body ?? '')}</p></section>`
  }
  if (section.__component === 'section.scene') {
    const alt = escapeHtml(section.alt ?? '')
    return isStatic
      ? `<section data-section="scene" data-static-alternative><img src="${escapeHtml(cmsBase + (section.poster?.url ?? ''))}" alt="${alt}" width="120" height="80"></section>`
      : `<section data-section="scene" data-island="scene"><div role="img" aria-label="${alt}">3D scene: ${alt}</div></section>`
  }
  if (section.__component === 'section.feature-grid') {
    const items = (section.items ?? [])
      .map(
        (item) =>
          `<li class="myc-section-item"><span data-field="title">${escapeHtml(item.title ?? '')}</span>${
            item.icon?.url
              ? `<img data-icon src="${escapeHtml(cmsBase + item.icon.url)}" alt="" width="24" height="24">`
              : ''
          }</li>`
      )
      .join('')
    return `<section data-section="feature-grid" data-columns="${escapeHtml(section.columns ?? '')}"><h2 data-field="title">${escapeHtml(section.title ?? '')}</h2><ul>${items}</ul></section>`
  }
  if (section.__component === 'section.gallery') {
    const images = (section.images ?? [])
      .map(
        (image) =>
          `<img src="${escapeHtml(cmsBase + (image.url ?? ''))}" alt="${escapeHtml(image.alternativeText ?? '')}" width="60" height="40">`
      )
      .join('')
    return `<section data-section="gallery"><h2 data-field="title">${escapeHtml(section.title ?? '')}</h2>${images}</section>`
  }
  if (section.__component === 'section.logo-cloud') {
    return `<section data-section="logo-cloud"><h2 data-field="title">${escapeHtml(section.title ?? '')}</h2></section>`
  }
  return ''
}

function pageHtml(
  draft: Draft,
  theme: string,
  isStatic: boolean,
  cms: { base: string; adminOrigin: string },
  speaks: number[],
  isSilent: boolean,
  run: RunBehaviour
): string {
  const locale = draft.locale ?? null
  const ready = JSON.stringify({
    v: 1,
    type: 'ready',
    payload: { v: speaks, documentId: draft.documentId, locale, version: draft.updatedAt },
  })
  return `<!doctype html>
<html lang="${escapeHtml(locale ?? 'en')}" data-theme="${escapeHtml(theme)}">
<head><meta charset="utf-8"><title>${escapeHtml(draft.title)}</title></head>
<body>
<main>
<h1>${escapeHtml(draft.title)}</h1>
${markBlocks(draft.sections ?? [], (section) => sectionHtml(section, isStatic, cms.base))}
</main>
<script>
// The frontend's page loads at the top, as the maintainer saw it after each autosave (#138); a reload
// that restores the scroll would hide it.
history.scrollRestoration = 'manual'
const adminOrigin = ${JSON.stringify(cms.adminOrigin)}
window.addEventListener('message', (event) => {
  if (event.origin !== adminOrigin || event.source !== window.parent) return
  const message = event.data
  if (message && message.v === 1 && message.type === 'load-draft' && message.payload &&
      message.payload.documentId === ${JSON.stringify(draft.documentId)} &&
      message.payload.locale === ${JSON.stringify(locale)}) window.location.reload()
})
${isSilent ? '' : `if (window.parent !== window) { window.parent.postMessage(${ready}, adminOrigin); ${blocksScript(cms.adminOrigin, draft.updatedAt)} ${runScript(cms.adminOrigin, draft.updatedAt, draft.sections ?? [], run)} }`}
</script>
</body>
</html>`
}

// The accent queries of the contrast route: `<mode>:#RRGGBB`, each mode once, at most 16.
const ACCENT_QUERY = /^([a-z][a-z0-9-]*):(#[0-9a-fA-F]{6})$/

function grantOf(request: http.IncomingMessage): string | undefined {
  const cookie = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GRANT_COOKIE}=`))
  return cookie?.slice(GRANT_COOKIE.length + 1)
}

/** Starts the stub site on 127.0.0.1; call `connect` once the CMS listens. */
export async function startPreviewSite(): Promise<PreviewSite> {
  let cms: { base: string; apiToken: string; adminOrigin: string } | undefined
  let exchanges = 0
  let draftLoads = 0
  const cardRequests: PreviewSite['cardRequests'] = []

  async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://stub')
    response.setHeader('Cache-Control', 'private, no-store')
    if (!cms) {
      response.writeHead(503).end()
      return
    }
    if (await site.themes.answer(request, response)) return
    const auth = { Authorization: `Bearer ${cms.apiToken}` }
    const populate = {
      'populate[sections][on][section.scene][populate]': '*',
      'populate[sections][on][shared.rich-text][populate]': '*',
    }
    if (
      await answerWeight(
        site.weight,
        {
          ...cms,
          siteSlug: 'default',
          populate,
          admin: { origin: cms.adminOrigin, grantCookie: GRANT_COOKIE },
        },
        request,
        response
      )
    ) {
      return
    }
    if (url.pathname === '/_micelio/contrast') {
      await answerContrast(url, request, response, cms)
      return
    }
    const card = /^\/api\/preview\/([^/]+)\/([\w-]+)\/card$/.exec(url.pathname)
    if (card) {
      const grant = grantOf(request)
      cardRequests.push({
        uid: decodeURIComponent(card[1] ?? ''),
        documentId: card[2] ?? '',
        grant,
      })
      if (request.headers.origin === cms.adminOrigin) {
        response.setHeader('Access-Control-Allow-Origin', cms.adminOrigin)
        response.setHeader('Access-Control-Allow-Credentials', 'true')
        response.setHeader('Vary', 'Origin')
      }
      if (!grant) {
        response.writeHead(404).end('Page not found')
        return
      }
      response.writeHead(200, { 'Content-Type': 'image/png' }).end(solidPng(1200, 630))
      return
    }
    if (url.pathname === '/_preview') {
      const answer = await fetch(`${cms.base}/api/micelio/preview/exchange`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: url.searchParams.get('token') }),
      })
      if (!answer.ok) {
        response.writeHead(404).end('Page not found')
        return
      }
      const { data } = (await answer.json()) as {
        data: {
          grant: string
          documentId: string
          locale: string | null
          overrides?: { theme?: { id: string; version: string } }
        }
      }
      const theme = data.overrides?.theme
      if (theme && !site.themes.isInstalled(theme)) {
        response
          .writeHead(409, { 'Content-Type': 'application/problem+json' })
          .end(JSON.stringify({ status: 409, code: 'themeNotInstalled', title: 'Conflict' }))
        return
      }
      exchanges++
      const query = new URLSearchParams()
      if (data.locale) query.set('locale', data.locale)
      if (url.searchParams.get('mode') === 'static') query.set('mode', 'static')
      response.writeHead(303, {
        'Set-Cookie': `${GRANT_COOKIE}=${data.grant}; Path=/; HttpOnly`,
        Location: `/drafts/pages/${data.documentId}?${query}`,
      })
      response.end()
      return
    }
    if (site.isRefused && url.pathname.startsWith('/drafts/')) {
      response
        .writeHead(404, {
          'Content-Security-Policy': "frame-ancestors 'none'",
          'X-Frame-Options': 'DENY',
        })
        .end('Page not found')
      return
    }
    const draftPath = /^\/drafts\/pages\/([\w-]+)$/.exec(url.pathname)
    const grant = grantOf(request)
    if (!draftPath || !grant) {
      response.writeHead(404).end('Page not found')
      return
    }
    const query = new URLSearchParams({ documentId: draftPath[1] ?? '' })
    query.set('populate[sections][on][section.scene][populate]', '*')
    query.set('populate[sections][on][shared.rich-text][populate]', '*')
    const locale = url.searchParams.get('locale')
    if (locale) query.set('locale', locale)
    const cmsBase = cms.base
    const read = (extra: URLSearchParams) =>
      fetch(`${cmsBase}/api/micelio/preview/draft?${extra}`, {
        headers: { ...auth, 'X-Micelio-Preview-Grant': grant },
      })
    // The sections of the builder's landing, then of the page type (the media fields); a type whose zone
    // does not hold them refuses the populate, and the plain read is the page's.
    const grid = 'populate[sections][on][section.feature-grid][populate][items][populate]'
    const withMore = new URLSearchParams(query)
    withMore.set(grid, '*')
    withMore.set('populate[sections][on][section.logo-cloud][populate]', '*')
    const withMedia = new URLSearchParams(query)
    withMedia.set(grid, '*')
    withMedia.set('populate[sections][on][section.gallery][populate]', '*')
    // The islands' page holds the Playground, whose code the page's run reads.
    const withPlayground = new URLSearchParams(query)
    withPlayground.set('populate[sections][on][shared.playground][populate]', '*')
    let answer = await read(withMore)
    if (!answer.ok) answer = await read(withMedia)
    if (!answer.ok) answer = await read(withPlayground)
    if (!answer.ok) answer = await read(query)
    if (!answer.ok) {
      response.writeHead(404).end('Page not found')
      return
    }
    draftLoads++
    const { data, meta } = (await answer.json()) as {
      data: Draft
      meta?: { overrides?: { theme?: { id: string } } }
    }
    const theme = meta?.overrides?.theme?.id ?? (await site.themes.active()).id
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(
      pageHtml(
        data,
        theme,
        url.searchParams.get('mode') === 'static',
        cms,
        site.speaks,
        site.isSilent,
        site.run
      )
    )
  }

  // The frontend's contrast route (`docs/api.md` of `micelio`, "Contrast of the active theme"): the
  // CMS checks the grant with one draft read, and a candidate resolves as the test set its mode.
  async function answerContrast(
    url: URL,
    request: http.IncomingMessage,
    response: http.ServerResponse,
    target: { base: string; apiToken: string; adminOrigin: string }
  ) {
    const behaviour = site.contrast
    const grant = grantOf(request)
    const documentId = url.searchParams.get('documentId')
    const accents = url.searchParams.getAll('accent')
    behaviour.requests.push({ documentId, accents, hasGrant: grant !== undefined })
    response.setHeader('X-Robots-Tag', 'noindex, nofollow')
    response.setHeader('Referrer-Policy', 'no-referrer')
    if (request.headers.origin === target.adminOrigin) {
      response.setHeader('Access-Control-Allow-Origin', target.adminOrigin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
      response.setHeader('Vary', 'Origin')
    }
    if (behaviour.status !== undefined) {
      response.writeHead(behaviour.status).end()
      return
    }
    const candidates = new Map<string, string>()
    for (const accent of accents) {
      const match = ACCENT_QUERY.exec(accent)
      if (!match || candidates.has(match[1]!)) {
        response.writeHead(404).end('Page not found')
        return
      }
      candidates.set(match[1]!, match[2]!)
    }
    if (!grant || !documentId || candidates.size > 16) {
      response.writeHead(404).end('Page not found')
      return
    }
    const read = await fetch(
      `${target.base}/api/micelio/preview/draft?${new URLSearchParams({ documentId })}`,
      {
        headers: {
          Authorization: `Bearer ${target.apiToken}`,
          'X-Micelio-Preview-Grant': grant,
        },
      }
    )
    const meta = read.ok ? ((await read.json()) as { meta?: { actor?: string } }).meta : undefined
    if (meta?.actor !== 'admin') {
      response.writeHead(404).end('Page not found')
      return
    }
    const modes = Object.entries(behaviour.modes).map(([mode, { accent, pairs }]) => {
      const candidate = candidates.get(mode)
      const resolved =
        candidate === undefined ? null : accent === 'candidate' ? candidate.toLowerCase() : accent
      return {
        mode,
        accent: resolved
          ? { accent: resolved, accentSoft: '#eef1ea', accentHover: resolved, onAccent: '#ffffff' }
          : null,
        pairs,
      }
    })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: { theme: 'stub-theme', modes } }))
  }

  const server = http.createServer(async (request, response) => {
    try {
      await handle(request, response)
    } catch {
      // A failing stub answers 500 so a test fails on the page, not on a hung request.
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const site: PreviewSite = {
    speaks: [1],
    weight: newWeightBehaviour(),
    contrast: newContrastBehaviour(),
    run: { kind: 'answer' },
    isSilent: false,
    isRefused: false,
    themes: themeRoutes(),
    origin: `http://127.0.0.1:${port}`,
    connect: (next) => {
      cms = next
    },
    get exchanges() {
      return exchanges
    },
    get draftLoads() {
      return draftLoads
    },
    cardRequests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
  return site
}
