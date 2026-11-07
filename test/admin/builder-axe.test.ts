import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import {
  BROCHURE_UID,
  LANDING_UID,
  eventually,
  shown,
  tabTo,
  useBuilderSession,
  violationsOf,
} from './builder-session'

const SECTIONS = [
  { __component: 'section.rich-text', body: 'One' },
  {
    __component: 'section.feature-grid',
    title: 'Grid',
    items: [{ title: 'First item' }, { title: 'Second item' }],
  },
  { __component: 'section.logo-cloud', title: 'Three' },
]

describe('the builder is accessible', () => {
  const session = useBuilderSession()

  it('axe finds 0 violations in every builder state', async () => {
    const found: Record<string, unknown[]> = {}
    // Strapi's light and dark themes, each through the same states.
    for (const theme of ['light', 'dark'] as const) {
      const options = theme === 'dark' ? { theme } : {}
      const check = async (state: string, page: Page) => {
        const violations = await violationsOf(page)
        if (violations.length > 0) found[`${theme}: ${state}`] = violations
      }

      // An empty page, with the palette and its search that finds nothing.
      const empty = await session.open(
        LANDING_UID,
        await session.seed(LANDING_UID, [], 'Empty'),
        options
      )
      await check('empty page', empty)
      await empty.keyboard.press('/')
      await empty.keyboard.type('zzz')
      await empty.getByText(/No block matches/i).waitFor()
      await check('search with no match', empty)

      // A page of blocks, in each state the keyboard reaches.
      const page = await session.open(
        LANDING_UID,
        await session.seed(LANDING_UID, SECTIONS, 'Blocks'),
        options
      )
      await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid', 'logo-cloud'])
      await check('blocks, nothing selected', page)
      await page.keyboard.press('2')
      await page.getByRole('heading', { level: 2, name: 'Feature grid' }).waitFor()
      await check('block selected', page)
      await page.keyboard.press('ArrowRight')
      await page.getByText('Esc goes up one level').waitFor()
      await check('item selected', page)
      await page.keyboard.press('Escape')
      await page.locator('[data-block-key]').nth(1).focus()
      await page.keyboard.press('Space')
      await page.getByText(/picked up/).waitFor({ state: 'attached' })
      await check('block picked up', page)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Shift+Slash')
      await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
      await check('shortcut sheet', page)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.keyboard.press('Control+Enter')
      await page.getByRole('dialog', { name: 'Send to review' }).waitFor()
      await check('send to review dialog', page)

      // A page type with settings: the drawer opens with ⌘, and Tab reaches its first field.
      const brochure = await session.open(
        BROCHURE_UID,
        await session.seed(
          BROCHURE_UID,
          [{ __component: 'section.rich-text', body: 'Hi' }],
          'Settings'
        ),
        options
      )
      await brochure.getByRole('button', { name: 'Page settings' }).waitFor()
      await brochure.keyboard.press('Control+Comma')
      await brochure.getByRole('dialog').waitFor()
      await tabTo(brochure, `(el) => el?.tagName === 'INPUT'`)
      await check('page settings drawer', brochure)
    }
    expect(found).toEqual({})
  })
})
