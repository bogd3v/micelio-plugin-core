import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

const SNIPPET = 'api::snippet.snippet' as UID.ContentType

interface Problem {
  status: number
  code: string
  detail: string
  zone: string
  position: number
  block: string
  line: unknown
  lines: number
}

// The `snippet` fixture is a page whose zone holds `shared.code`, with the fields micelio-cms stores
// since bogd3v/micelio-cms#529.
describe('the code block, at save', () => {
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
        name: 'code-block',
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

  const CODE = 'const a = 1\nconst b = 2\nconst c = 3\n'
  const block = (extra: object = {}) => ({ __component: 'shared.code', code: CODE, ...extra })

  const save = (blocks: unknown[], documentId?: string) =>
    fetch(`${base}/api/snippets${documentId ? `/${documentId}` : ''}?status=draft`, {
      method: documentId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'A snippet', blocks } }),
    })

  const count = () => strapi.documents(SNIPPET).count({ status: 'draft' })

  it('refuses a highlighted line outside the code', async () => {
    const before = await count()
    for (const [highlight, line] of [
      [[2, 4], 4],
      [[0], 0],
      [[-1], -1],
      [[1.5], 1.5],
      [['2'], '2'],
      [[1, 2, 3, 99], 99],
      [2, 2],
    ] as const) {
      const response = await save([block(), block({ highlight })])
      expect(response.status, `highlight ${JSON.stringify(highlight)}`).toBe(400)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      const problem = (await response.json()) as Problem
      expect(problem).toMatchObject({
        status: 400,
        code: 'codeHighlightInvalid',
        zone: 'blocks',
        position: 1,
        block: 'code',
        line,
        lines: 3,
      })
      expect(problem.detail).toContain('blocks.1')
    }
    expect(await count()).toBe(before)
  })

  it('refuses a highlighted line when the code is empty or absent', async () => {
    for (const code of ['', null, undefined]) {
      const response = await save([{ __component: 'shared.code', code, highlight: [1] }])
      expect(response.status, `code ${JSON.stringify(code)}`).toBe(400)
      expect(((await response.json()) as Problem).lines).toBe(0)
    }
  })

  it('refuses an update that sets a bad line and keeps the stored page', async () => {
    const created = await strapi.documents(SNIPPET).create({
      data: {
        title: 'A snippet',
        site: siteDocumentId,
        blocks: [block({ highlight: [2, 3] })],
      } as never,
      status: 'draft',
    })
    const response = await save([block({ highlight: [4] })], created.documentId)
    expect(response.status).toBe(400)
    expect(((await response.json()) as Problem).code).toBe('codeHighlightInvalid')
    const stored = (await strapi.documents(SNIPPET).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { blocks: { populate: '*' } },
    })) as unknown as { blocks: Array<{ highlight: number[] }> }
    expect(stored.blocks[0]!.highlight).toEqual([2, 3])
  })

  it('saves lines inside the code, in any order, and a block with none', async () => {
    for (const highlight of [[1], [3, 1, 2], [1, 1], [], null]) {
      expect((await save([block({ highlight })])).status, JSON.stringify(highlight)).toBe(201)
    }
    expect((await save([block()])).status).toBe(201)
    expect((await save([{ __component: 'shared.code' }])).status).toBe(201)
    // The text has three lines whether or not a line break ends it.
    expect((await save([block({ code: 'a\nb\nc', highlight: [3] })])).status).toBe(201)
    expect((await save([block({ code: 'a\r\nb\r\nc\r\n', highlight: [3] })])).status).toBe(201)
  })

  it('stores the fields of the block and the list as written', async () => {
    const created = await strapi.documents(SNIPPET).create({
      data: {
        title: 'A snippet',
        site: siteDocumentId,
        blocks: [
          block({ language: 'typescript', filename: 'a.ts', caption: 'A', highlight: [3, 1] }),
        ],
      } as never,
      status: 'draft',
    })
    const stored = (await strapi.documents(SNIPPET).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { blocks: { populate: '*' } },
    })) as unknown as { blocks: Array<Record<string, unknown>> }
    expect(stored.blocks[0]).toMatchObject({
      language: 'typescript',
      filename: 'a.ts',
      caption: 'A',
      highlight: [3, 1],
    })
  })
})
