import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Core } from '@strapi/strapi'
import { BLOCKS } from '../../contract/blocks'
import { syncBlockCatalogue } from '../../server/src/migrations/block-catalogue'
import { catalogueFingerprint } from '../../server/src/utils/block-catalogue'
import { cleanupStrapi, setupStrapi } from './harness'

const STORE = { type: 'plugin', name: 'micelio', key: 'block-catalogue' } as const

interface Call {
  hook: string
  payload: unknown
}

describe('the block catalogue at boot', () => {
  let strapi: Core.Strapi
  let atBoot: Call[]

  // What the fixture plugin (test/strapi/app/src/plugins/hook-recorder/) received.
  const calls = () =>
    (strapi.plugin('hook-recorder').service('recorder') as { calls: Call[] }).calls
  const catalogueCalls = () => calls().filter(({ hook }) => hook === 'blockCatalogueChanged')

  beforeAll(async () => {
    strapi = await setupStrapi()
    atBoot = [...catalogueCalls()]
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('announces every block as added on a fresh instance, once', () => {
    expect(atBoot).toEqual([
      {
        hook: 'blockCatalogueChanged',
        payload: { added: BLOCKS.map((block) => block.id).sort(), changed: [], removed: [] },
      },
    ])
  })

  describe('on a later boot', () => {
    beforeEach(() => {
      calls().length = 0
    })

    it('announces nothing when the catalogue is the same', async () => {
      expect(await syncBlockCatalogue(strapi)).toEqual({ added: [], changed: [], removed: [] })
      expect(catalogueCalls()).toEqual([])
    })

    it('announces what changed since the stored catalogue, and stores the current one', async () => {
      const current = catalogueFingerprint(BLOCKS)
      const stored: Record<string, string> = { ...current, hero: 'an older hash' }
      delete stored.gallery
      stored['retired-block'] = 'a hash'
      await strapi.store.set({ ...STORE, value: stored })

      await syncBlockCatalogue(strapi)

      expect(catalogueCalls()).toEqual([
        {
          hook: 'blockCatalogueChanged',
          payload: { added: ['gallery'], changed: ['hero'], removed: ['retired-block'] },
        },
      ])
      expect(await strapi.store.get({ ...STORE })).toEqual(current)
    })

    it('counts every block as added when what is stored is not a fingerprint', async () => {
      await strapi.store.set({ ...STORE, value: 'not a fingerprint' })

      await syncBlockCatalogue(strapi)

      expect(catalogueCalls()).toHaveLength(1)
      expect(catalogueCalls()[0].payload).toMatchObject({ added: expect.arrayContaining(['hero']) })
      expect(await strapi.store.get({ ...STORE })).toEqual(catalogueFingerprint(BLOCKS))
    })
  })
})
