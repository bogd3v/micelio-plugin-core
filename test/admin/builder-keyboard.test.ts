import { describe, expect, it } from 'vitest'
import type { UID } from '@strapi/strapi'
import {
  LANDING_UID,
  eventually,
  focused,
  listed,
  tabTo,
  useBuilderSession,
} from './builder-session'

describe('the builder with the keyboard only', () => {
  const session = useBuilderSession()

  it('composes and publishes the landing without a pointer event', async () => {
    const documentId = await session.seed(LANDING_UID, [], 'Keyboard landing')
    const page = await session.open(LANDING_UID, documentId)
    // The page is open and the admin signed in. From here on a pointer event is a failure: the
    // listeners are in the capture phase and see every press, release, click and drag.
    await page.evaluate(`(() => {
      window.__pointer = []
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dragstart', 'wheel']) {
        window.addEventListener(type, (event) => window.__pointer.push(type), true)
      }
      // A click that a key makes (Enter or Space on a button) has no position and no count.
      window.addEventListener('click', (event) => { if (event.detail > 0) window.__pointer.push('click') }, true)
    })()`)
    const status = () => page.getByTestId('save-status').textContent()
    const badge = () => page.getByTestId('editorial-state').textContent()
    const panel = page.getByRole('complementary', { name: 'Selected block' })
    const input = `(el) => el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA'`

    /** Searches the palette and inserts the block that the search leaves, with the keys. */
    async function insert(search: string, block: string): Promise<void> {
      await page.keyboard.press('/')
      // The search keeps the last words: select them, and the new ones replace them.
      await page.keyboard.press('Control+a')
      await page.keyboard.type(search)
      await tabTo(page, `(el) => el?.dataset.block === '${block}'`)
      await page.keyboard.press('Enter')
      await panel.getByRole('heading', { level: 2 }).waitFor()
    }

    // A rich text block: the panel takes ⌘1, Tab reaches its field.
    await insert('rich', 'rich-text')
    await page.keyboard.press('Control+1')
    await tabTo(page, input)
    await page.keyboard.type('Open source, in plain words.')
    // Esc goes up to the page, and the next block is added at the end.
    await page.keyboard.press('Escape')
    await insert('feature', 'feature-grid')
    await page.keyboard.press('Control+1')
    await tabTo(page, input)
    await page.keyboard.type('Why it works')
    // An item of the grid: add it from the panel, then type in it.
    await tabTo(page, `(el) => el?.textContent?.includes('Add an item')`)
    await page.keyboard.press('Enter')
    await panel.getByText('Esc goes up one level').waitFor()
    await page.keyboard.press('Control+1')
    await tabTo(page, input)
    await page.keyboard.type('Mycelium')
    // Esc goes up to the block, then to the page.
    await page.keyboard.press('Escape')
    await panel.getByText('Esc goes up one level').waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')

    // Reorder, duplicate, remove, undo and redo, and save without waiting for the pause.
    await page.keyboard.press('2')
    await page.keyboard.press('Alt+ArrowUp')
    await eventually(() => listed(page)).toEqual([
      expect.stringContaining('Feature grid'),
      expect.stringContaining('Rich text'),
    ])
    await page.keyboard.press('Control+d')
    await eventually(() => listed(page)).toHaveLength(3)
    await page.keyboard.press('Control+Backspace')
    await eventually(() => listed(page)).toHaveLength(2)
    await page.keyboard.press('Control+z')
    await eventually(() => listed(page)).toHaveLength(3)
    await page.keyboard.press('Control+Shift+z')
    await eventually(() => listed(page)).toHaveLength(2)
    await page.keyboard.press('Control+s')
    await eventually(status).toBe('Saved')

    // Send to review with ⌘↵, in the dialog with Tab and Enter; then publish from the toolbar.
    await page.keyboard.press('Control+Enter')
    const dialog = page.getByRole('dialog', { name: 'Send to review' })
    await dialog.waitFor()
    await tabTo(
      page,
      `(el) => el?.tagName === 'BUTTON' && el.textContent === 'Send to review' && el.closest('[role="dialog"]')`
    )
    await page.keyboard.press('Enter')
    await eventually(badge).toBe('In review')
    await tabTo(page, `(el) => el?.tagName === 'BUTTON' && el.textContent?.trim() === 'Publish'`)
    expect(await focused(page)).toBe('Publish')
    await page.keyboard.press('Enter')
    await eventually(badge).toBe('Published')

    const published = (await session.strapi.documents(LANDING_UID as UID.ContentType).findOne({
      documentId,
      locale: 'en',
      status: 'published',
      populate: {
        sections: {
          on: { 'section.feature-grid': { populate: ['items'] }, 'section.rich-text': true },
        },
      },
    } as never)) as unknown as { sections: { __component: string; [key: string]: unknown }[] }
    expect(published.sections.map(({ __component }) => __component)).toEqual([
      'section.feature-grid',
      'section.rich-text',
    ])
    expect(published.sections[0]).toMatchObject({
      title: 'Why it works',
      items: [{ title: 'Mycelium' }],
    })
    expect(published.sections[1]).toMatchObject({ body: 'Open source, in plain words.' })
    expect(await page.evaluate('window.__pointer')).toEqual([])
  })
})
