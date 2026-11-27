import type { Core, UID } from '@strapi/strapi'
import { DEFAULT_PAGE_TYPE } from '../constants/budget'
import { SITE_UID } from '../constants/site'
import { THEME_ACTIVATION_UID } from '../constants/themes'
import { hasPageSettings } from '../page-settings'
import { isSiteScoped } from '../site-scope'
import { readSites } from '../status/read'
import type {
  FrontendThemeCatalogue,
  FrontendThemeStatus,
  ThemePin,
  ThemePreviewPage,
  ThemesAnswer,
} from '../types/themes'
import { isPinInstalled, isSamePin, parseThemeCatalogue, parseThemeStatus, pinFrom } from './rules'

// An answer that takes longer counts as none, as the host check's `/_health` (`host-check/facts.ts`).
const FRONTEND_TIMEOUT_MS = 2000

/** A site as the Themes routes read it: its row ids, its origin and its pin. */
export interface ThemeSite {
  /** The database id of the row the log relates to. */
  id: number
  documentId: string
  locale: string | null
  slug: string
  name: string
  isDefault: boolean
  /** The origin of the site's `url`; `null` when it has none. */
  origin: string | null
  /** The site's `theme` component as stored, the pin and the fields the page does not change. */
  theme: Record<string, unknown> | null
}

/** The frontend's status and catalogue; each `null` when it did not answer one. */
export interface FrontendThemes {
  status: FrontendThemeStatus | null
  catalogue: FrontendThemeCatalogue | null
}

/**
 * Gathers what `GET /micelio/themes?site=` answers for the site `slug`, the default site when it is
 * `null`; `null` when there is no such site.
 *
 * @remarks
 * Asks the site's frontend for its theme status and catalogue on every call, at most two seconds
 * each: the admin never calls the frontend (decision D1 of 2026-11-25).
 */
export async function readThemes(
  strapi: Core.Strapi,
  slug: string | null
): Promise<ThemesAnswer | null> {
  const sites = await readSites(strapi)
  const site = await readThemeSite(strapi, slug)
  if (!site) return null
  const frontend = await readFrontendThemes(site.origin)
  const pin = pinFrom(site.theme)
  return {
    sites: sites.map(({ slug: each, name, isDefault }) => ({ slug: each, name, isDefault })),
    site: { slug: site.slug, name: site.name, isDefault: site.isDefault, origin: site.origin },
    pin,
    ...frontend,
    revert: await revertOf(strapi, site, pin, frontend.status),
    pages: await readPages(strapi, site.id),
  }
}

/** The site `slug` with its pin, or the default site when `slug` is `null`; `null` when there is none. */
export async function readThemeSite(
  strapi: Core.Strapi,
  slug: string | null
): Promise<ThemeSite | null> {
  const rows = (await strapi.db.query(SITE_UID).findMany({
    where: slug === null ? { isDefault: true } : { slug },
    select: ['id', 'documentId', 'locale', 'name', 'slug', 'isDefault', 'url'],
    populate: { theme: { populate: { accentOverrides: true } } },
    orderBy: { id: 'asc' },
  })) as {
    id: number
    documentId: string
    locale: string | null
    name: string | null
    slug: string
    isDefault: boolean | null
    url: string | null
    theme: Record<string, unknown> | null
  }[]
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    documentId: row.documentId,
    locale: row.locale,
    slug: row.slug,
    name: row.name ?? row.slug,
    isDefault: row.isDefault === true,
    origin: originOf(row.url),
    theme: row.theme,
  }
}

/** Asks the frontend at `origin` for `GET /api/theme/status` and `GET /api/theme/catalogue`, in parallel. */
export async function readFrontendThemes(origin: string | null): Promise<FrontendThemes> {
  if (!origin) return { status: null, catalogue: null }
  const [status, catalogue] = await Promise.all([
    readJson(`${origin}/api/theme/status`),
    readJson(`${origin}/api/theme/catalogue`),
  ])
  return { status: parseThemeStatus(status), catalogue: parseThemeCatalogue(catalogue) }
}

