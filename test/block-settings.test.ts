import { describe, expect, it } from 'vitest'
import { BLOCKS } from '../contract/blocks'
import {
  allowedPageTypesOf,
  blockIdsIn,
  findBlockNotAllowed,
  findSettingViolation,
  knownPageTypes,
  mergedOptions,
  settingOf,
} from '../server/src/block-settings/rules'

const block = (id: string) => BLOCKS.find((candidate) => candidate.id === id)!
const PAGE_TYPES = ['landing', 'standard', 'long-read']

describe('findSettingViolation', () => {
  it('accepts a default the block offers, as a string or a number', () => {
    expect(
      findSettingViolation({ defaultOptions: { columns: 2 } }, block('feature-grid'), PAGE_TYPES)
    ).toBeNull()
    expect(
      findSettingViolation({ defaultOptions: { columns: '4' } }, block('feature-grid'), PAGE_TYPES)
    ).toBeNull()
    expect(
      findSettingViolation({ defaultOptions: { columns: 6 } }, block('logo-cloud'), PAGE_TYPES)
    ).toBeNull()
  })

  it('refuses a value outside the block, with the values it offers', () => {
    expect(
      findSettingViolation({ defaultOptions: { columns: 6 } }, block('feature-grid'), PAGE_TYPES)
    ).toEqual({
      kind: 'option',
      violation: { block: 'feature-grid', option: 'columns', value: 6, allowed: ['2', '3', '4'] },
    })
  })

  it('refuses an option the block does not expose, and a value that is not a string or a number', () => {
    expect(
      findSettingViolation({ defaultOptions: { columns: 2 } }, block('faq'), PAGE_TYPES)
    ).toMatchObject({
      kind: 'option',
      violation: { allowed: [] },
    })
    expect(
      findSettingViolation(
        { defaultOptions: { columns: ['2'] } },
        block('feature-grid'),
        PAGE_TYPES
      )
    ).toMatchObject({ kind: 'option' })
    expect(
      findSettingViolation({ defaultOptions: [] }, block('feature-grid'), PAGE_TYPES)
    ).toMatchObject({
      kind: 'field',
      field: 'defaultOptions',
    })
  })

  it('leaves alone what the input does not name, and takes null as the core default', () => {
    expect(findSettingViolation({}, block('hero'), PAGE_TYPES)).toBeNull()
    expect(
      findSettingViolation(
        { allowedPageTypes: null, defaultOptions: null, labels: null },
        block('hero'),
        PAGE_TYPES
      )
    ).toBeNull()
  })

  it('refuses a page type the site does not have, and an enabled that is not a boolean', () => {
    expect(
      findSettingViolation({ allowedPageTypes: ['poster'] }, block('hero'), PAGE_TYPES)
    ).toMatchObject({
      field: 'allowedPageTypes',
    })
    expect(
      findSettingViolation({ allowedPageTypes: 'landing' }, block('hero'), PAGE_TYPES)
    ).toMatchObject({
      field: 'allowedPageTypes',
    })
    expect(findSettingViolation({ enabled: 'no' }, block('hero'), PAGE_TYPES)).toMatchObject({
      field: 'enabled',
    })
  })

  it('refuses a label of an untranslated locale, of the wrong kind or over 60 characters', () => {
    for (const labels of [{ fr: 'x' }, { en: 1 }, { en: 'x'.repeat(61) }, 'x']) {
      expect(findSettingViolation({ labels }, block('hero'), PAGE_TYPES)).toMatchObject({
        field: 'labels',
      })
    }
    expect(
      findSettingViolation({ labels: { en: 'x'.repeat(60) } }, block('hero'), PAGE_TYPES)
    ).toBeNull()
  })
})

describe('settingOf', () => {
  it('takes the core defaults for a block with no row and for fields that are malformed', () => {
    expect(settingOf('hero', undefined)).toEqual({
      block: 'hero',
      enabled: true,
      allowedPageTypes: null,
      defaultOptions: {},
      labels: {},
    })
    expect(
      settingOf('hero', {
        enabled: false,
        allowedPageTypes: ['landing', 3],
        defaultOptions: { a: 'b', c: 1 },
        labels: { en: ' Hi ', es: '', fr: 'x' },
      })
    ).toEqual({
      block: 'hero',
      enabled: false,
      allowedPageTypes: ['landing'],
      defaultOptions: { a: 'b' },
      labels: { en: 'Hi' },
    })
  })
})

