import { describe, expect, it } from 'vitest'
import {
  formatKb,
  isSameVersion,
  meterLevel,
  meterPercent,
  NEAR_RATIO,
  onDemandBlocks,
  weightRoute,
} from '../admin/src/utils/costMeter'

describe('the level of the cost meter', () => {
  it.each([
    [0, 'ok'],
    [53.9, 'ok'],
    [107.9, 'ok'],
    [108, 'near'],
    [119.9, 'near'],
    [120, 'near'],
    [120.1, 'over'],
    [400, 'over'],
  ])('is %d kB of 120 kB: %s', (totalKb, level) => {
    expect(meterLevel(totalKb, 120)).toBe(level)
  })

  it('turns at 90 % of any budget', () => {
    expect(NEAR_RATIO).toBe(0.9)
    expect(meterLevel(53.9, 60)).toBe('ok')
    expect(meterLevel(54, 60)).toBe('near')
    expect(meterLevel(60.1, 60)).toBe('over')
  })

  it('turns at exactly 90 % of a budget whose product with 0.9 is not exact', () => {
    // 13 * 0.9 is 11.700000000000001 in floating point.
    expect(meterLevel(11.7, 13)).toBe('near')
    expect(meterLevel(11.6, 13)).toBe('ok')
    expect(meterLevel(18.9, 21)).toBe('near')
    expect(meterLevel(23.4, 26)).toBe('near')
  })

  it('is over what the publish refuses and no sooner, so a page on its budget is not over', () => {
    expect(meterLevel(160, 160)).not.toBe('over')
    expect(meterLevel(160.1, 160)).toBe('over')
  })
})

describe('the bar of the cost meter', () => {
  it.each([
    [0, 0],
    [60, 50],
    [107.9, 89.9],
    [120, 100],
    [300, 100],
  ])('fills %d kB of 120 kB to %d %%', (totalKb, percent) => {
    expect(meterPercent(totalKb, 120)).toBe(percent)
  })

  it('is full against a budget of nothing', () => {
    expect(meterPercent(1, 0)).toBe(100)
  })
})

describe('the on-demand weight', () => {
  const blocks = [
    { position: 1, id: 'hero', kb: 4, onDemandKb: 0 },
    { position: 2, id: 'scene', kb: 3, onDemandKb: 600 },
    { position: 3, id: 'gallery', kb: 2, onDemandKb: 40 },
  ]

  it('lists the blocks that load script only once used, heaviest first', () => {
    expect(onDemandBlocks(blocks).map((block) => block.id)).toEqual(['scene', 'gallery'])
  })

  it('changes neither the level nor the bar: the total never holds it', () => {
    const total = blocks.reduce((sum, block) => sum + block.kb, 0)
    expect(meterLevel(total, 120)).toBe('ok')
    expect(meterPercent(total, 120)).toBe(7.5)
  })

  it('writes kB with one decimal and no trailing zero', () => {
    expect([42, 42.5, 42.04, 0.1 + 0.2].map(formatKb)).toEqual(['42', '42.5', '42', '0.3'])
  })
})

describe('the route of the weight report', () => {
  it('is the site’s own, without the token, in the dynamic mode and the locale of the draft', () => {
    expect(
      weightRoute('https://example.com/_preview?token=abc', 'api::page.page', 'doc1', 'es')
    ).toBe('https://example.com/api/preview/api%3A%3Apage.page/doc1/weight?mode=dynamic&locale=es')
  })

  it('keeps the path a site is served under, and asks for no locale a type does not have', () => {
    expect(
      weightRoute('https://example.com/blog/_preview?token=abc', 'api::page.page', 'doc1', null)
    ).toBe('https://example.com/blog/api/preview/api%3A%3Apage.page/doc1/weight?mode=dynamic')
  })

  it('is none for a URL that is not one', () => {
    expect(weightRoute('not a url', 'api::page.page', 'doc1', null)).toBeUndefined()
  })
})

describe('the version a measurement is compared with', () => {
  it('is the same for one instant in two formats', () => {
    expect(isSameVersion('2026-10-27T10:00:00.000Z', '2026-10-27T10:00:00Z')).toBe(true)
  })

  it('is different for a later save', () => {
    expect(isSameVersion('2026-10-27T10:00:00.000Z', '2026-10-27T10:00:01.000Z')).toBe(false)
  })

  it.each([undefined, 'not a date'])('is different for %s', (current) => {
    expect(isSameVersion('2026-10-27T10:00:00.000Z', current)).toBe(false)
  })
})
