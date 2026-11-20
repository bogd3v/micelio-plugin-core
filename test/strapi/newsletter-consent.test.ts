import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { cleanupStrapi, setupStrapi } from './harness'

const BULLETIN = 'api::bulletin.bulletin' as UID.ContentType

// The `bulletin` fixture holds `section.newsletter`, with the three fields `micelio-cms` stores.
describe('the consent text of a newsletter, at save', () => {
  let strapi: Core.Strapi
  let siteDocumentId: string
  let warn: MockInstance<(message: string) => void>

  beforeAll(async () => {
    strapi = await setupStrapi()
    siteDocumentId = (await strapi.db.query('plugin::micelio.site').findOne({ where: {} }))
      .documentId as string
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  beforeEach(() => {
    warn = vi.spyOn(strapi.log, 'warn') as unknown as MockInstance<(message: string) => void>
  })

  const newsletter = (extra: object = {}) => ({
    __component: 'section.newsletter',
    variant: 'inline',
    title: 'Join',
    buttonLabel: 'Subscribe',
    ...extra,
  })

  const save = (sections: unknown[]) =>
    strapi.documents(BULLETIN).create({
      data: { title: 'A bulletin', site: siteDocumentId, sections } as never,
      status: 'draft',
    })

  const warned = () =>
    warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('consentText'))

  it('saving a newsletter without consentText warns and saves', async () => {
    const created = await save([
      { __component: 'section.rich-text', body: 'First' } as never,
      newsletter(),
    ])
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toContain('api::bulletin.bulletin sections.1')
    const stored = (await strapi.documents(BULLETIN).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { sections: { populate: '*' } },
    })) as unknown as { sections: Array<Record<string, unknown>> }
    expect(stored.sections.map((block) => block.__component)).toEqual([
      'section.rich-text',
      'section.newsletter',
    ])
    expect(stored.sections[1]!.consentText ?? null).toBeNull()
  })

  it('warns for a null, an empty and a blank consentText, once for each block', async () => {
    await save([
      newsletter({ consentText: null }),
      newsletter({ consentText: '' }),
      newsletter({ consentText: '   ' }),
    ])
    expect(warned().map((line) => /sections\.(\d)/.exec(line)?.[1])).toEqual(['0', '1', '2'])
  })

  it('says nothing for a newsletter with a consentText, and keeps it with the other two fields', async () => {
    const consentText = 'I agree to receive the newsletter (Ley 1581).'
    const created = await save([
      newsletter({ consentText, successMessage: 'Thanks!', placeholder: 'you@example.org' }),
    ])
    expect(warned()).toEqual([])
    const stored = (await strapi.documents(BULLETIN).findOne({
      documentId: created.documentId,
      status: 'draft',
      populate: { sections: { populate: '*' } },
    })) as unknown as { sections: Array<Record<string, unknown>> }
    expect(stored.sections[0]).toMatchObject({
      consentText,
      successMessage: 'Thanks!',
      placeholder: 'you@example.org',
    })
  })

  it('warns on an update that writes a newsletter without consentText', async () => {
    const created = await save([newsletter({ consentText: 'Agreed' })])
    expect(warned()).toEqual([])
    await strapi.documents(BULLETIN).update({
      documentId: created.documentId,
      data: { sections: [newsletter()] } as never,
    })
    expect(warned()).toHaveLength(1)
  })
})