describe('mergedOptions', () => {
  it('puts the site default in place of the core one and keeps the core one beside it', () => {
    const options = mergedOptions(block('feature-grid'), { defaultOptions: { columns: '2' } })
    expect(options.columns).toEqual({ values: ['2', '3', '4'], default: '2', coreDefault: '3' })
    expect(options.density!.default).toBe(options.density!.coreDefault)
  })

  it('falls back to the core default when the contract no longer offers the stored value', () => {
    expect(
      mergedOptions(block('feature-grid'), { defaultOptions: { columns: '6' } }).columns!.default
    ).toBe('3')
  })
})

describe('page types', () => {
  it('lists the keys of the budgets, the site first after the global ones, without repeats', () => {
    const budgets = {
      pageTypes: { landing: 1, standard: 2 },
      sites: { demo: { standard: 3, poster: 4 } },
    }
    expect(knownPageTypes(budgets, 'demo')).toEqual(['landing', 'standard', 'poster'])
    expect(knownPageTypes(budgets, 'other')).toEqual(['landing', 'standard'])
    expect(knownPageTypes(budgets, null)).toEqual(['landing', 'standard'])
  })

  it('allows every page type unless the setting lists some', () => {
    expect(allowedPageTypesOf(undefined, PAGE_TYPES)).toEqual(PAGE_TYPES)
    expect(allowedPageTypesOf({ allowedPageTypes: null }, PAGE_TYPES)).toEqual(PAGE_TYPES)
    expect(allowedPageTypesOf({ allowedPageTypes: ['landing'] }, PAGE_TYPES)).toEqual(['landing'])
    expect(allowedPageTypesOf({ allowedPageTypes: [] }, PAGE_TYPES)).toEqual([])
  })
})

describe('blockIdsIn', () => {
  const attributes = {
    title: { type: 'string' },
    sections: { type: 'dynamiczone', components: [] },
    hero: { type: 'component', component: 'section.hero', repeatable: false },
    extras: { type: 'component', component: 'wrapper.group', repeatable: true },
  }
  const components: Record<string, Record<string, unknown>> = {
    'wrapper.group': { inner: { type: 'component', component: 'section.faq', repeatable: false } },
  }
  const componentAttributes = (uid: string) => components[uid]

  it('finds the blocks of a dynamic zone, of a component attribute and nested in another component', () => {
    expect(
      blockIdsIn(
        attributes,
        {
          title: 'x',
          sections: [
            { __component: 'section.feature-grid' },
            { __component: 'fixture.link' },
            { __component: 'section.feature-grid' },
          ],
          hero: { cta: 'a' },
          extras: [{ inner: { question: 'q' } }, { inner: null }],
        },
        componentAttributes
      )
    ).toEqual(['feature-grid', 'feature-grid', 'hero', 'faq'])
  })

  it('finds nothing in data that names no block, and skips what is not an object', () => {
    expect(blockIdsIn(attributes, { title: 'x' }, componentAttributes)).toEqual([])
    expect(
      blockIdsIn(attributes, { sections: ['x', null, { id: 1 }], hero: 'x' }, componentAttributes)
    ).toEqual([])
  })
})

describe('findBlockNotAllowed', () => {
  const off = new Map([['hero', { enabled: false, allowedPageTypes: null }]])
  const landingOnly = new Map([['hero', { enabled: true, allowedPageTypes: ['landing'] }]])

  it('refuses a disabled block that is added', () => {
    expect(findBlockNotAllowed(['hero'], [], off, 'standard')).toEqual({
      block: 'hero',
      reason: 'disabled',
    })
  })

  it('allows a block the page already holds, and refuses one more of it', () => {
    expect(findBlockNotAllowed(['hero'], ['hero'], off, 'standard')).toBeNull()
    expect(findBlockNotAllowed(['faq', 'hero'], ['hero', 'faq'], off, 'standard')).toBeNull()
    expect(findBlockNotAllowed(['hero', 'hero'], ['hero'], off, 'standard')).toMatchObject({
      block: 'hero',
    })
  })

  it('refuses a block outside its page types and names the page type', () => {
    expect(findBlockNotAllowed(['hero'], [], landingOnly, 'standard')).toEqual({
      block: 'hero',
      reason: 'pageType',
      pageType: 'standard',
    })
    expect(findBlockNotAllowed(['hero'], [], landingOnly, 'landing')).toBeNull()
  })

  it('allows a block with no setting, and a save that names no block', () => {
    expect(findBlockNotAllowed(['faq'], [], off, 'standard')).toBeNull()
    expect(findBlockNotAllowed([], [], off, 'standard')).toBeNull()
  })
})
