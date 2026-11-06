import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

const SHOWCASE = 'api::showcase.showcase' as UID.ContentType
const PASSWORD = 'Password1234'
const SCENE = 'section.scene'
const PLAYGROUND = 'shared.playground'

interface Problem {
  status: number
  code: string
  detail: string
  block?: string
  count?: number
  limit?: number
  blocks?: { block: string; position: number; fields: string[]; zone: string }[]
}

// The `showcase` fixture is editorial and holds `section.scene` (the 3D island, whose static
// alternative is its poster and alt text) and `shared.playground` (the runtime island, whose static
// alternative is its expected output).
describe('the islands, at save and at send to review', () => {
  let strapi: Core.Strapi
  let base: string
  let adminToken: string
  let apiToken: string
  let siteDocumentId: string

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: 'islands@example.com',
      firstname: 'Islands',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'islands@example.com', password: PASSWORD }),
    })
    adminToken = ((await login.json()) as { data: { token: string } }).data.token
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'islands',
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

  async function newShowcase(sections: object[]): Promise<string> {
    const created = await strapi.documents(SHOWCASE).create({
      locale: 'en',
      data: { title: 'An island page', site: siteDocumentId, sections } as never,
    })
    return created.documentId
  }

  const sendToReview = (documentId: string) =>
    fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ uid: SHOWCASE, documentId, to: 'in_review' }),
    })

  const stateOf = async (documentId: string): Promise<string | undefined> =>
    (
      (await strapi.documents(SHOWCASE).findOne({
        documentId,
        locale: 'en',
        status: 'draft',
        populate: ['editorial'],
      } as never)) as unknown as { editorial?: { state?: string } }
    ).editorial?.state

  async function poster(): Promise<number> {
    const file = (await strapi.db.query('plugin::upload.file').create({
      data: {
        name: 'poster.png',
        hash: `poster_${Date.now()}`,
        ext: '.png',
        mime: 'image/png',
        size: 1,
        url: '/uploads/poster.png',
        provider: 'local',
      },
    })) as { id: number }
    return file.id
  }

  const scene = (extra: object = {}) => ({
    __component: SCENE,
    variant: 'inline',
    alt: 'A hypha network',
    ...extra,
  })

  const saveSections = (sections: unknown[], documentId?: string) =>
    fetch(`${base}/api/showcases${documentId ? `/${documentId}` : ''}?status=draft`, {
      method: documentId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'A page', sections } }),
    })

  it('a page with a Scene without poster cannot be sent to review', async () => {
    const documentId = await newShowcase([scene()])
    const response = await sendToReview(documentId)
    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    const problem = (await response.json()) as Problem
    expect(problem).toMatchObject({
      code: 'islandAlternativeMissing',
      status: 409,
      blocks: [{ block: 'scene', position: 0, fields: ['poster'], zone: 'sections' }],
    })
    expect(problem.detail).toContain('scene block at position 1 (poster)')
    // The refusal writes nothing: the page is still a draft.
    expect(await stateOf(documentId)).toBe('draft')
  })

  it('a page whose Scene has its poster and alt text goes to review', async () => {
    const documentId = await newShowcase([scene({ poster: await poster() })])
    const response = await sendToReview(documentId)
    expect(response.status).toBe(200)
    expect(await stateOf(documentId)).toBe('in_review')
  })

  it('a Scene with a blank alt text is missing it too, and every empty field is named', async () => {
    const documentId = await newShowcase([scene({ alt: '   ' })])
    const problem = (await (await sendToReview(documentId)).json()) as Problem
    expect(problem.blocks).toEqual([
      { block: 'scene', position: 0, fields: ['poster', 'alt'], zone: 'sections' },
    ])
  })

  it('a Playground without expected output cannot be sent to review, and with it can', async () => {
    const bare = await newShowcase([
      { __component: PLAYGROUND, runtime: 'python', code: 'print(1)' },
    ])
    const problem = (await (await sendToReview(bare)).json()) as Problem
    expect(problem.blocks).toEqual([
      { block: 'playground', position: 0, fields: ['expectedOutput'], zone: 'sections' },
    ])
    const filled = await newShowcase([
      { __component: PLAYGROUND, runtime: 'python', code: 'print(1)', expectedOutput: '1' },
    ])
    expect((await sendToReview(filled)).status).toBe(200)
  })

  it('a page with no island goes to review as before', async () => {
    const documentId = await newShowcase([{ __component: 'section.rich-text', body: 'Text' }])
    expect((await sendToReview(documentId)).status).toBe(200)
  })

  it('a page cannot be scheduled or published while an island lacks its alternative', async () => {
    const documentId = await newShowcase([scene()])
    const publishAt = new Date(Date.now() + 3_600_000).toISOString()
    const schedule = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ uid: SHOWCASE, documentId, to: 'scheduled', publishAt }),
    })
    expect(schedule.status).toBe(409)
    expect(((await schedule.json()) as Problem).code).toBe('islandAlternativeMissing')
    expect(await stateOf(documentId)).toBe('draft')
  })

  it('the scheduler’s move to published is not checked again', async () => {
    const documentId = await newShowcase([scene({ poster: await poster() })])
    const publishAt = new Date(Date.now() + 3_600_000).toISOString()
    const schedule = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ uid: SHOWCASE, documentId, to: 'scheduled', publishAt }),
    })
    expect(schedule.status).toBe(200)
    // The poster is taken away after the page was scheduled: the check was made when it was. An
    // edit through the document service would move the page back to draft (issue #57), so the row
    // of the block is written directly, as a change the editorial guard does not see.
    const draft = (await strapi.documents(SHOWCASE).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: { sections: { on: { [SCENE]: true } } },
    } as never)) as unknown as { sections: { id: number }[] }
    await strapi.db
      .query(SCENE as never)
      .update({ where: { id: draft.sections[0]!.id }, data: { poster: null } })
    const emptied = (await strapi.documents(SHOWCASE).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: { sections: { on: { [SCENE]: { populate: ['poster'] } } } },
    } as never)) as unknown as { sections: { poster: unknown }[] }
    expect(emptied.sections[0]!.poster).toBeNull()
    await strapi
      .plugin('micelio')
      .service('transitions')
      .perform({
        uid: SHOWCASE,
        documentId,
        locale: 'en',
        to: 'published',
        actor: { kind: 'system' },
      })
    expect(await stateOf(documentId)).toBe('published')
  })

  it('moving a page back to draft is not checked', async () => {
    const documentId = await newShowcase([scene({ poster: await poster() })])
    expect((await sendToReview(documentId)).status).toBe(200)
    await strapi.documents(SHOWCASE).update({
      documentId,
      locale: 'en',
      data: { sections: [scene()] } as never,
    })
    const back = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ uid: SHOWCASE, documentId, to: 'draft' }),
    })
    expect(back.status).toBe(200)
    expect(await stateOf(documentId)).toBe('draft')
  })

  describe('background Scenes', () => {
    const background = (extra: object = {}) => scene({ variant: 'background', ...extra })

    async function refused(response: Response): Promise<Problem> {
      expect(response.status).toBe(400)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      return (await response.json()) as Problem
    }

    it('two background Scenes are refused', async () => {
      const problem = await refused(await saveSections([background(), background()]))
      expect(problem).toMatchObject({
        code: 'sceneBackgroundLimit',
        status: 400,
        block: 'scene',
        count: 2,
        limit: 1,
      })
    })

    it('two Scenes that set no variant are refused: background is the default', async () => {
      const unset = () => scene({ variant: undefined })
      const problem = await refused(await saveSections([unset(), unset()]))
      expect(problem).toMatchObject({ code: 'sceneBackgroundLimit', count: 2, limit: 1 })
    })

    it('one background Scene, and any number of inline ones, are accepted', async () => {
      expect((await saveSections([background(), scene(), scene()])).status).toBe(201)
    })

    it('refuses a second background Scene on an update, and writes nothing', async () => {
      const documentId = await newShowcase([background()])
      const problem = await refused(await saveSections([background(), background()], documentId))
      expect(problem.code).toBe('sceneBackgroundLimit')
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
            sections: [background(), background()],
          } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'sceneBackgroundLimit', count: 2 } })
    })
  })
})
