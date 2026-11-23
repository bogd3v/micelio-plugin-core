import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

const WALL = 'api::review-wall.review-wall' as UID.ContentType

interface Problem {
  status: number
  code: string
  detail: string
  zone: string
  position: number
  block: string
  item: number
  rating: unknown
  min: number
  max: number
}

// The `review-wall` fixture is a page whose zone holds `section.testimonials`, with the fields of
// `section.testimonial` micelio-cms stores since bogd3v/micelio-cms#516.
describe('the rating of a testimonial, at save', () => {
  let strapi: Core.Strapi
  let base: string
  let apiToken: string
  let siteDocumentId: string

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'testimonial-rating',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    siteDocumentId = (await strapi.db.query('plugin::micelio.site').findOne({ where: {} }))
      .documentId as string
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  const item = (extra: object = {}) => ({ quote: 'It works', author: 'Ana', ...extra })
  const block = (...items: object[]) => ({ __component: 'section.testimonials', items })

  const save = (sections: unknown[], documentId?: string) =>
    fetch(`${base}/api/review-walls${documentId ? `/${documentId}` : ''}?status=draft`, {
      method: documentId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'A wall', sections } }),
    })

  const count = () => strapi.documents(WALL).count({ status: 'draft' })

  it('refuses a rating outside 1 to 5', async () => {
    const before = await count()
    for (const rating of [0, 6, -1, 2.5, '4', true]) {
      const response = await save([block(item(), item({ rating }))])
      expect(response.status, `rating ${JSON.stringify(rating)}`).toBe(400)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      const problem = (await response.json()) as Problem
      expect(problem).toMatchObject({
        status: 400,
        code: 'testimonialRatingInvalid',
        zone: 'sections',
        position: 0,
        block: 'testimonials',
        item: 1,
        rating,
        min: 1,
        max: 5,
      })
      expect(problem.detail).toContain('sections.0')
      expect(problem.detail).toContain('item 1')
    }
    expect(await count()).toBe(before)
  })

  it('refuses an update that sets a bad rating and keeps the stored page', async () => {
    const created = await strapi.documents(WALL).create({
      data: {
        title: 'A wall',
        site: siteDocumentId,
        sections: [block(item({ rating: 4 }))],
      } as never,
      status: 'draft',
    })
    const response = await save([block(item({ rating: 9 }))], created.documentId)
    expect(response.status).toBe(400)
    expect(((await response.json()) as Problem).code).toBe('testimonialRatingInvalid')
    const stored = (await strapi.documents(WALL).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { sections: { populate: '*' } },
    })) as unknown as { sections: Array<{ items: Array<{ rating: number }> }> }
    expect(stored.sections[0]!.items[0]!.rating).toBe(4)
  })

  it('saves a rating from 1 to 5, and a testimonial with none', async () => {
    for (const rating of [1, 3, 5]) {
      expect((await save([block(item({ rating }))])).status).toBe(201)
    }
    expect((await save([block(item(), item({ rating: null }))])).status).toBe(201)
  })

  it('saves the source and the rating of a testimonial', async () => {
    const created = await strapi.documents(WALL).create({
      data: {
        title: 'A wall',
        site: siteDocumentId,
        sections: [block(item({ sourceUrl: 'https://example.com/post', rating: 5 }))],
      } as never,
      status: 'draft',
    })
    const stored = (await strapi.documents(WALL).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { sections: { populate: '*' } },
    })) as unknown as { sections: Array<{ items: Array<Record<string, unknown>> }> }
    expect(stored.sections[0]!.items[0]).toMatchObject({
      sourceUrl: 'https://example.com/post',
      rating: 5,
    })
  })
})
