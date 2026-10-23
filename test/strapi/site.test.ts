import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { SITE_COMPONENT_CATEGORY, SITE_UID } from '../../server/src/constants/site'
import { ensureDefaultSite } from '../../server/src/migrations/default-site'
import { cleanupStrapi, setupStrapi } from './harness'

const COMPONENTS = ['accent-override', 'author', 'fediverse', 'modules', 'social-link', 'theme']

describe('the site content type', () => {
  let strapi: Core.Strapi
  const sites = () => strapi.documents(SITE_UID as UID.ContentType)

  beforeAll(async () => {
    strapi = await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('boots with exactly one site, the default one', async () => {
    const all = await sites().findMany({})
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ slug: 'default', isDefault: true, name: 'Micelio', hosts: [] })
  })

  it('does not create a second default site on the next boot', async () => {
    expect(await ensureDefaultSite(strapi)).toBe(false)
    expect(await strapi.db.query(SITE_UID).count()).toBe(1)
  })

  it('is visible in the Content Manager', () => {
    const schema = strapi.contentType(SITE_UID as UID.ContentType)
    expect(schema.pluginOptions?.['content-manager']).toMatchObject({ visible: true })
  })

  it('registers its components under their own category', () => {
    for (const name of COMPONENTS) {
      expect(strapi.components[`${SITE_COMPONENT_CATEGORY}.${name}` as UID.Component]).toBeDefined()
    }
  })

  it('stores the fields of site-setting, components included', async () => {
    const created = await sites().create({
      data: {
        name: 'Example',
        slug: 'example',
        hosts: ['example.com'],
        isDefault: false,
        defaultLocale: 'en',
        author: { name: 'An author', url: 'https://example.com/about' },
        socialLinks: [{ network: 'website', url: 'https://example.com' }],
        modules: { comments: false },
        theme: {
          themeId: 'starter',
          themeVersion: '1.2.0',
          accentOverrides: [{ mode: 'dark', color: '#123456' }],
        },
        fediverse: { username: 'example' },
      },
    })
    const site = await sites().findOne({ documentId: created.documentId, populate: '*' })
    expect(site).toMatchObject({
      author: { name: 'An author' },
      socialLinks: [{ network: 'website' }],
      modules: { comments: false, newsletter: true },
      theme: { themeId: 'starter', themeVersion: '1.2.0' },
      fediverse: { username: 'example' },
    })
    await sites().delete({ documentId: created.documentId })
  })

  it('rejects a slug that is not kebab-case', async () => {
    await expect(
      sites().create({
        data: {
          name: 'Bad',
          slug: 'Not A Slug',
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
        },
      })
    ).rejects.toThrow(/slug/)
  })

  it('rejects a theme version that is not exact', async () => {
    await expect(
      sites().create({
        data: {
          name: 'Bad',
          slug: 'bad',
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
          theme: { themeVersion: '^1.2.0' },
        },
      })
    ).rejects.toThrow(/themeVersion/)
  })
})
