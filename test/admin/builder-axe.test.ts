import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import {
  BROCHURE_UID,
  EMBLEM_UID,
  LANDING_UID,
  eventually,
  shown,
  tabTo,
  useBuilderSession,
  violationsOf,
} from './builder-session'

// The islands' fixture type: its zone holds the Playground, which the frame runs.
const SHOWCASE_UID = 'api::showcase.showcase'

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

  it('axe finds 0 violations with a run in progress and with its error shown', async () => {
    const found: Record<string, unknown[]> = {}
    const playground = { __component: 'shared.playground', runtime: 'python', code: 'print(1)' }
    try {
      for (const theme of ['light', 'dark'] as const) {
        const check = async (state: string, page: Page) => {
          const violations = await violationsOf(page)
          if (violations.length > 0) found[`${theme}: ${state}`] = violations
        }
        // A frame that never answers keeps the run in progress.
        session.site.run = { kind: 'silent' }
        const page = await session.open(
          SHOWCASE_UID,
          await session.seed(SHOWCASE_UID, [playground], 'Run'),
          theme === 'dark' ? { theme } : {}
        )
        await page
          .getByRole('region', { name: /Page blocks/ })
          .locator('[data-block-key]', { hasText: 'Playground' })
          .click()
        const run = page.getByRole('button', { name: 'Run here and fill expected output' })
        await eventually(() => run.isEnabled()).toBe(true)
        await run.click()
        await eventually(() => page.getByTestId('run-status').textContent()).toBe(
          'Running in the preview…'
        )
        await check('run in progress', page)

        // The frame loads again with an error to answer: the open run fails, and the next one
        // shows the error a reader would see.
        session.site.run = { kind: 'error', reason: 'codeError', output: 'NameError: flow' }
        // A string: the suites' tsconfig has no DOM types.
        await page
          .frames()
          .filter((frame) => frame.url().startsWith(session.site.origin))
          .at(-1)!
          .evaluate('location.reload()')
        await page.getByTestId('run-error').waitFor()
        await check('run failed as the frame loaded again', page)
        await eventually(() => run.isEnabled()).toBe(true)
        await run.click()
        await page.getByTestId('run-error-output').waitFor()
        await check('run error with its output', page)
      }
    } finally {
      session.site.run = { kind: 'answer' }
    }
    expect(found).toEqual({})
  })

  it('axe finds 0 violations with the icon picker closed, empty and open', async () => {
    const found: Record<string, unknown[]> = {}
    for (const theme of ['light', 'dark'] as const) {
      const check = async (state: string, page: Page) => {
        const violations = await violationsOf(page)
        if (violations.length > 0) found[`${theme}: ${state}`] = violations
      }
      const documentId = await session.seed(
        EMBLEM_UID,
        [{ __component: 'fixture.icon-card', title: 'Card', icon: 'bolt' }],
        'Icons'
      )
      const page = await session.open(EMBLEM_UID, documentId, theme === 'dark' ? { theme } : {})
      await page.locator('[data-block-key]').first().click()
      await page.getByRole('button', { name: /Bolt/ }).waitFor()
      await check('icon picked', page)
      await page.getByRole('button', { name: 'Remove the icon' }).click()
      await page.getByRole('button', { name: /Choose an icon/ }).waitFor()
      await check('icon none', page)
      await page.getByRole('button', { name: /Choose an icon/ }).click()
      const dialog = page.getByRole('dialog', { name: 'Choose an icon' })
      await dialog.getByRole('option', { name: 'Abacus', exact: true }).waitFor()
      await check('picker open', page)
      await dialog.getByRole('button', { name: 'More', exact: true }).click()
      await dialog.getByRole('searchbox').fill('rayo')
      await dialog.getByRole('option', { name: 'Bolt', exact: true }).waitFor()
      await page.keyboard.press('ArrowDown')
      await check('picker with a search, a glyph focused and every category shown', page)
      await dialog.getByRole('option', { name: 'Bolt', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      await check('icon picked again', page)
    }
    expect(found).toEqual({})
  })
})
