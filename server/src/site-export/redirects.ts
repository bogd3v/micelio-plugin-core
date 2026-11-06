// The redirects of a site in an archive (`docs/export-format.md`, "Redirects"): written from
// `plugin::micelio.redirect`, which is not a content type of the archive, and read back by the
// importer with the same-site path rule of the redirect itself.
import type { Core, UID } from '@strapi/strapi'
import { REDIRECT_UID, SLUG_CHANGE_RULE } from '../constants/page-settings'
import { SITE_ATTRIBUTE } from '../site-scope'
import { isSitePath } from '../page-settings/redirects'
import { compare } from './model'
import type { RedirectEntry } from './types'

/** The longest `from` and `to` the redirect type stores, and the longest `entryLocale`. */
const MAX_PATH = 512
const MAX_LOCALE = 32

/** What an import did with the redirects of the archive. */
export interface RedirectsReport {
  created: number
  /** Redirects the site already held from the same address and locale: left as they are. */
  existing: RedirectEntry[]
  /** Redirects that are not a path of the site itself, or do not fit the type: not imported. */
  invalid: RedirectEntry[]
}

interface RedirectRow {
  from: string
  to: string
  entryLocale: string | null
}

/**
 * The redirects of a site, as an archive writes them: no `id`, no `documentId`, no audit relation.
 *
 * @param site - The `documentId` of the site.
 */
export async function redirectsOf(strapi: Core.Strapi, site: string): Promise<RedirectEntry[]> {
  const rows = (await strapi.db.query(REDIRECT_UID as UID.ContentType).findMany({
    select: ['from', 'to', 'entryLocale'],
    where: { [SITE_ATTRIBUTE]: { documentId: site } },
  })) as RedirectRow[]
  return rows
    .map((row) => ({ from: row.from, to: row.to, entryLocale: row.entryLocale ?? null }))
    .sort((a, b) => compare(a.from, b.from) || compare(a.entryLocale ?? '', b.entryLocale ?? ''))
}

/** Whether the type can store the redirect and the address stays on the site. */
export function isImportable(entry: RedirectEntry): boolean {
  return (
    isSitePath(entry.from) &&
    isSitePath(entry.to) &&
    entry.from.length <= MAX_PATH &&
    entry.to.length <= MAX_PATH &&
    (entry.entryLocale === null || entry.entryLocale.length <= MAX_LOCALE)
  )
}

/**
 * Creates the redirects of an archive on a site of the target.
 *
 * @remarks
 * One that is not a path of the site (`isSitePath`) is reported and skipped, and so is one whose
 * `from` the site already redirects for the same locale: it is not overwritten. Nothing else of
 * the target is touched, `replace` mode included. It runs in the transaction of the import.
 *
 * @param site - The `documentId` of the target's site.
 */
export async function importRedirects(
  strapi: Core.Strapi,
  site: string,
  entries: readonly RedirectEntry[]
): Promise<RedirectsReport> {
  const report: RedirectsReport = { created: 0, existing: [], invalid: [] }
  if (entries.length === 0) return report
  const redirects = strapi.documents(REDIRECT_UID as UID.ContentType)
  const held = new Set((await redirectsOf(strapi, site)).map(keyOf))
  for (const entry of entries) {
    if (!isImportable(entry)) {
      report.invalid.push(entry)
    } else if (held.has(keyOf(entry))) {
      report.existing.push(entry)
    } else {
      await redirects.create({
        data: { ...entry, rule: SLUG_CHANGE_RULE, [SITE_ATTRIBUTE]: site } as never,
      })
      held.add(keyOf(entry))
      report.created += 1
    }
  }
  return report
}

const keyOf = (entry: RedirectEntry): string => `${entry.entryLocale ?? ''}\u0000${entry.from}`