/** The newest row of the site's log, or `null` when its pin was never changed from the page. */
export async function lastActivation(
  strapi: Core.Strapi,
  siteId: number
): Promise<{ action: string; pinBefore: ThemePin; pinAfter: ThemePin } | null> {
  const row = (await strapi.db.query(THEME_ACTIVATION_UID as UID.ContentType).findOne({
    where: { site: siteId },
    orderBy: { id: 'desc' },
  })) as { action: string; pinBefore: unknown; pinAfter: unknown } | null
  if (!row) return null
  return { action: row.action, pinBefore: pinFrom(row.pinBefore), pinAfter: pinFrom(row.pinAfter) }
}

/**
 * The pin a revert writes back: the one the last activation replaced, while the site still holds the
 * pin that activation wrote; `null` otherwise (no activation, the last change was a revert, or the pin
 * changed since in the Content Manager).
 */
export async function revertTarget(
  strapi: Core.Strapi,
  site: ThemeSite,
  pin: ThemePin
): Promise<ThemePin | null> {
  const last = await lastActivation(strapi, site.id)
  if (!last || last.action !== 'activate' || !isSamePin(last.pinAfter, pin)) return null
  return last.pinBefore
}

async function revertOf(
  strapi: Core.Strapi,
  site: ThemeSite,
  pin: ThemePin,
  status: FrontendThemeStatus | null
): Promise<ThemesAnswer['revert']> {
  const target = await revertTarget(strapi, site, pin)
  if (!target) return null
  return { pin: target, isInstalled: status !== null && isPinInstalled(target, status) }
}

/**
 * The newest draft of each page type of the site (the `pageType` of the types made with
 * `withPageSettings`, `standard` when it has none), one entry per page type, newest first.
 *
 * @remarks
 * Reads the site's drafts of those types with five columns each and keeps the first of each page
 * type: no limit, so a page type whose newest draft is older than many others is still answered.
 */
async function readPages(strapi: Core.Strapi, siteId: number): Promise<ThemePreviewPage[]> {
  const newest = new Map<string, ThemePreviewPage & { updatedAt: string }>()
  for (const [uid, schema] of Object.entries(strapi.contentTypes)) {
    if (!hasPageSettings(schema) || !isSiteScoped(schema)) continue
    const hasTitle = 'title' in schema.attributes
    const rows = (await strapi.db.query(uid as UID.ContentType).findMany({
      where: { site: siteId, publishedAt: null },
      select: ['documentId', 'locale', 'pageType', 'updatedAt', ...(hasTitle ? ['title'] : [])],
      orderBy: { updatedAt: 'desc' },
    })) as {
      documentId: string
      locale?: string | null
      pageType?: string | null
      updatedAt: string
      title?: string | null
    }[]
    for (const row of rows) {
      const pageType = row.pageType || DEFAULT_PAGE_TYPE
      const updatedAt = new Date(row.updatedAt).toISOString()
      const kept = newest.get(pageType)
      if (kept && kept.updatedAt >= updatedAt) continue
      newest.set(pageType, {
        uid,
        documentId: row.documentId,
        locale: row.locale ?? null,
        title: row.title || row.documentId,
        pageType,
        updatedAt,
      })
    }
  }
  return [...newest.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ updatedAt: _updatedAt, ...page }) => page)
}

async function readJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FRONTEND_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    // Refused, timed out, not resolvable or not JSON: the page says the frontend did not answer.
    return null
  }
}

function originOf(url: string | null): string | null {
  if (!url) return null
  try {
    // The origin drops any credentials, path and query.
    return new URL(url).origin
  } catch {
    // The site's own regex refuses such a value; a row that has one has no frontend to ask.
    return null
  }
}
