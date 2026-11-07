import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import { GROUPS, SHORTCUTS, keyCaps, type Chord } from '../../admin/src/shortcuts'
import {
  LANDING_UID,
  eventually,
  focused,
  listed,
  selectedRow,
  shown,
  useBuilderSession,
} from './builder-session'

const messages = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
  )

// Three blocks that differ in name, so the list says which is which.
const SECTIONS = [
  { __component: 'section.rich-text', body: 'One' },
  {
    __component: 'section.feature-grid',
    title: 'Grid',
    items: [{ title: 'First item' }, { title: 'Second item' }],
  },
  { __component: 'section.logo-cloud', title: 'Three' },
]

describe('the keyboard of the builder', () => {
  const session = useBuilderSession()

  async function openSeeded(options: Parameters<typeof session.open>[2] = {}): Promise<Page> {
    const page = await session.open(LANDING_UID, await session.seed(LANDING_UID, SECTIONS), options)
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid', 'logo-cloud'])
    return page
  }
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected block' })
  const search = (page: Page) => page.getByLabel('Search blocks')
  const rows = async (page: Page) => (await listed(page)).map((text) => text.replace(/\d$/, ''))
  const sheet = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const isFocused = (page: Page, locator: ReturnType<Page['locator']>) =>
    locator.evaluate((el) => el.ownerDocument.activeElement === el)

  it('the sheet lists exactly the actions of the table', async () => {
    const page = await openSeeded()
    await page.keyboard.press('Shift+Slash')
    await sheet(page).waitFor()
    await eventually(() => focused(page)).toBe('Close the shortcuts')
    const rowsOf = (group: string) =>
      sheet(page)
        .locator(`section[aria-labelledby="shortcuts-${group}"] [data-shortcut]`)
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-shortcut')))
    // Every action of the table, once, under the heading of its group.
    const listedIds = await sheet(page)
      .locator('[data-shortcut]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-shortcut')))
    expect([...listedIds].sort()).toEqual(SHORTCUTS.map(({ id }) => id).sort())
    for (const group of GROUPS) {
      expect(await rowsOf(group), group).toEqual(
        SHORTCUTS.filter((shortcut) => shortcut.group === group).map(({ id }) => id)
      )
    }
    expect(listedIds.length).toBeGreaterThan(20)
    // Each row carries the label of its action, under the heading of its group.
    const en = messages('en')
    const groups = await sheet(page).locator('section h2').allTextContents()
    expect([...groups].sort()).toEqual(GROUPS.map((group) => en[`shortcuts.group.${group}`]).sort())
    for (const shortcut of SHORTCUTS) {
      const row = sheet(page).locator(`[data-shortcut="${shortcut.id}"]`)
      expect(await row.locator('span').first().textContent()).toBe(en[`shortcuts.${shortcut.id}`])
      // Linux and Windows: Ctrl, Shift and Alt; a range shows its two ends.
      const chords: readonly Chord[] =
        'isRange' in shortcut ? [shortcut.keys[0], shortcut.keys.at(-1)!] : shortcut.keys
      expect(await row.locator('kbd').allTextContents()).toEqual(
        chords.map((chord) => keyCaps(chord, false).join('+'))
      )
    }
    await page.keyboard.press('Escape')
    await sheet(page).waitFor({ state: 'detached' })
  })

  it('writes the keys with ⌘ and the symbols on macOS, and the labels in Spanish', async () => {
    const page = await openSeeded({ platform: 'MacIntel' })
    await page.keyboard.press('Shift+Slash')
    await sheet(page).waitFor()
    expect(await sheet(page).locator('[data-shortcut="undo"] kbd').allTextContents()).toEqual([
      '⌘Z',
      '⌘⇧Z',
    ])
    expect(await sheet(page).locator('[data-shortcut="reset"] kbd').allTextContents()).toEqual([
      '⌥⌫',
    ])
    await page.keyboard.press('Escape')
    await page.evaluate("localStorage.setItem('strapi-admin-language', 'es')")
    await page.reload()
    await page.getByRole('region', { name: /Bloques/ }).waitFor()
    await page.keyboard.press('Shift+Slash')
    const es = messages('es')
    const dialog = page.getByRole('dialog', { name: es['shortcuts.title'] })
    await dialog.waitFor()
    for (const { id } of SHORTCUTS) {
      expect(await dialog.locator(`[data-shortcut="${id}"] span`).first().textContent(), id).toBe(
        es[`shortcuts.${id}`]
      )
    }
  })

  it('opens the sheet from the palette too, and gives focus back where it was', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).focus()
    await page.keyboard.press('Enter')
    await sheet(page).waitFor()
    // A dialog keeps its keys: `2` does not select the second block behind it.
    await eventually(() => focused(page)).toBe('Close the shortcuts')
    await page.keyboard.press('2')
    expect(await selectedRow(page)).toContain('Rich text')
    await eventually(() => focused(page)).toBe('Close the shortcuts')
    await page.keyboard.press('Escape')
    await sheet(page).waitFor({ state: 'detached' })
    await eventually(() => focused(page)).toBe('Keyboard shortcuts')
  })

  it('shows a focus indicator on the palette link to the sheet', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    const link = page.getByRole('button', { name: 'Keyboard shortcuts' })
    await link.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    expect(
      await link.evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).outlineStyle)
    ).toBe('solid')
  })

  it('does not fire inside a field except save, undo, redo and Esc', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    const body = panel(page).getByLabel('Body')
    await body.focus()
    await page.keyboard.press('Control+End')
    // Typed characters stay in the field: digits, the slash and the question mark among them.
    await page.keyboard.type('x1/?')
    expect(await body.inputValue()).toBe('Onex1/?')
    expect(await sheet(page).count()).toBe(0)
    expect(await isFocused(page, search(page))).toBe(false)
    for (const key of ['Alt+ArrowUp', 'Control+d', 'Alt+Backspace', 'Control+Shift+s']) {
      await page.keyboard.press(key)
    }
    expect(await rows(page)).toEqual(['Rich text', 'Feature grid', 'Logo cloud'])
    expect(await selectedRow(page)).toContain('Rich text')
    // Undo reaches the page from a field; typing was one step.
    await page.keyboard.press('Control+z')
    await eventually(() => body.inputValue()).toBe('One')
    await page.keyboard.press('Control+Shift+z')
    await eventually(() => body.inputValue()).toBe('Onex1/?')
    // Save runs from a field, without waiting for the pause of autosave.
    const put = page.waitForRequest((request) => request.method() === 'PUT', { timeout: 600 })
    await page.keyboard.press('Control+s')
    await put
    // Esc goes up from a field too.
    await page.keyboard.press('Escape')
    await panel(page).getByText('Select a block in the page or in the list to edit it.').waitFor()
  })

  it('ends a redo with a new change, typing included', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    const body = panel(page).getByLabel('Body')
    await body.focus()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('x')
    await page.keyboard.press('Control+z')
    await eventually(() => body.inputValue()).toBe('One')
    // Typing right after the undo is part of the same pause, not a step of its own.
    await page.keyboard.press('Control+End')
    await page.keyboard.type('q')
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(300)
    expect(await body.inputValue()).toBe('Oneq')
  })

  it('fires no single key inside the preview', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    const duplicate = page.locator(
      '[data-shortcut-region="preview"] button[aria-label="Duplicate"]'
    )
    await duplicate.waitFor()
    await duplicate.focus()
    for (const key of ['2', '/', 'ArrowDown', 'ArrowRight']) await page.keyboard.press(key)
    expect(await selectedRow(page)).toContain('Rich text')
    expect(await isFocused(page, search(page))).toBe(false)
    expect(await panel(page).getByRole('heading', { level: 2 }).textContent()).toBe('Rich text')
    // The same keys work from the list: it is the preview that keeps them.
    await page.locator('[data-block-key]').first().focus()
    await page.keyboard.press('2')
    expect(await selectedRow(page)).toContain('Feature grid')
    // A modified key still runs from the preview.
    await duplicate.focus()
    await page.keyboard.press('Control+d')
    await eventually(() => rows(page)).toHaveLength(4)
  })

  it('follows the visual order with Tab: palette, list, preview, panel', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    const regions = await page.evaluate(`(() => {
      const box = (el) => el.getBoundingClientRect()
      const at = (el) => ({ top: box(el).top, left: box(el).left })
      const palette = document.querySelector('input[type="search"]')
      const list = document.querySelector('[data-block-key]')
      const preview = document.querySelector('[data-shortcut-region="preview"] iframe')
      const panel = document.querySelector('[data-shortcut-region="panel"]')
      const order = [palette, list, preview, panel]
      const inDomOrder = order.every((el, i) => i === 0 || (order[i - 1].compareDocumentPosition(el) & 4) !== 0)
      return {
        inDomOrder,
        positive: document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex^="-"])').length,
        palette: at(palette), list: at(list), preview: at(preview), panel: at(panel),
      }
    })()`)
    const seen = regions as {
      inDomOrder: boolean
      positive: number
      palette: { top: number; left: number }
      list: { top: number; left: number }
      preview: { top: number; left: number }
      panel: { top: number; left: number }
    }
    // The order of the document is the order Tab follows, and no tabindex says otherwise...
    expect(seen.positive).toBe(0)
    expect(seen.inDomOrder).toBe(true)
    // ...and it is the order on the screen: the list under the palette, then the page, then the panel.
    expect(seen.list.top).toBeGreaterThan(seen.palette.top)
    expect(seen.preview.left).toBeGreaterThan(seen.list.left)
    expect(seen.panel.left).toBeGreaterThan(seen.preview.left)
    // Tab from the search reaches the list before the preview.
    await search(page).focus()
    const stops: string[] = []
    for (let press = 0; press < 40 && stops.length < 2; press++) {
      await page.keyboard.press('Tab')
      const where = (await page.evaluate(
        `document.activeElement?.closest('[data-block-key]') ? 'list' : document.activeElement?.tagName === 'IFRAME' ? 'preview' : ''`
      )) as string
      if (where && stops.at(-1) !== where) stops.push(where)
    }
    expect(stops).toEqual(['list', 'preview'])
  })

  it('selects with the arrows, the digits, Esc and the focus keys', async () => {
    const page = await openSeeded()
    const row = (page2: Page, position: number) => page2.locator('[data-block-key]').nth(position)
    // ↓ from nothing selects the first, ↑ from nothing the last; each follows the list.
    await page.keyboard.press('ArrowDown')
    expect(await selectedRow(page)).toContain('Rich text')
    await page.keyboard.press('ArrowDown')
    expect(await selectedRow(page)).toContain('Feature grid')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    expect(await selectedRow(page)).toContain('Rich text')
    // 1 to 9 jump to a block; a number with no block does nothing.
    await page.keyboard.press('3')
    expect(await selectedRow(page)).toContain('Logo cloud')
    await page.keyboard.press('9')
    expect(await selectedRow(page)).toContain('Logo cloud')
    // → goes into the items of the block, Esc up to the block, and again up to the page.
    await page.keyboard.press('2')
    await page.keyboard.press('ArrowRight')
    await panel(page).getByText('Esc goes up one level').waitFor()
    expect(await panel(page).getByLabel('Title').inputValue()).toBe('First item')
    await page.keyboard.press('Escape')
    await panel(page).getByText('Esc goes up one level').waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await panel(page).getByText('Select a block in the page or in the list to edit it.').waitFor()
    // ArrowDown on the list moves the focus with the selection.
    await row(page, 0).focus()
    await page.keyboard.press('ArrowDown')
    expect(await isFocused(page, row(page, 1))).toBe(true)
    // ⌘1 and ⌘2 focus the panel and the preview.
    await page.keyboard.press('Control+1')
    expect(await focused(page)).toBe('Selected block')
    await page.keyboard.press('Control+2')
    expect(await page.evaluate('document.activeElement?.tagName')).toBe('IFRAME')
  })

  it('opens the palette and the search from the keys, and inserts after the selection', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    await page.keyboard.press('/')
    expect(await isFocused(page, search(page))).toBe(true)
    await page.keyboard.type('logo')
    // Esc clears the search first; the block stays selected.
    await page.keyboard.press('Escape')
    expect(await search(page).inputValue()).toBe('')
    expect(await selectedRow(page)).toContain('Rich text')
    // Enter, from the list, opens the palette; a row of it then inserts after the selection.
    await page.locator('[data-block-key]').first().focus()
    await page.keyboard.press('Enter')
    expect(await isFocused(page, search(page))).toBe(true)
    await page.keyboard.type('logo')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await eventually(() => rows(page)).toEqual([
      'Rich text',
      'Logo cloud',
      'Feature grid',
      'Logo cloud',
    ])
  })

  it('moves, duplicates, removes, undoes and redoes a block with the keys', async () => {
    const page = await openSeeded()
    await page.keyboard.press('2')
    await page.keyboard.press('Alt+ArrowUp')
    await eventually(() => rows(page)).toEqual(['Feature grid', 'Rich text', 'Logo cloud'])
    await page.keyboard.press('Alt+ArrowDown')
    await eventually(() => rows(page)).toEqual(['Rich text', 'Feature grid', 'Logo cloud'])
    await page.keyboard.press('Control+d')
    await eventually(() => rows(page)).toEqual([
      'Rich text',
      'Feature grid',
      'Feature grid',
      'Logo cloud',
    ])
    await page.keyboard.press('Control+Backspace')
    await eventually(() => rows(page)).toEqual(['Rich text', 'Feature grid', 'Logo cloud'])
    await page.keyboard.press('Control+z')
    await eventually(() => rows(page)).toHaveLength(4)
    await page.keyboard.press('Control+Shift+z')
    await eventually(() => rows(page)).toHaveLength(3)
    // Nothing to redo any more: the key does nothing, and the browser keeps it.
    await page.keyboard.press('Control+Shift+z')
    expect(await rows(page)).toHaveLength(3)
  })

  it('ignores a key held down: one press is one action', async () => {
    const page = await openSeeded()
    await page.keyboard.press('1')
    await page.keyboard.down('Control')
    await page.keyboard.down('KeyD')
    await page.keyboard.down('KeyD')
    await page.keyboard.down('KeyD')
    await page.keyboard.up('KeyD')
    await page.keyboard.up('Control')
    await eventually(() => rows(page)).toHaveLength(4)
    await page.waitForTimeout(300)
    expect(await rows(page)).toHaveLength(4)
  })

  it('picks a block up with Space, chooses a gap with the arrows and drops it', async () => {
    const page = await openSeeded()
    const first = page.locator('[data-block-key]').first()
    await first.focus()
    await page.keyboard.press('Space')
    await page.getByText(/Rich text picked up: gap 1 of 4/).waitFor({ state: 'attached' })
    // The gaps beside the block are where it is: one step down is the gap before the third block.
    await page.keyboard.press('ArrowDown')
    await page.getByText(/Rich text picked up: gap 3 of 4/).waitFor({ state: 'attached' })
    await page.keyboard.press('Space')
    await eventually(() => rows(page)).toEqual(['Feature grid', 'Rich text', 'Logo cloud'])
    // Esc puts it down where it was.
    await first.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Space')
    expect(await rows(page)).toEqual(['Feature grid', 'Rich text', 'Logo cloud'])
    await page.getByText(/picked up/).waitFor({ state: 'attached' })
    // Dropped on a gap beside itself, a block stays where it is.
    await page.keyboard.press('Space')
    await page.getByText(/picked up/).waitFor({ state: 'detached' })
    expect(await rows(page)).toEqual(['Feature grid', 'Rich text', 'Logo cloud'])
    // A key from outside the list puts a picked up block down where it was.
    await first.focus()
    await page.keyboard.press('Space')
    await page.getByText(/picked up/).waitFor({ state: 'attached' })
    await search(page).focus()
    await page.keyboard.press('a')
    await page.getByText(/picked up/).waitFor({ state: 'detached' })
    expect(await rows(page)).toEqual(['Feature grid', 'Rich text', 'Logo cloud'])
  })

  it('cycles the values of an option on its control, and resets them with ⌥⌫', async () => {
    const page = await openSeeded()
    await page.keyboard.press('2')
    const choice = (name: string) => panel(page).getByRole('button', { name, exact: true })
    await choice('3').focus()
    await page.keyboard.press('ArrowRight')
    expect(await choice('4').getAttribute('aria-pressed')).toBe('true')
    expect(await isFocused(page, choice('4'))).toBe(true)
    // The block offers 2, 3 and 4: the last goes round to the first, and the first back to the last.
    await page.keyboard.press('ArrowRight')
    expect(await choice('2').getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('ArrowLeft')
    expect(await choice('4').getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('Alt+Backspace')
    expect(await choice('3').getAttribute('aria-pressed')).toBe('true')
    await page.getByRole('status').filter({ hasText: 'Options reset' }).waitFor()
    // Nothing to reset: no step, no toast again.
    await page.keyboard.press('Control+z')
    expect(await choice('4').getAttribute('aria-pressed')).toBe('true')
  })

  it('sets the width and the static mode, opens the page and goes back to the entry', async () => {
    const page = await openSeeded()
    const width = (name: RegExp) => page.getByRole('button', { name })
    await page.keyboard.press('Control+Shift+1')
    expect(await width(/Phone/).getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('Control+Shift+2')
    expect(await width(/Tablet/).getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('Control+Shift+3')
    expect(await width(/Desktop/).getAttribute('aria-pressed')).toBe('true')
    const isStatic = page.getByLabel('As static site')
    await page.keyboard.press('Control+Shift+s')
    expect(await isStatic.isChecked()).toBe(true)
    await page.keyboard.press('Control+Shift+s')
    expect(await isStatic.isChecked()).toBe(false)
    const opened = page.context().waitForEvent('page')
    await page.keyboard.press('Control+Shift+o')
    await (await opened).waitForLoadState()
    await page.keyboard.press('Control+Shift+ArrowLeft')
    await page.waitForURL(/\/content-manager\/collection-types\/api::landing\.landing\//)
  })
})
