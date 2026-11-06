import type { Core, UID } from '@strapi/strapi'
import { EDITORIAL_ATTRIBUTE } from '../constants/editorial'
import { SITE_ATTRIBUTE } from '../site-scope'
import type { InReviewSite } from '../types/editorial'
import { isEditorial } from '.'

interface Row {
  documentId: string
  locale?: string | null
  updatedAt?: string | Date | null
  title?: unknown
  name?: unknown
  slug?: unknown
  editorial?: { note?: string | null } | null
  site?: { documentId: string; name?: string | null; slug?: string | null } | null
  createdBy?: { id: number } | null
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/**
 * The entries awaiting review, by site: the drafts of every editorial type the caller may read whose
 * state is `in_review`, the oldest first within a site, and the sites by name.
 *
 * @remarks
 * What the In review page lists (`GET /micelio/review`, `docs/guide/review.md`). It decides nothing:
 * approving or sending back is a transition, which checks the policy of the entry's site.
 *
 * @param mayRead - Whether the caller may read entries of a type in the Content Manager: called with
 * the type alone first, then with each entry (its `locale` and `createdBy` filled in), so that the
 * conditions of a permission, such as an author's own entries or some locales, hold too.
 */
export async function listInReview(
  strapi: Core.Strapi,
  mayRead: (uid: string, entry?: object) => boolean
): Promise<InReviewSite[]> {
  const sites = new Map<string, InReviewSite>()
  for (const uid of Object.keys(strapi.contentTypes) as UID.ContentType[]) {
    const schema = strapi.contentType(uid)
    if (!isEditorial(schema) || !mayRead(uid)) continue
    const rows = (await strapi.db.query(uid).findMany({
      where: { publishedAt: null, [EDITORIAL_ATTRIBUTE]: { state: 'in_review' } },
      populate: {
        [EDITORIAL_ATTRIBUTE]: true,
        [SITE_ATTRIBUTE]: { select: ['documentId', 'name', 'slug'] },
        createdBy: { select: ['id'] },
      },
    })) as Row[]
    for (const row of rows) {
      if (!mayRead(uid, row)) continue
      const key = row.site?.documentId ?? ''
      const site = sites.get(key) ?? {
        documentId: row.site?.documentId ?? null,
        name: text(row.site?.name) ?? text(row.site?.slug) ?? '',
        slug: text(row.site?.slug) ?? '',
        entries: [],
      }
      site.entries.push({
        uid,
        kind: schema.info.displayName,
        documentId: row.documentId,
        locale: row.locale ?? null,
        title: text(row.title) ?? text(row.name) ?? text(row.slug) ?? row.documentId,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        note: text(row.editorial?.note) ?? null,
      })
      sites.set(key, site)
    }
  }
  const time = (at: string | null) => (at ? Date.parse(at) : 0)
  return [...sites.values()]
    .map((site) => ({
      ...site,
      entries: site.entries.sort((a, b) => time(a.updatedAt) - time(b.updatedAt)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
