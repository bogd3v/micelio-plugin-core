import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

interface Place {
  zone: string
  position: number
  block: string
}

interface Problem extends Place {
  status: number
  code: string
  detail: string
  reason: string
  groupId: string
  member: Place
  between?: Place
  groupTone?: string
  tone?: string
}

// The groups of ADR-0022, section 2, on the `page` fixture: its `section.scene` and `section.reusable`
// carry the `group` key as the catalogue describes it, and `section.rich-text` takes none.
describe('the groups of a page, at save', () => {
  let strapi: Core.Strapi
  let base: string
  let apiToken: string
  let saved = 0

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'block-groups',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  const group = (groupId: string, tone: string) => ({ group: { groupId, tone } })
  const scene = (extra: object = {}) => ({
    __component: 'section.scene',
    variant: 'inline',
    alt: 'A hypha network',
    ...extra,
  })
  const reusable = (extra: object = {}) => ({ __component: 'section.reusable', ...extra })
  const prose = { __component: 'section.rich-text', body: 'Between the bands.' }

  const save = (sections: unknown[]) => {
    saved += 1
    return fetch(`${base}/api/pages?status=draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'A page', slug: `groups-${saved}`, sections } }),
    })
  }

  async function refused(response: Response): Promise<Problem> {
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  it('refuses a groupId in two separate runs, naming the position', async () => {
    const band = group('band', 'accent')
    // A block of another group splits it, and so does a block of none.
    for (const between of [scene(group('other', 'accent')), prose]) {
      const problem = await refused(
        await save([scene(band), reusable(band), between, scene(), scene(band)])
      )
      expect(problem).toMatchObject({
        code: 'blockGroupInvalid',
        status: 400,
        reason: 'split',
        groupId: 'band',
        zone: 'sections',
        position: 4,
        block: 'scene',
        member: { zone: 'sections', position: 1, block: 'reusable' },
        between: { zone: 'sections', position: 2 },
      })
      expect(problem.detail).toContain('Not saved: the group "band" would be split.')
      expect(problem.detail).toContain('sits between sections.1 and sections.4')
    }
    expect(await strapi.db.query('api::page.page').count({ where: { title: 'A page' } })).toBe(0)
  })

  it('refuses two members of one group with different tones', async () => {
    const problem = await refused(
      await save([
        scene(group('band', 'raised')),
        reusable(group('band', 'raised')),
        scene(group('band', 'accent')),
      ])
    )
    expect(problem).toMatchObject({
      code: 'blockGroupInvalid',
      reason: 'tone',
      groupId: 'band',
      zone: 'sections',
      position: 2,
      block: 'scene',
      member: { zone: 'sections', position: 0, block: 'scene' },
      groupTone: 'raised',
      tone: 'accent',
    })
    expect(problem.detail).toContain('sections.2')
    expect(problem.detail).toContain('sections.0')
  })

  it('accepts a group of one and a member that keeps a tone of its own', async () => {
    const response = await save([
      scene(group('solo', 'accent')),
      // Its own `tone` option differs from the group's: ignored, not refused.
      scene({ tone: 'raised', ...group('band', 'default') }),
      reusable(group('band', 'default')),
      scene({ group: null }),
      scene(),
    ])
    expect(response.status).toBe(201)
    const { data } = (await response.json()) as {
      data: { documentId: string }
    }
    const stored = (await strapi.documents('api::page.page').findOne({
      documentId: data.documentId,
      status: 'draft',
      populate: { sections: { on: { 'section.scene': { populate: ['group'] } } } },
    })) as unknown as {
      sections: Array<{ tone?: string; group?: { groupId: string; tone: string } }>
    }
    expect(stored.sections[1]).toMatchObject({
      tone: 'raised',
      group: { groupId: 'band', tone: 'default' },
    })
  })
})
