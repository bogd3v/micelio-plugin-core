import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'
import { solidPng } from './png'

const LEAFLET = 'api::leaflet.leaflet' as UID.ContentType
const BROCHURE = 'api::brochure.brochure' as UID.ContentType
const HANDOUT = 'api::handout.handout' as UID.ContentType
const FLYER = 'api::flyer.flyer' as UID.ContentType
const PASSWORD = 'Password1234'
const DESCRIPTION =
  'A plain-words guide to what open source is, what it is not, and why it matters to anyone who uses software.'

interface Problem {
  status?: number
  code: string
  detail: string
  problems?: { code: string }[]
}

interface Seo {
  id: number
  metaTitle: string | null
  metaDescription: string | null
  metaImage: { id: number } | null
  keywords?: string | null
}

// The SEO fields of a page (issue #53), on `leaflet`: a site-scoped, editorial page type with page
// settings, a `seo` component (`shared.seo`, with the 60 and 160 character limits micelio-cms declares)
// and a `hero` section. They are derived at save when empty and checked when the page leaves `draft`.
describe('the SEO fields at save and at send to review', () => {
  let strapi: Core.Strapi
  let base: string
  let adminToken: string
  let site: string
  let image: number
  let small: number
  let pages = 0
  const leaflets = () => strapi.documents(LEAFLET)

  async function upload(name: string, width: number, height: number): Promise<number> {
    const bytes = solidPng(width, height)
    const filepath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-seo-')), name)
    fs.writeFileSync(filepath, bytes)
    const [file] = (await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        data: { fileInfo: { name } },
        files: { filepath, originalFilename: name, mimetype: 'image/png', size: bytes.length },
      })) as { id: number }[]
    return file!.id
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: 'seo@example.com',
      firstname: 'Seo',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'seo@example.com', password: PASSWORD }),
    })
    adminToken = ((await login.json()) as { data: { token: string } }).data.token
    const found = (await strapi.db.query('plugin::micelio.site').findOne({ where: {} })) as {
      documentId: string
    }
    site = found.documentId
    await strapi.documents('plugin::micelio.site' as UID.ContentType).update({
      documentId: site,
      data: { name: 'Demo site' } as never,
    })
    image = await upload('card.png', 1200, 630)
    small = await upload('small.png', 600, 315)
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  async function newLeaflet(data: Record<string, unknown> = {}): Promise<string> {
    pages += 1
    const created = await leaflets().create({
      locale: 'en',
      data: {
        title: `Open source ${pages}`,
        slug: `open-source-${pages}`,
        site,
        sections: [{ __component: 'section.rich-text', body: DESCRIPTION }],
        ...data,
      } as never,
    })
    return created.documentId
  }

  async function seoOf(documentId: string): Promise<Seo | null> {
    const draft = (await leaflets().findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: { seo: { populate: ['metaImage'] } },
    } as never)) as unknown as { seo: Seo | null }
    return draft.seo
  }

  const complete = (extra: Record<string, unknown> = {}) => ({
    metaTitle: 'Open source, in plain words',
    metaDescription: DESCRIPTION,
    metaImage: image,
    ...extra,
  })

  async function move(
    documentId: string,
    to: string,
    options: Record<string, unknown> = {}
  ): Promise<{ status: number; body: Problem & { data?: { warnings: Problem[] } } }> {
    const response = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ uid: LEAFLET, documentId, locale: 'en', to, ...options }),
    })
    return { status: response.status, body: (await response.json()) as never }
  }

  it('sending to review with a description over 160 is refused', async () => {
    const documentId = await newLeaflet({ seo: complete({ metaDescription: 'x'.repeat(161) }) })
    // The host declares `maxLength: 160`; the plugin lifts it, so the draft is saved.
    expect((await seoOf(documentId))?.metaDescription).toHaveLength(161)
    const answer = await move(documentId, 'in_review')
    expect(answer.status).toBe(409)
    expect(answer.body.code).toBe('seoInvalid')
    expect(answer.body.problems).toEqual([{ code: 'metaDescriptionTooLong' }])
    expect(answer.body.detail).toMatch(/over 160 characters/)
    // A dry run is refused too, and nothing moved.
    expect((await move(documentId, 'in_review', { dryRun: true })).status).toBe(409)
    await leaflets().update({
      documentId,
      locale: 'en',
      data: { seo: { metaDescription: DESCRIPTION } } as never,
    })
    expect((await move(documentId, 'in_review')).status).toBe(200)
  })

  it('a description repeating the title is a warning', async () => {
    const title = 'Open source, in plain words'
    const documentId = await newLeaflet({
      title,
      seo: complete({
        metaDescription: 'Open source, in plain words: open source, in plain words, again.',
      }),
    })
    const answer = await move(documentId, 'in_review')
    expect(answer.status).toBe(200)
    expect(answer.body.data?.warnings.map((warning) => warning.code)).toEqual([
      'descriptionRepeatsTitle',
    ])
  })

  it('refuses a page with no social image, or one that is not 1200 by 630, and names each problem', async () => {
    const without = await newLeaflet({
      seo: { metaTitle: 'Open source', metaDescription: DESCRIPTION },
      sections: [],
    })
    const missing = await move(without, 'in_review')
    expect(missing.body.code).toBe('seoInvalid')
    expect(missing.body.problems).toEqual([{ code: 'metaImageMissing' }])
    const wrong = await newLeaflet({ seo: complete({ metaImage: small }) })
    expect((await move(wrong, 'in_review')).body.problems).toEqual([{ code: 'metaImageSize' }])
    const empty = await newLeaflet({ sections: [], seo: { keywords: 'one' } })
    // The title and the site's name filled the meta title when the page was saved.
    expect((await move(empty, 'in_review')).body.problems).toEqual([
      { code: 'metaDescriptionMissing' },
      { code: 'metaImageMissing' },
    ])
  })

  it('checks a move to published and to scheduled, and a move back to draft is free', async () => {
    const documentId = await newLeaflet({ seo: complete() })
    expect((await move(documentId, 'in_review')).status).toBe(200)
    await leaflets().update({
      documentId,
      locale: 'en',
      data: { seo: { metaTitle: 'x'.repeat(61) } } as never,
    })
    const published = await move(documentId, 'published')
    expect(published.body.problems).toEqual([{ code: 'metaTitleTooLong' }])
    expect((await move(documentId, 'draft')).status).toBe(200)
  })

  it('does not check a page type that has no seo component', async () => {
    const created = await strapi.documents(BROCHURE).create({
      locale: 'en',
      data: { title: 'No seo', slug: 'no-seo', site, sections: [] } as never,
    })
    const response = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        uid: BROCHURE,
        documentId: created.documentId,
        locale: 'en',
        to: 'in_review',
      }),
    })
    expect(response.status).toBe(200)
  })

  it('the scheduler publishes a scheduled page without checking its SEO fields again', async () => {
    const documentId = await newLeaflet({ seo: complete() })
    const at = new Date(Date.now() + 3_600_000).toISOString()
    expect((await move(documentId, 'scheduled', { publishAt: at })).status).toBe(200)
    // A write that is not a save of the page (a restore, a script) leaves the fields empty.
    const stored = await seoOf(documentId)
    await strapi.db
      .query('shared.seo' as never)
      .update({ where: { id: stored!.id }, data: { metaDescription: null } } as never)
    const published = await strapi
      .plugin('micelio')
      .service('transitions')
      .perform({
        uid: LEAFLET,
        documentId,
        locale: 'en',
        to: 'published',
        actor: { kind: 'system' },
      })
    expect(published.to).toBe('published')
  })

  it('does not check an editorial type with a seo component and no page settings', async () => {
    const created = await strapi.documents(FLYER).create({
      locale: 'en',
      data: { title: 'A flyer', site } as never,
    })
    const response = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        uid: FLYER,
        documentId: created.documentId,
        locale: 'en',
        to: 'in_review',
      }),
    })
    expect(response.status).toBe(200)
    // Nothing was derived either.
    const stored = (await strapi.documents(FLYER).findOne({
      documentId: created.documentId,
      locale: 'en',
      status: 'draft',
      populate: ['seo'],
    } as never)) as unknown as { seo: unknown }
    expect(stored.seo).toBeNull()
  })

  it('a transition derives nothing: a page saved before the plugin is refused for its empty fields', async () => {
    const documentId = await newLeaflet({ sections: [] })
    // Wipe what the save derived, as a page that was saved before the plugin has none.
    const stored = await seoOf(documentId)
    await strapi.db.query('shared.seo' as never).update({
      where: { id: stored!.id },
      data: { metaTitle: null, metaDescription: null },
    } as never)
    const answer = await move(documentId, 'in_review')
    expect(answer.body.problems?.map((problem) => problem.code)).toEqual([
      'metaTitleMissing',
      'metaDescriptionMissing',
      'metaImageMissing',
    ])
    expect((await seoOf(documentId))?.metaTitle).toBeNull()
  })

  describe('the defaults, derived at save when a field is empty', () => {
    it('fills the meta title, the description and the image of a new page', async () => {
      const hero = {
        __component: 'section.hero',
        title: 'Hero',
        variant: 'centered',
        text: 'A short lead',
        media: image,
      }
      const documentId = await newLeaflet({
        title: 'Open source, in plain words',
        sections: [hero, { __component: 'section.rich-text', body: `# Heading\n\n${DESCRIPTION}` }],
      })
      const seo = await seoOf(documentId)
      expect(seo?.metaTitle).toBe('Open source, in plain words · Demo site')
      expect(seo?.metaDescription).toBe(DESCRIPTION)
      expect(seo?.metaImage?.id).toBe(image)
      expect((await move(documentId, 'in_review')).status).toBe(200)
    })

    it('never touches a field that has a value, and keeps the fields a save does not name', async () => {
      const documentId = await newLeaflet({
        seo: { metaTitle: 'My own title', keywords: 'one, two' },
      })
      let seo = await seoOf(documentId)
      expect(seo?.metaTitle).toBe('My own title')
      expect(seo?.metaDescription).toBe(DESCRIPTION)
      const id = seo?.id
      await leaflets().update({
        documentId,
        locale: 'en',
        data: {
          title: 'Another title',
          seo: { metaDescription: 'Written by hand, and long enough to be a description.' },
        } as never,
      })
      seo = await seoOf(documentId)
      expect(seo).toMatchObject({
        id,
        metaTitle: 'My own title',
        metaDescription: 'Written by hand, and long enough to be a description.',
        keywords: 'one, two',
      })
    })

    it('derives the fields that are empty when the content is saved later', async () => {
      const documentId = await newLeaflet({ sections: [] })
      expect((await seoOf(documentId))?.metaDescription).toBeNull()
      await leaflets().update({
        documentId,
        locale: 'en',
        data: { sections: [{ __component: 'section.rich-text', body: DESCRIPTION }] } as never,
      })
      const seo = await seoOf(documentId)
      expect(seo?.metaDescription).toBe(DESCRIPTION)
      expect(seo?.metaTitle).toBe(`Open source ${pages} · Demo site`)
    })

    it('does not derive an image from a hero whose media is not an image', async () => {
      const file = (await strapi.db.query('plugin::upload.file').create({
        data: {
          name: 'clip.mp4',
          hash: 'clip',
          ext: '.mp4',
          mime: 'video/mp4',
          size: 1,
          url: '/uploads/clip.mp4',
          provider: 'local',
        },
      })) as { id: number }
      const documentId = await newLeaflet({
        sections: [
          { __component: 'section.hero', title: 'Hero', variant: 'centered', media: file.id },
        ],
      })
      expect((await seoOf(documentId))?.metaImage).toBeNull()
    })

    it('does not run for a save that names none of the title, the seo and the zones', async () => {
      const documentId = await newLeaflet({ sections: [] })
      const stored = await seoOf(documentId)
      await strapi.db.query('shared.seo' as never).update({
        where: { id: stored!.id },
        data: { metaTitle: null },
      } as never)
      await leaflets().update({
        documentId,
        locale: 'en',
        data: { pageType: 'landing' } as never,
      })
      expect((await seoOf(documentId))?.metaTitle).toBeNull()
    })
  })

  // `handout` has the shape of micelio-cms's page: page settings, no `withEditorial`, so it is published
  // straight from `create` with `status: 'published'` (issue #223).
  const handouts = () => strapi.documents(HANDOUT)
  let handoutCount = 0

  async function newHandout(
    data: Record<string, unknown> = {},
    status: 'draft' | 'published' = 'draft'
  ): Promise<string> {
    handoutCount += 1
    const created = await handouts().create({
      locale: 'en',
      status,
      data: {
        title: `Handout ${handoutCount}`,
        slug: `handout-${handoutCount}`,
        site,
        sections: [],
        ...data,
      } as never,
    } as never)
    return created.documentId
  }

  async function handoutSeo(documentId: string, status: 'draft' | 'published' = 'draft') {
    const found = (await handouts().findOne({
      documentId,
      locale: 'en',
      status,
      populate: { seo: { populate: ['metaImage'] } },
    } as never)) as unknown as { seo: Seo | null }
    return found.seo
  }

  it('keeps the meta title of a page with no description when the host requires none', async () => {
    const documentId = await newHandout()
    const seo = await handoutSeo(documentId)
    expect(seo?.metaTitle).toBe(`Handout ${handoutCount} · Demo site`)
    expect(seo?.metaDescription ?? null).toBeNull()
  })

  // A host whose `seo` component requires the description (issue #223): `metaDescription` is `required`
  // with `minLength` 50, as micelio-cms 0.7 declares it. The test app's `shared.seo` requires nothing
  // (the other suites save pages without one), so this block sets the constraint on the loaded
  // component while it runs, the way `liftSeoLimits` takes the limits off, and puts it back after.
  describe('a page type whose seo component requires the description', () => {
    type Attributes = Record<string, Record<string, unknown>>
    let restore: (() => void)[] = []

    beforeAll(() => {
      const component = (
        strapi.components as unknown as Record<
          string,
          { attributes?: Attributes; __schema__?: { attributes?: Attributes } }
        >
      )['shared.seo']!
      restore = [component.attributes, component.__schema__?.attributes].flatMap((attributes) => {
        if (!attributes?.metaDescription) return []
        const before = attributes.metaDescription
        attributes.metaDescription = { ...before, required: true, minLength: 50 }
        return [() => void (attributes.metaDescription = before)]
      })
    })

    afterAll(() => {
      for (const undo of restore.reverse()) undo()
    })

    it('saves a new page with no description to derive, and stores none', async () => {
      const documentId = await newLeaflet({ sections: [] })
      // No component is stored: one with a title and no description cannot be published later.
      expect(await seoOf(documentId)).toBeNull()
    })

    it('saves a later edit of a page that has no seo component yet, and stores none', async () => {
      const documentId = await newLeaflet({ sections: [] })
      await leaflets().update({ documentId, locale: 'en', data: { title: 'Renamed' } as never })
      await leaflets().update({ documentId, locale: 'en', data: { sections: [] } as never })
      expect(await seoOf(documentId)).toBeNull()
    })

    it('a page with no description is still refused when it leaves draft, with metaDescriptionMissing', async () => {
      const documentId = await newLeaflet({ sections: [] })
      const answer = await move(documentId, 'in_review')
      expect(answer.status).toBe(409)
      expect(answer.body.code).toBe('seoInvalid')
      expect(answer.body.problems?.map((problem) => problem.code)).toContain(
        'metaDescriptionMissing'
      )
    })

    it('publishes a new page with no description to derive, and stores no seo component', async () => {
      const documentId = await newHandout({}, 'published')
      expect(await handoutSeo(documentId, 'published')).toBeNull()
      expect(await handoutSeo(documentId)).toBeNull()
    })

    it('publishes a draft that has no seo component', async () => {
      const documentId = await newHandout()
      expect(await handoutSeo(documentId)).toBeNull()
      await expect(handouts().publish({ documentId, locale: 'en' } as never)).resolves.toBeTruthy()
      expect(await handoutSeo(documentId, 'published')).toBeNull()
    })

    it('derives the description when the page has a paragraph for it', async () => {
      const documentId = await newLeaflet()
      expect((await seoOf(documentId))?.metaDescription).toBe(DESCRIPTION)
    })

    it('keeps the stored description when a later save has no paragraph to derive one from', async () => {
      const documentId = await newLeaflet()
      await leaflets().update({
        documentId,
        locale: 'en',
        data: { sections: [], title: 'Edited' } as never,
      })
      expect((await seoOf(documentId))?.metaDescription).toBe(DESCRIPTION)
    })
  })

  describe('the structured data written by hand', () => {
    it('is refused at save when it is not JSON-LD', async () => {
      const documentId = await newLeaflet()
      await expect(
        leaflets().update({
          documentId,
          locale: 'en',
          data: { seo: { structuredData: '{"@type": "Article"}' } } as never,
        })
      ).rejects.toMatchObject({
        details: { code: 'structuredDataInvalid', field: 'structuredData' },
      })
      await expect(
        leaflets().create({
          locale: 'en',
          data: { title: 'Bad', slug: 'bad', site, seo: { structuredData: 'not json' } } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'structuredDataInvalid' } })
    })

    it('is stored when it is valid', async () => {
      const documentId = await newLeaflet()
      const data = { '@context': 'https://schema.org', '@type': 'Article', headline: 'Hi' }
      await leaflets().update({
        documentId,
        locale: 'en',
        data: { seo: { structuredData: data } } as never,
      })
      const stored = (await leaflets().findOne({
        documentId,
        locale: 'en',
        status: 'draft',
        populate: ['seo'],
      } as never)) as unknown as { seo: { structuredData: unknown } }
      expect(stored.seo.structuredData).toEqual(data)
    })
  })
})
