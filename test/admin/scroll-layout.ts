// What the browser suites of the editors' layout (issue #296) measure: what scrolls, and what is in
// view. The admin scrolls its main area, not the document, so both are read.

import { expect } from 'vitest'
import type { Locator, Page } from 'playwright'

/** The viewport sizes the editors are measured at. */
export const WIDE = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]
/** A viewport in which an editor's columns wrap. */
export const NARROW = { width: 800, height: 600 }

/** The element the Strapi admin scrolls a page in. */
export const mainArea = (page: Page) => page.locator('[data-strapi-main-content]')

/** How far `target` itself has scrolled. */
export const scrollTopOf = (target: Locator) => target.evaluate((node) => node.scrollTop)

/** Whether `target` holds more than it shows. */
export const overflows = (target: Locator) =>
  target.evaluate((node) => node.scrollHeight > node.clientHeight + 1)

/** Fails when the document or the admin's main area has anything to scroll, or has scrolled. */
export async function expectNoPageScroll(page: Page): Promise<void> {
  const document = (await page.evaluate(
    `({ height: window.document.documentElement.scrollHeight, window: window.innerHeight, y: window.scrollY })`
  )) as { height: number; window: number; y: number }
  expect(document.height).toBeLessThanOrEqual(document.window)
  expect(document.y).toBe(0)
  const main = await mainArea(page).evaluate((node) => ({
    scrolled: node.scrollTop,
    over: node.scrollHeight - node.clientHeight,
  }))
  expect(main).toEqual({ scrolled: 0, over: 0 })
}

/** Whether all of `target` is inside the window. */
export async function inWindow(page: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox()
  const { width, height } = page.viewportSize()!
  return (
    box !== null &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= width + 1 &&
    box.y + box.height <= height + 1
  )
}

/** Turns the wheel with the pointer near the left edge of `target`, clear of any frame in it. */
export async function wheelOver(page: Page, target: Locator, by = 600): Promise<void> {
  const box = (await target.boundingBox())!
  const { height } = page.viewportSize()!
  await page.mouse.move(box.x + 8, Math.min(box.y + box.height / 2, height - 8))
  await page.mouse.wheel(0, by)
}

/** The controls of `column` Tab stops at, in the order of the document. */
export const controlsOf = (column: Locator) =>
  column.locator(
    ['button', 'input', 'select', 'textarea', 'a[href]']
      .map((tag) => `${tag}:not([disabled]):not([tabindex="-1"]):not([type="hidden"])`)
      .join(', ')
  )

/** Whether the element with the focus is inside both `column` and the window. */
export async function focusInView(page: Page, column: Locator): Promise<boolean> {
  return column.evaluate((node) => {
    const focused = node.ownerDocument.activeElement
    if (!focused || !node.contains(focused)) return false
    const inner = focused.getBoundingClientRect()
    const outer = node.getBoundingClientRect()
    const view = node.ownerDocument.defaultView!
    return (
      inner.top >= Math.max(outer.top, 0) - 1 &&
      inner.bottom <= Math.min(outer.bottom, view.innerHeight) + 1
    )
  })
}

/**
 * Tabs from the first control of `column` to its last: each takes the focus in turn and is in view
 * while it has it. Gives how many there are.
 */
export async function tabThrough(page: Page, column: Locator): Promise<number> {
  const controls = controlsOf(column)
  const count = await controls.count()
  await controls.first().focus()
  for (let index = 0; index < count; index += 1) {
    if (index > 0) await page.keyboard.press('Tab')
    const control = controls.nth(index)
    expect
      .soft(await control.evaluate((node) => node === node.ownerDocument.activeElement), `${index}`)
      .toBe(true)
    await expect.poll(() => focusInView(page, column), { message: `control ${index}` }).toBe(true)
  }
  return count
}

/** Fails when a control of `column`, scrolled to, is covered or cut by what holds it. */
export async function expectNothingClipped(column: Locator): Promise<void> {
  const controls = controlsOf(column)
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index)
    await control.scrollIntoViewIfNeeded()
    const reached = await control.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const x = box.left + box.width / 2
      // The first and the last pixel row of the control: a box that cut it would show another there.
      return [box.top + 2, box.bottom - 2].every((y) => {
        const hit = node.ownerDocument.elementFromPoint(x, y)
        return hit !== null && (node.contains(hit) || hit.contains(node))
      })
    })
    expect(reached, `control ${index}`).toBe(true)
  }
}
