import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

const LANDING = 'api::landing.landing'

interface Problem {
  type: string
  title: string
  status: number
  detail: string
  code: string
  block?: string
  option?: string
  allowed?: string[]
}

// The `landing` fixture holds `section.feature-grid` (columns, density, and a `width` its block does not
// expose), `section.logo-cloud` (columns), and `shared.media`, the `media` article block (width, ratio).
describe('the options of the blocks, at save', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    token = (
      (await strapi.service('admin::api-token').create({
        name: 'block-options',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  function send(method: string, path: string, sections: unknown[]): Promise<Response> {
    // `landing` is editorial: the content API saves a draft only when it is asked to.
    return fetch(`${base}/api/landings${path}?status=draft`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { title: 'A page', sections } }),
    })
  }

  const create = (sections: unknown[]) => send('POST', '', sections)

  async function refused(response: Response): Promise<Problem> {
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  it('accepts columns: 3', async () => {
    const response = await create([{ __component: 'section.feature-grid', columns: 3 }])
    expect(response.status).toBe(201)
    const { data } = (await response.json()) as { data: { documentId: string } }
    const stored = await strapi.documents(LANDING).findOne({
      documentId: data.documentId,
      populate: { sections: true },
    } as never)
    expect((stored as unknown as { sections: { columns: string }[] }).sections[0].columns).toBe('3')
  })

  it('refuses columns: 6 with blockOptionInvalid, naming the block, the option and the values', async () => {
    const problem = await refused(
      await create([{ __component: 'section.feature-grid', columns: 6 }])
    )
    expect(problem).toMatchObject({
      code: 'blockOptionInvalid',
      status: 400,
      title: 'Bad Request',
      block: 'feature-grid',
      option: 'columns',
      allowed: ['2', '3', '4'],
    })
    expect(problem.detail).toContain('feature-grid')
    expect(problem.detail).toContain('2, 3, 4')
  })

  it('accepts columns: 6 on a logo cloud, the only block that takes it', async () => {
    expect((await create([{ __component: 'section.logo-cloud', columns: 6 }])).status).toBe(201)
  })

  it('writes nothing when it refuses', async () => {
    const before = await strapi.documents(LANDING).count({})
    await create([{ __component: 'section.feature-grid', columns: 6 }])
    expect(await strapi.documents(LANDING).count({})).toBe(before)
  })

  it('refuses an option the block does not expose', async () => {
    const problem = await refused(
      await create([{ __component: 'section.feature-grid', width: 'wide' }])
    )
    expect(problem).toMatchObject({
      code: 'blockOptionInvalid',
      block: 'feature-grid',
      option: 'width',
    })
    expect(problem.allowed).toEqual([])
    expect(problem.detail).toContain('does not expose')
  })

  it('refuses width: full on an article block', async () => {
    const problem = await refused(await create([{ __component: 'shared.media', width: 'full' }]))
    expect(problem).toMatchObject({ code: 'blockOptionInvalid', block: 'media', option: 'width' })
    expect(problem.allowed).toEqual(['prose', 'wide'])
  })

  it('refuses a bad option on update, and leaves the stored page as it was', async () => {
    const created = (await (
      await create([{ __component: 'section.feature-grid', columns: 2 }])
    ).json()) as { data: { documentId: string } }
    const problem = await refused(
      await send('PUT', `/${created.data.documentId}`, [
        { __component: 'section.feature-grid', columns: 5 },
      ])
    )
    expect(problem.code).toBe('blockOptionInvalid')
    const stored = (await strapi.documents(LANDING).findOne({
      documentId: created.data.documentId,
      populate: { sections: true },
    } as never)) as unknown as { sections: { columns: string }[] }
    expect(stored.sections[0].columns).toBe('2')
  })

  it('refuses it through the document service too, as a validation error', async () => {
    const site = (await strapi.documents('plugin::micelio.site').findFirst({}))!.documentId
    await expect(
      strapi.documents(LANDING).create({
        data: { title: 'x', site, sections: [{ __component: 'section.feature-grid', columns: 6 }] },
      } as never)
    ).rejects.toMatchObject({ name: 'ValidationError', details: { code: 'blockOptionInvalid' } })
  })

  it('refuses a bad option on clone, the Content Manager duplicate that carries data', async () => {
    const site = (await strapi.documents('plugin::micelio.site').findFirst({}))!.documentId
    const source = await strapi.documents(LANDING).create({
      data: { title: 'x', site, sections: [{ __component: 'section.feature-grid', columns: 2 }] },
    } as never)
    await expect(
      strapi.documents(LANDING).clone({
        documentId: source.documentId,
        data: { sections: [{ __component: 'section.feature-grid', columns: 6 }] },
      } as never)
    ).rejects.toMatchObject({ name: 'ValidationError', details: { code: 'blockOptionInvalid' } })
  })
})
