import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

const SHOWCASE = 'api::showcase.showcase' as UID.ContentType

interface Problem {
  status: number
  code: string
  detail: string
  reason: string
  zone: string
  position: number
  block: string
  anchor: string
  firstUse?: { zone: string; position: number }
}

// The `showcase` fixture holds `section.scene`, one of the twelve sections whose heading is a
// `SectionHead`: its component carries `eyebrow` and `anchor` as `micelio-cms` stores them.
describe('the anchor of a section, at save', () => {
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
        name: 'section-anchor',
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

  const scene = (extra: object = {}) => ({
    __component: 'section.scene',
    variant: 'inline',
    alt: 'A hypha network',
    ...extra,
  })

  const save = (sections: unknown[], documentId?: string) =>
    fetch(`${base}/api/showcases${documentId ? `/${documentId}` : ''}?status=draft`, {
      method: documentId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'A page', sections } }),
    })

  async function refused(response: Response): Promise<Problem> {
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  it('refuses an anchor that is not kebab-case', async () => {
    for (const anchor of ['Our Story', 'our_story', 'Our-story', '-story', 'story-', 'a--b']) {
      const problem = await refused(await save([scene(), scene({ anchor })]))
      expect(problem).toMatchObject({
        code: 'sectionAnchorInvalid',
        status: 400,
        reason: 'format',
        zone: 'sections',
        position: 1,
        block: 'scene',
        anchor,
      })
      expect(problem.detail).toContain('sections.1')
    }
  })

  it('refuses an anchor used twice in one page, naming the position', async () => {
    const problem = await refused(
      await save([scene({ anchor: 'intro' }), scene(), scene({ anchor: 'intro' })])
    )
    expect(problem).toMatchObject({
      code: 'sectionAnchorInvalid',
      reason: 'duplicate',
      zone: 'sections',
      position: 2,
      block: 'scene',
      anchor: 'intro',
      firstUse: { zone: 'sections', position: 0 },
    })
    expect(problem.detail).toContain('sections.2')
    expect(problem.detail).toContain('sections.0')
  })

  it('accepts kebab-case anchors, an empty anchor, and none', async () => {
    const response = await save([
      scene({ anchor: 'our-story', eyebrow: 'Since 2020' }),
      scene({ anchor: 'part-2' }),
      scene({ anchor: null }),
      scene({ anchor: '' }),
      scene(),
    ])
    expect(response.status).toBe(201)
  })

  it('refuses a duplicate on an update, and writes nothing', async () => {
    const created = await save([scene({ anchor: 'one' })])
    const documentId = ((await created.json()) as { data: { documentId: string } }).data.documentId
    const problem = await refused(
      await save([scene({ anchor: 'one' }), scene({ anchor: 'one' })], documentId)
    )
    expect(problem.code).toBe('sectionAnchorInvalid')
    const stored = (await strapi.documents(SHOWCASE).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: { sections: true },
    } as never)) as unknown as { sections: unknown[] }
    expect(stored.sections).toHaveLength(1)
  })

  it('refuses it through the document service too, as a validation error', async () => {
    await expect(
      strapi.documents(SHOWCASE).create({
        locale: 'en',
        data: {
          title: 'Two',
          site: siteDocumentId,
          sections: [scene({ anchor: 'Bad Anchor' })],
        } as never,
      })
    ).rejects.toMatchObject({ details: { code: 'sectionAnchorInvalid', reason: 'format' } })
  })
})
