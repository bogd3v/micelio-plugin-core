// A stand-in for a site's frontend that plays its half of the preview (ADR-0019, sections 3 to 5):
// `/_preview` trades the token for a grant with the CMS, the draft route reads the draft by grant and
// the page it answers posts `ready` to the admin and loads the draft again on `load-draft`. The CMS
// is real; only the frontend is not (the image is built from bogd3v/micelio, not from this repository).

import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** The stub site of the browser suite. */
export interface PreviewSite {
  origin: string
  /** Points the stub at the CMS and the API token it calls it with. */
  connect: (cms: { base: string; apiToken: string; adminOrigin: string }) => void
  /** How many tokens it exchanged. */
  readonly exchanges: number
  /** How many times the draft route answered a page. */
  readonly draftLoads: number
  /** The envelope versions its page lists in `ready`; `[2]` plays a frontend this plugin cannot talk to. */
  speaks: number[]
  close: () => Promise<void>
}

interface Section {
  __component?: string
  body?: string
  alt?: string
  title?: string
  poster?: { url?: string }
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
  if (section.__component === 'section.rich-text') {
    return `<section data-section="rich-text"><p>${escapeHtml(section.body ?? '')}</p></section>`
  }
  if (section.__component === 'section.scene') {
    const alt = escapeHtml(section.alt ?? '')
    return isStatic
      ? `<section data-section="scene" data-static-alternative><img src="${escapeHtml(cmsBase + (section.poster?.url ?? ''))}" alt="${alt}" width="120" height="80"></section>`
      : `<section data-section="scene" data-island="scene"><div role="img" aria-label="${alt}">3D scene: ${alt}</div></section>`
  }
  return ''
}

function pageHtml(
  draft: Draft,
  isStatic: boolean,
  cms: { base: string; adminOrigin: string },
  speaks: number[]
): string {
  const locale = draft.locale ?? null
  const ready = JSON.stringify({
    v: 1,
    type: 'ready',
    payload: { v: speaks, documentId: draft.documentId, locale, version: draft.updatedAt },
  })
  return `<!doctype html>
<html lang="${escapeHtml(locale ?? 'en')}">
<head><meta charset="utf-8"><title>${escapeHtml(draft.title)}</title></head>
<body>
<main>
<h1>${escapeHtml(draft.title)}</h1>
${(draft.sections ?? []).map((section) => sectionHtml(section, isStatic, cms.base)).join('\n')}
</main>
<script>
const adminOrigin = ${JSON.stringify(cms.adminOrigin)}
window.addEventListener('message', (event) => {
  if (event.origin !== adminOrigin || event.source !== window.parent) return
  const message = event.data
  if (message && message.v === 1 && message.type === 'load-draft' && message.payload &&
      message.payload.documentId === ${JSON.stringify(draft.documentId)} &&
      message.payload.locale === ${JSON.stringify(locale)}) window.location.reload()
})
if (window.parent !== window) window.parent.postMessage(${ready}, adminOrigin)
</script>
</body>
</html>`
}

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

  async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://stub')
    response.setHeader('Cache-Control', 'private, no-store')
    if (!cms) {
      response.writeHead(503).end()
      return
    }
    const auth = { Authorization: `Bearer ${cms.apiToken}` }
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
      exchanges++
      const { data } = (await answer.json()) as {
        data: { grant: string; documentId: string; locale: string | null }
      }
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
    const draftPath = /^\/drafts\/pages\/([\w-]+)$/.exec(url.pathname)
    const grant = grantOf(request)
    if (!draftPath || !grant) {
      response.writeHead(404).end('Page not found')
      return
    }
    const query = new URLSearchParams({ documentId: draftPath[1] ?? '' })
    query.set('populate[sections][on][section.scene][populate]', '*')
    query.set('populate[sections][on][section.rich-text][populate]', '*')
    const locale = url.searchParams.get('locale')
    if (locale) query.set('locale', locale)
    const answer = await fetch(`${cms.base}/api/micelio/preview/draft?${query}`, {
      headers: { ...auth, 'X-Micelio-Preview-Grant': grant },
    })
    if (!answer.ok) {
      response.writeHead(404).end('Page not found')
      return
    }
    draftLoads++
    const { data } = (await answer.json()) as { data: Draft }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(pageHtml(data, url.searchParams.get('mode') === 'static', cms, site.speaks))
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
  return site
}
