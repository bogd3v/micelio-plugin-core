/** A redirect as the rules read it. */
export interface RedirectRow {
  documentId: string
  from: string
  to: string
}

/** What a change of the published slug does to the redirects of its page's locale. */
export interface RedirectPlan {
  /** Redirects that pointed to the old address: they point to the new one, never through a chain. */
  retarget: string[]
  /** Redirects from the new address, which the page now answers itself: they would loop. */
  remove: string[]
  /** The redirect from the old address, or `null` when one already exists and is retargeted. */
  create: { from: string; to: string } | null
}

/** The address of a page, as the redirect stores it: `/<slug>`. */
export const pathOfSlug = (slug: string): string => `/${slug}`

/**
 * What to do with the redirects of a page when its published slug changes from one address to
 * another: the old address redirects to the new one, what redirected to the old address follows,
 * and a redirect from the new address goes away.
 *
 * @param existing - The redirects of the page's site and locale.
 */
export function planRedirects(
  change: { from: string; to: string },
  existing: readonly RedirectRow[]
): RedirectPlan {
  const remove = existing.filter((row) => row.from === change.to).map((row) => row.documentId)
  const retarget = existing
    .filter((row) => row.to === change.from && row.from !== change.to)
    .map((row) => row.documentId)
  const own = existing.find((row) => row.from === change.from)
  if (own) retarget.push(own.documentId)
  return { remove, retarget, create: own ? null : { from: change.from, to: change.to } }
}

/**
 * Whether `value` is a path of the site itself: one `/` first, then no second `/`, no backslash,
 * no scheme and no control or space character.
 *
 * @remarks
 * A redirect is answered as a `301` by the frontend, so an address that leaves the site (`https://…`,
 * `//host`, `/\host`, `javascript:`) would be an open redirect.
 */
export function isSitePath(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/.test(value)
}
