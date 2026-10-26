import { describe, expect, it } from 'vitest'
import { hasPreview, previewPagePath } from '../admin/src/utils/previewAction'

const zone = { type: 'dynamiczone' }
const scoped = { micelio: { siteScoped: true } }

describe('hasPreview', () => {
  it('is true for a type with a site and a dynamic zone', () => {
    expect(hasPreview({ attributes: { sections: zone }, pluginOptions: scoped })).toBe(true)
  })

  it('is false for a dynamic zone without a site', () => {
    expect(hasPreview({ attributes: { sections: zone } })).toBe(false)
    expect(hasPreview({ attributes: { sections: zone }, pluginOptions: { micelio: {} } })).toBe(
      false
    )
  })

  it('is false for a site without a dynamic zone, and for no schema', () => {
    expect(hasPreview({ attributes: { title: { type: 'string' } }, pluginOptions: scoped })).toBe(
      false
    )
    expect(hasPreview(undefined)).toBe(false)
  })
})

describe('previewPagePath', () => {
  it('encodes the uid and adds the locale when there is one', () => {
    expect(previewPagePath('api::page.page', 'abc', 'en')).toBe(
      '/plugins/micelio/preview/api%3A%3Apage.page/abc?locale=en'
    )
    expect(previewPagePath('api::page.page', 'abc', null)).toBe(
      '/plugins/micelio/preview/api%3A%3Apage.page/abc'
    )
  })
})
