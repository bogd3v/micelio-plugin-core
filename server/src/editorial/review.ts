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

// The fields that name an entry, in the order the list tries them.
const TITLE_FIELDS = ['title', 'name', 'slug'] as const

// The note's path in a read permission: the Content Manager grants a component's fields one by one
// (`editorial.state`, `editorial.note`), and a field is matched by its exact path.
const NOTE_FIELD = `${EDITORIAL_ATTRIBUTE}.note`

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
 * conditions of a permission, such as an author's own entries or some locales, hold too, and then
 * with the entry and a field, for each field it lists: the title is the first of `title`, `name` and
 * `slug` the caller may read (none: the document id), and the note is `null` when the caller may not
 * read the `editorial.note` field.
 */
export async function listInReview(
  strapi: Core.Strapi,
  mayRead: (uid: string, entry?: object, field?: string) => boolean
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
      // An entry the caller may read is listed; a field it may not read is left out of it.
      const title = TITLE_FIELDS.filter((field) => mayRead(uid, row, field))
        .map((field) => text(row[field]))
        .find((value) => value !== undefined)
      const note = mayRead(uid, row, NOTE_FIELD) ? text(row.editorial?.note) : undefined
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
        title: title ?? row.documentId,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        note: note ?? null,
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
