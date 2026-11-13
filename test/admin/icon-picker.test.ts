import { describe, expect, it } from 'vitest'
import type { Locator, Page } from 'playwright'
import type { UID } from '@strapi/strapi'
import { EMBLEM_UID, eventually, focused, useBuilderSession } from './builder-session'

const CARD = { __component: 'fixture.icon-card', title: 'Card' }

describe('the icon picker of the builder panel', () => {
  const session = useBuilderSession()

  /** A page with one icon card, opened in the builder with the card selected. */
  async function openCard(
    icon: string | null,
    options: { language?: 'es' } = {}
  ): Promise<{ page: Page; documentId: string }> {
    const documentId = await session.seed(EMBLEM_UID, [{ ...CARD, icon }], 'Emblem')
    const page = await session.open(EMBLEM_UID, documentId, options)
    await page.locator('[data-block-key]').first().click()
    await page.locator('[data-shortcut-region="panel"]').waitFor()
    return { page, documentId }
  }

  /** The icon of the first block of a page, as it is stored. */
  async function stored(documentId: string): Promise<string | null | undefined> {
    const page = (await session.strapi.documents(EMBLEM_UID as UID.ContentType).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: { sections: true },
    } as never)) as unknown as { sections: { icon?: string | null }[] }
    return page.sections[0]?.icon
  }

  /** The text of an element, read until the page has drawn it. */
  const textOf = (element: Locator) => eventually(() => element.textContent())

  const save = async (page: Page) => {
    await page.keyboard.press('Control+s')
    await eventually(() => page.getByTestId('save-status').textContent()).toMatch(/Saved|Guardado/)
  }

  it('finds an icon by its Spanish label and by an alias, and selects it', async () => {
    const { page, documentId } = await openCard(null)
    await page.getByRole('button', { name: /Choose an icon/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose an icon' })
    await dialog.waitFor()
    // The search is focused when the dialog opens.
    await eventually(() => focused(page)).toBe('Search icons')
    const search = dialog.getByRole('searchbox', { name: 'Search icons' })

    // A Spanish label, though the admin is in English.
    await search.fill('rayo')
    await dialog.getByRole('option', { name: 'Bolt', exact: true }).waitFor()
    await eventually(() => dialog.getByRole('option').count()).toBeLessThan(20)

    // An alias of the catalogue (Tabler's tag for the same glyph), no part of its name or label.
    await search.fill('thunder')
    const bolt = dialog.getByRole('option', { name: 'Bolt', exact: true })
    await bolt.waitFor()
    await bolt.click()

    await dialog.waitFor({ state: 'detached' })
    const field = page.getByRole('button', { name: /Bolt/ })
    await textOf(field).toContain('bolt')
    await eventually(() => page.getByRole('button', { name: 'Remove the icon' }).isVisible()).toBe(
      true
    )
    await save(page)
    expect(await stored(documentId)).toBe('bolt')
  })

  it('in Spanish, a name with no Spanish label shows and matches its English label', async () => {
    const { page, documentId } = await openCard(null, { language: 'es' })
    await page.getByRole('button', { name: /Elegir un ícono/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Elegir un ícono' })
    await dialog.waitFor()
    const search = dialog.getByRole('searchbox', { name: 'Buscar íconos' })

    // The core's names have a Spanish label; the others read in English.
    await search.fill('rayo')
    await dialog.getByRole('option', { name: 'Rayo', exact: true }).waitFor()
    await search.fill('abacus')
    const abacus = dialog.getByRole('option', { name: 'Abacus', exact: true })
    await abacus.waitFor()
    await dialog.getByText(/^\d+ de [\d.,]+$/).waitFor()
    await abacus.click()

    await dialog.waitFor({ state: 'detached' })
    await textOf(page.getByRole('button', { name: /Abacus/ })).toContain('abacus')
    await save(page)
    expect(await stored(documentId)).toBe('abacus')
  })

  it('none is an explicit state that clears the field', async () => {
    const { page, documentId } = await openCard('bolt')
    await textOf(page.getByRole('button', { name: /Bolt/ })).toContain('bolt')
    await page.getByRole('button', { name: 'Remove the icon' }).click()
    // The empty field is a state of its own, not a missing field.
    await eventually(() => page.getByRole('button', { name: /Choose an icon/ }).isVisible()).toBe(
      true
    )
    await eventually(() => page.getByRole('button', { name: 'Remove the icon' }).count()).toBe(0)
    await save(page)
    expect(await stored(documentId)).toBeNull()
  })

  it('keeps a stored alias as written and shows the glyph it resolves to', async () => {
    const service = session.strapi.plugin('micelio').service('icons') as {
      setAliasForTests(alias: string, name: string | undefined): void
    }
    service.setAliasForTests('old-bolt', 'bolt')
    try {
      const { page, documentId } = await openCard('old-bolt')
      const field = page.getByRole('button', { name: /Bolt/ })
      await textOf(field).toContain('old-bolt')
      await eventually(() => field.locator('svg').count()).toBe(1)
      // An edit of another field saves the card, and the alias is written back as it was.
      await page.getByLabel('Title').fill('Changed')
      await save(page)
      expect(await stored(documentId)).toBe('old-bolt')
    } finally {
      service.setAliasForTests('old-bolt', undefined)
    }
  })

  it('is operated with the keyboard: Enter opens, arrows move, Enter picks, Esc keeps the old one', async () => {
    const { page, documentId } = await openCard('bolt')
    const field = page.getByRole('button', { name: /Bolt/ })
    await field.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Choose an icon' })
    await eventually(() => focused(page)).toBe('Search icons')

    // Esc closes and keeps the old icon, with the focus back on the field.
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await eventually(() => focused(page)).toMatch(/Bolt/)
    await textOf(field).toContain('bolt')

    await page.keyboard.press('Enter')
    await dialog.waitFor()
    await page.keyboard.type('bolt')
    await dialog.getByRole('option', { name: 'Bolt', exact: true }).waitFor()
    // ↓ enters the grid at the first match (the exact name), → moves to the next.
    await page.keyboard.press('ArrowDown')
    await eventually(() => focused(page)).toBe('Bolt')
    await page.keyboard.press('ArrowRight')
    const next = (await focused(page)) as string
    expect(next).not.toBe('Bolt')
    await page.keyboard.press('ArrowLeft')
    await eventually(() => focused(page)).toBe('Bolt')
    // ↑ from the first row goes back to the search.
    await page.keyboard.press('ArrowUp')
    await eventually(() => focused(page)).toBe('Search icons')

    // Enter on the glyph that has the focus picks it.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await textOf(page.getByRole('button', { name: new RegExp(next) }).first()).toContain(next)
    const name = await page.getByRole('button', { name: 'Remove the icon' }).count()
    expect(name).toBe(1)
    await save(page)
    const picked = await stored(documentId)
    expect(picked).not.toBe('bolt')
    expect(picked?.startsWith('bolt')).toBe(true)
  })

  it('is the input of the Content Manager for a field micelio.icon', async () => {
    const documentId = await session.seed(EMBLEM_UID, [], 'Emblem', { icon: 'bolt' })
    const page = await session.open(EMBLEM_UID, documentId)
    await page.goto(
      `${session.base}/admin/content-manager/collection-types/${EMBLEM_UID}/${documentId}?plugins[i18n][locale]=en`
    )
    const field = page.getByRole('button', { name: /Bolt/ })
    await field.waitFor()
    // The form's label is the field's, and the hint is the picker's.
    await textOf(field).toContain('bolt')
    await page.getByText('A name of the catalogue, never a file.').first().waitFor()
    await page.getByRole('button', { name: 'Remove the icon' }).click()
    await page.getByRole('button', { name: /Choose an icon/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose an icon' })
    await dialog.getByRole('searchbox').fill('star')
    await dialog.getByRole('option', { name: 'Star', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await eventually(async () => {
      const saved = (await session.strapi.documents(EMBLEM_UID as UID.ContentType).findOne({
        documentId,
        locale: 'en',
        status: 'draft',
      })) as unknown as { icon: string | null }
      return saved.icon
    }).toBe('star')
  })
})
