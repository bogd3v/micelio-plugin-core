import { describe, expect, it } from 'vitest'
import {
  budgetKbOf,
  heaviestBlocks,
  isMeasurable,
  measuredTypesOf,
  overByKb,
  pageTypeOf,
  parseWeightReport,
} from '../server/src/budget/rules'
import type { BudgetsConfig } from '../server/src/config'

const budgets: BudgetsConfig = {
  pageTypes: { landing: 60, standard: 120, 'long-read': 160 },
  sites: { blog: { standard: 200, poster: 30 } },
}

const report = {
  data: {
    mode: 'dynamic',
    htmlKb: 5,
    cssKb: 20,
    jsKb: 40,
    fontKb: 10,
    imagesKb: 7,
    totalKb: 82,
    onDemandKb: 600,
    blocks: [
      { id: 'hero', kb: 4.5, onDemandKb: 0 },
      { id: 'scene', kb: 30, onDemandKb: 600 },
      { id: 'rich-text', kb: 4.5, onDemandKb: 0 },
    ],
  },
}

describe('the budget of a page', () => {
  it.each([
    ['landing', 'any', 60],
    ['standard', 'any', 120],
    ['long-read', 'any', 160],
    ['standard', 'blog', 200],
    ['landing', 'blog', 60],
    ['poster', 'blog', 30],
  ])('is the %s budget of site %s: %d kB', (pageType, site, expected) => {
    expect(budgetKbOf(budgets, site, pageType)).toBe(expected)
  })

  it('falls back to the standard budget for a page type nobody configured, and to the core default without config', () => {
    expect(budgetKbOf(budgets, 'blog', 'unheard-of')).toBe(200)
    expect(budgetKbOf({ pageTypes: {}, sites: {} }, null, 'standard')).toBe(120)
  })

  it('takes the page type of the draft when the budgets list it, else standard', () => {
    expect(pageTypeOf({ pageType: 'landing' }, budgets, null)).toBe('landing')
    expect(pageTypeOf({ pageType: 'poster' }, budgets, 'blog')).toBe('poster')
    expect(pageTypeOf({ pageType: 'poster' }, budgets, 'other')).toBe('standard')
    expect(pageTypeOf({ pageType: 'unheard-of' }, budgets, null)).toBe('standard')
    expect(pageTypeOf({ pageType: 3 }, budgets, null)).toBe('standard')
    expect(pageTypeOf({}, budgets, null)).toBe('standard')
  })
})

describe('how far a page is over its budget', () => {
  it.each([
    [119.9, 120, 0],
    [120, 120, 0],
    [120.1, 120, 0.1],
    [130.04, 120, 10],
    [160, 120, 40],
  ])('weighing %d kB against %d kB is %d kB over', (blocksKb, budgetKb, expected) => {
    expect(overByKb({ blocksKb }, budgetKb)).toBe(expected)
  })

  it('lists the blocks heaviest first, the earlier one first among equals', () => {
    const parsed = parseWeightReport(report)!
    expect(heaviestBlocks(parsed).map(({ position, id, kb }) => [position, id, kb])).toEqual([
      [2, 'scene', 30],
      [1, 'hero', 4.5],
      [3, 'rich-text', 4.5],
    ])
  })
})

describe('the weight report of the frontend', () => {
  it('keeps the on-demand weight apart from the total and numbers the blocks from 1', () => {
    const parsed = parseWeightReport(report)!
    expect(parsed.totalKb).toBe(82)
    // 4.5 + 30 + 4.5: the blocks' own shares; the rest of the 82 kB is every page's
    expect(parsed.blocksKb).toBe(39)
    expect(parsed.frameworkKb).toBe(43)
    expect(parsed.onDemandKb).toBe(600)
    expect(parsed.blocks.map((block) => block.position)).toEqual([1, 2, 3])
    expect(parsed).not.toHaveProperty('mode')
  })

  it.each([
    ['a page of the static mode', { data: { ...report.data, mode: 'static' } }],
    ['a total that is not a number', { data: { ...report.data, totalKb: '82' } }],
    ['a negative total', { data: { ...report.data, totalKb: -1 } }],
    ['a block without an id', { data: { ...report.data, blocks: [{ kb: 1, onDemandKb: 0 }] } }],
    ['no data', {}],
    ['no object', 'heavy'],
    ['null', null],
  ])('does not read %s', (_name, body) => {
    expect(parseWeightReport(body)).toBeNull()
  })
})

describe('the types that are measured', () => {
  const siteScoped = { siteScoped: true }
  const blocks = { blocks: { type: 'dynamiczone' } }

  it('are site-scoped, editorial and have a dynamic zone', () => {
    expect(
      isMeasurable({
        attributes: blocks,
        pluginOptions: { micelio: { ...siteScoped, editorial: true } },
      })
    ).toBe(true)
  })

  it.each([
    [
      'without a dynamic zone',
      {
        attributes: { title: { type: 'string' } },
        pluginOptions: { micelio: { ...siteScoped, editorial: true } },
      },
    ],
    [
      'without the editorial workflow',
      { attributes: blocks, pluginOptions: { micelio: siteScoped } },
    ],
    ['outside a site', { attributes: blocks, pluginOptions: { micelio: { editorial: true } } }],
    ['unknown', undefined],
  ])('are not measured %s', (_name, schema) => {
    expect(isMeasurable(schema)).toBe(false)
  })
})

describe('the types listed as measured', () => {
  it('default to the types the frontend previews', () => {
    expect(measuredTypesOf({})).toEqual(['api::page.page', 'api::article.article'])
  })

  it('are the host list, which replaces the default whole', () => {
    expect(measuredTypesOf({ contentTypes: ['api::story.story'] })).toEqual(['api::story.story'])
    expect(measuredTypesOf({ contentTypes: [] })).toEqual([])
  })
})
