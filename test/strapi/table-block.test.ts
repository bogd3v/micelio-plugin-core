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
  row: number
  cells: number
  columns: number
}

// The `snippet` fixture is a page whose zone holds `shared.table`, with the fields micelio-cms
// stores since bogd3v/micelio-cms#544.
describe('the table block, at save', () => {
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
        name: 'table-block',
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

  const COLUMNS = [{ label: 'Plan' }, { label: 'Price', align: 'center' }]
  const table = (rows: unknown[], extra: object = {}) => ({
    __component: 'shared.table',
    caption: 'Plans',
    columns: COLUMNS,
    rows,
    ...extra,
  })

  const save = (blocks: unknown[], documentId?: string) =>
    fetch(`${base}/api/snippets${documentId ? `/${documentId}` : ''}?status=draft`, {
      method: documentId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'A snippet', blocks } }),
    })

  const count = () => strapi.documents(SNIPPET).count({ status: 'draft' })

  it('refuses a row whose cells do not match the columns, naming the row', async () => {
    const before = await count()
    for (const [rows, row, cells] of [
      [[{ cells: ['Basic', '1'] }, { cells: ['Pro'] }], 1, 1],
      [[{ cells: ['Basic', '1', '2'] }], 0, 3],
      [[{ cells: ['Basic', '1'] }, { cells: ['Pro', '2'] }, { cells: [] }], 2, 0],
      [[{ cells: null }], 0, 0],
      [[{}], 0, 0],
      [[{ cells: 'Basic' }], 0, 0],
    ] as const) {
      const response = await save([{ __component: 'shared.code' }, table([...rows])])
      expect(response.status, JSON.stringify(rows)).toBe(400)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      const problem = (await response.json()) as Problem
      expect(problem).toMatchObject({
        status: 400,
        code: 'tableCellsInvalid',
        zone: 'blocks',
        position: 1,
        block: 'table',
        row,
        cells,
        columns: 2,
      })
      expect(problem.detail).toContain('blocks.1')
      expect(problem.detail).toContain(`row ${row}`)
    }
    expect(await count()).toBe(before)
  })

  it('refuses an update that adds a short row and keeps the stored page', async () => {
    const created = await strapi.documents(SNIPPET).create({
      data: {
        title: 'A snippet',
        site: siteDocumentId,
        blocks: [table([{ cells: ['Basic', '1'] }])],
      } as never,
      status: 'draft',
    })
    const response = await save(
      [table([{ cells: ['Basic', '1'] }, { cells: ['Pro'] }])],
      created.documentId
    )
    expect(response.status).toBe(400)
    expect(((await response.json()) as Problem).code).toBe('tableCellsInvalid')
    const stored = (await strapi.documents(SNIPPET).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { blocks: { populate: '*' } },
    })) as unknown as { blocks: Array<{ rows: Array<{ cells: string[] }> }> }
    expect(stored.blocks[0]!.rows.map((row) => row.cells)).toEqual([['Basic', '1']])
  })

  it('saves rows of one cell per column, a table with no rows and an empty block', async () => {
    expect((await save([table([{ cells: ['Basic', '1'] }, { cells: ['', ''] }])])).status).toBe(201)
    expect((await save([table([])])).status).toBe(201)
    expect((await save([table([], { columns: [] })])).status).toBe(201)
    expect((await save([{ __component: 'shared.table' }])).status).toBe(201)
    // No columns and rows of no cells agree.
    expect((await save([table([{ cells: [] }], { columns: undefined })])).status).toBe(201)
  })

  it('stores the fields of the block, its columns and its rows as written', async () => {
    const created = await strapi.documents(SNIPPET).create({
      data: {
        title: 'A snippet',
        site: siteDocumentId,
        blocks: [table([{ cells: ['Basic', '1'] }], { headerColumn: true })],
      } as never,
      status: 'draft',
    })
    const stored = (await strapi.documents(SNIPPET).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { blocks: { populate: '*' } },
    })) as unknown as { blocks: Array<Record<string, unknown>> }
    expect(stored.blocks[0]).toMatchObject({
      caption: 'Plans',
      headerColumn: true,
      columns: [
        { label: 'Plan', align: null },
        { label: 'Price', align: 'center' },
      ],
      rows: [{ cells: ['Basic', '1'] }],
    })
  })
})
