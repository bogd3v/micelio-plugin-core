import { describe, expect, it } from 'vitest'
import { CORE_NAV_ITEMS, visibleNavItems, type CoreNavItem } from '../admin/src/navigation'
import { STATUS_READ_PERMISSION, TRANSFER_PERMISSION } from '../admin/src/permissions'

const REPORTS = { action: 'plugin::micelio.reports.read', subject: null }
const items: CoreNavItem[] = [
  ...CORE_NAV_ITEMS,
  { id: 'reports', group: 'content', to: 'reports', permission: REPORTS },
]
const ids = (held: { action: string }[]): string[] =>
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
  })
})
