import { describe, expect, it } from 'vitest'
import {
  CORE_NAV_ITEMS,
  countInReview,
  visibleNavItems,
  type CoreNavItem,
} from '../admin/src/navigation'
import {
  BLOCKS_READ_PERMISSION,
  SITES_READ_PERMISSION,
  STATUS_READ_PERMISSION,
  TEMPLATES_MANAGE_PERMISSION,
  TRANSFER_PERMISSION,
} from '../admin/src/permissions'

const REPORTS = { action: 'plugin::micelio.reports.read', subject: null }
const items: CoreNavItem[] = [
  ...CORE_NAV_ITEMS,
  { id: 'reports', group: 'content', to: 'reports', permission: REPORTS },
]
const ids = (held: { action: string; subject?: string | null }[]): string[] =>
  visibleNavItems(items, held).map(({ id }) => id)

describe('the items of the core a role sees', () => {
  it('shows an item with no permission to every role', () => {
    expect(ids([])).toEqual(['about'])
  })

  it('filters each item on its own permission, not on the status permission', () => {
    expect(ids([STATUS_READ_PERMISSION])).toEqual(['status', 'about'])
    expect(ids([REPORTS])).toEqual(['about', 'reports'])
    expect(ids([STATUS_READ_PERMISSION, REPORTS])).toEqual(['status', 'about', 'reports'])
    expect(ids([TRANSFER_PERMISSION])).toEqual(['transfer', 'about'])
    expect(ids([BLOCKS_READ_PERMISSION])).toEqual(['blocks', 'about'])
    expect(ids([TEMPLATES_MANAGE_PERMISSION])).toEqual(['templates', 'about'])
  })

  it('shows Sites only to a role that may read the Site type, not any type', () => {
    expect(ids([SITES_READ_PERMISSION])).toEqual(['sites', 'about'])
    expect(
      ids([{ action: SITES_READ_PERMISSION.action, subject: 'api::brochure.brochure' }])
    ).toEqual(['about'])
    expect(ids([{ action: SITES_READ_PERMISSION.action, subject: null }])).toEqual(['about'])
  })
})

describe('the count of the pages in review', () => {
  it('counts the entries in review over every site', () => {
    const entry = { documentId: 'a' }
    expect(countInReview([])).toBe(0)
    expect(countInReview([{ entries: [] }])).toBe(0)
    expect(
      countInReview([{ entries: [entry, entry] }, { entries: [] }, { entries: [entry] }])
    ).toBe(3)
  })
})
