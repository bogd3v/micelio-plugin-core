/** Where a page shows up, as the `visibility` component stores it. */
export interface Visibility {
  inMenu: boolean
  inSitemap: boolean
  noindex: boolean
}

/** What a page that has no `visibility` component yet shows as: in the menu and the sitemap, indexable. */
export const DEFAULT_VISIBILITY: Visibility = { inMenu: true, inSitemap: true, noindex: false }

/** The settings of a page the drawer edits and saves with the draft. */
export interface PageSettingsValues {
  slug: string
  pageType: string
  visibility: Visibility
}

/** A page type of the site with the budget its published pages are held to, in kB. */
export interface PageTypeOption {
  id: string
  budgetKb: number
}

/** The slugs the content type accepts (`regex` of the uid attribute): no path, no query, not `.` or `..`. */
const SLUG = /^(?!\.{1,2}$)[A-Za-z0-9\-_.~]*$/

/** Whether `slug` is one a page may have: not empty, and made of what the uid attribute accepts. */
export function isSlugValid(slug: string): boolean {
  return slug !== '' && SLUG.test(slug)
}

/** The `visibility` component as the Content Manager answers it, read with the defaults for what is missing. */
export function visibilityOf(raw: unknown): Visibility {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_VISIBILITY
  const own = raw as Partial<Record<keyof Visibility, unknown>>
  const flag = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback
  return {
    inMenu: flag(own.inMenu, DEFAULT_VISIBILITY.inMenu),
    inSitemap: flag(own.inSitemap, DEFAULT_VISIBILITY.inSitemap),
    noindex: flag(own.noindex, DEFAULT_VISIBILITY.noindex),
  }
}

/** A page type id as a person reads it: `long-read` is `Long read`. */
export function pageTypeName(id: string): string {
  const words = id.replaceAll(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The page types the drawer offers, from the lightest budget to the heaviest: the site's, and the
 * page's own when the site no longer lists it, so the choice it holds is never hidden.
 *
 * @param current - The page's `pageType`; the core's `standard` budget applies to one nobody lists.
 */
export function offeredPageTypes(
  listed: readonly PageTypeOption[],
  current: string
): PageTypeOption[] {
  const byBudget = (a: PageTypeOption, b: PageTypeOption) =>
    a.budgetKb - b.budgetKb || a.id.localeCompare(b.id)
  if (listed.length === 0 || listed.some(({ id }) => id === current)) {
    return [...listed].sort(byBudget)
  }
  const standard = listed.find(({ id }) => id === 'standard')
  return [...listed, { id: current, budgetKb: standard?.budgetKb ?? 0 }].sort(byBudget)
}
