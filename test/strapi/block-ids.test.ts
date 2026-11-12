import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

const LANDING = 'api::landing.landing'

interface Item {
  itemId?: string | null
  title: string
}
interface Block {
  __component: string
  blockId?: string | null
  title?: string
  items?: Item[]
}

const GRID = 'section.feature-grid'
const RICH = 'section.rich-text'
const grid = (title: string, items: Item[] = []): Block => ({ __component: GRID, title, items })

// `landing` holds `section.feature-grid` (its items are `section.feature-item`), `section.rich-text`
// and the other blocks of the fixture; each declares `blockId`, and the feature item `itemId`.
describe('the ids of blocks and items, at save', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    token = (
      (await strapi.service('admin::api-token').create({
        name: 'block-ids',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  async function save(method: string, path: string, sections: Block[]): Promise<string> {
    // `landing` is editorial: the content API saves a draft only when it is asked to.
    const response = await fetch(`${base}/api/landings${path}?status=draft`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { title: 'A page', sections } }),
    })
    expect(response.status).toBeLessThan(300)
    return ((await response.json()) as { data: { documentId: string } }).data.documentId
  }

  async function stored(documentId: string): Promise<Block[]> {
    const document = (await strapi.documents(LANDING).findOne({
      documentId,
      status: 'draft',
      populate: {
        sections: { on: { [GRID]: { populate: ['items'] }, [RICH]: { populate: '*' } } },
      },
    } as never)) as unknown as { sections: Block[] }
    return document.sections
  }

  const ids = (blocks: Block[]) => blocks.map((block) => block.blockId)

  it('a block saved without a blockId gets one unique in its zone', async () => {
    const sections: Block[] = [
      grid('One'),
      { __component: RICH, blockId: 'taken' } as Block,
      grid('Two'),
      // The same id written twice in one zone: the second gets another.
      { __component: RICH, blockId: 'taken' } as Block,
    ]
    const blocks = await stored(await save('POST', '', sections))
    expect(blocks).toHaveLength(4)
    for (const block of blocks) expect(block.blockId).toEqual(expect.any(String))
    expect(new Set(ids(blocks)).size).toBe(4)
    expect(blocks[1].blockId).toBe('taken')
  })

  it('an item saved without an itemId gets one unique in its parent block', async () => {
    const sections = [
      grid('One', [
        { title: 'a' },
        { title: 'b', itemId: 'taken' },
        { title: 'c', itemId: 'taken' },
      ]),
      grid('Two', [{ title: 'd' }]),
    ]
    const blocks = await stored(await save('POST', '', sections))
    const first = blocks[0].items ?? []
    expect(first).toHaveLength(3)
    for (const item of first) expect(item.itemId).toEqual(expect.any(String))
    expect(new Set(first.map((item) => item.itemId)).size).toBe(3)
    expect(first[1].itemId).toBe('taken')
    expect(blocks[1].items?.[0].itemId).toEqual(expect.any(String))
  })

  it('an update that changes a stored blockId or itemId keeps the stored one', async () => {
    const documentId = await save('POST', '', [
      grid('One', [{ title: 'a' }, { title: 'b' }]),
      { __component: RICH },
    ])
    const before = await stored(documentId)
    const itemIds = (before[0].items ?? []).map((item) => item.itemId)

    // The edit writes other ids at the same places, and changes a title.
    await save(
      'PUT',
      `/${documentId}`,
      [
        grid('One, edited', [
          { title: 'a', itemId: 'forged-1' },
          { title: 'b', itemId: 'forged-2' },
        ]),
        { __component: RICH, blockId: 'forged-3' },
      ].map((block, index) => (index === 0 ? { ...block, blockId: 'forged-0' } : block))
    )
    const after = await stored(documentId)
    expect(after[0].title).toBe('One, edited')
    expect(ids(after)).toEqual(ids(before))
    expect((after[0].items ?? []).map((item) => item.itemId)).toEqual(itemIds)

    // A reorder moves each id with its block.
    const [first, second] = after
    await save('PUT', `/${documentId}`, [
      { __component: RICH, blockId: second.blockId },
      {
        ...grid(
          'One, edited',
          (first.items ?? []).map(({ title, itemId }) => ({ title, itemId }))
        ),
        blockId: first.blockId,
      },
    ])
    const reordered = await stored(documentId)
    expect(ids(reordered)).toEqual([second.blockId, first.blockId])
    expect((reordered[1].items ?? []).map((item) => item.itemId)).toEqual(itemIds)

    // A save that leaves every id out keeps the stored ones.
    await save('PUT', `/${documentId}`, [
      { __component: RICH },
      grid('One, edited', [{ title: 'a' }, { title: 'b' }]),
    ])
    const bare = await stored(documentId)
    expect(ids(bare)).toEqual(ids(reordered))
    expect((bare[1].items ?? []).map((item) => item.itemId)).toEqual(itemIds)
  })
})
