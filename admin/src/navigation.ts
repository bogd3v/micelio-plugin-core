import type { AdminPageGroup } from '../../server/src/types/extensions'
import {
  BLOCKS_READ_PERMISSION,
  REVIEW_READ_PERMISSION,
  SITES_READ_PERMISSION,
  STATUS_READ_PERMISSION,
  TEMPLATES_MANAGE_PERMISSION,
  TRANSFER_PERMISSION,
} from './permissions'

/** A group of the sub-navigation: those sibling plugins register into, and the core's own About. */
export type NavGroup = AdminPageGroup | 'about'

/** An item the core provides, with a page of its own. */
export interface CoreNavItem {
  /** The key of the item and the suffix of its label, `nav.<id>`, in the translations. */
  id: string
  group: NavGroup
  /** The path under `/plugins/micelio/`; empty for the index. */
  to: string
  /**
   * The admin permission that shows the item and opens its page; none when every admin user may.
   * A `subject` narrows it to one content type.
   */
  permission?: { action: string; subject: string | null }
}

/** The groups in the order the sub-navigation lists them; a group with no visible item is left out. */
export const NAV_GROUPS: NavGroup[] = ['overview', 'content', 'site', 'about']

/**
 * The items of the core, in order. A new page of the core adds its item here, with its permission.
 *
 * @remarks
 * Status is the index of the section, so it keeps its URL, `/plugins/micelio`.
 */
export const CORE_NAV_ITEMS: CoreNavItem[] = [
  { id: 'status', group: 'overview', to: '', permission: STATUS_READ_PERMISSION },
  { id: 'blocks', group: 'content', to: 'blocks', permission: BLOCKS_READ_PERMISSION },
  { id: 'templates', group: 'content', to: 'templates', permission: TEMPLATES_MANAGE_PERMISSION },
  { id: 'review', group: 'content', to: 'review', permission: REVIEW_READ_PERMISSION },
  { id: 'sites', group: 'site', to: 'sites', permission: SITES_READ_PERMISSION },
  { id: 'transfer', group: 'site', to: '_export-import', permission: TRANSFER_PERMISSION },
  { id: 'about', group: 'about', to: 'about' },
]

/** The items a role sees: those with no permission, and those whose own permission it holds. */
export function visibleNavItems(
  items: CoreNavItem[],
  permissions: { action: string; subject?: string | null }[]
): CoreNavItem[] {
  return items.filter(
    (item) =>
      !item.permission ||
      permissions.some(
        ({ action, subject }) =>
          action === item.permission?.action &&
          (item.permission.subject === null || subject === item.permission.subject)
      )
  )
}

/**
 * The number of entries an answer of `GET /micelio/review` lists, summed over its sites.
 *
 * @param sites - The `data` of the answer: one item per site, each with its `entries`.
 */
export function countInReview(sites: { entries: readonly unknown[] }[]): number {
  return sites.reduce((sum, site) => sum + site.entries.length, 0)
}
