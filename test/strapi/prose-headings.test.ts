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
  level: number
  heading: string
  line: number
  previousLevel?: number
}

// The `showcase` fixture is a page (`sections`) and the `post` fixture an article (`blocks`); both
// hold `shared.rich-text`, the component of the `prose` block, which the catalogue allows in both
// zones. `section.rich-text` is in `showcase` too, and is not checked.
describe('the heading levels of a prose body, at save', () => {
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
        name: 'prose-headings',
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

  const prose = (body: string) => ({ __component: 'shared.rich-text', body })
  const quote = { __component: 'shared.quote', body: 'A quote' }

  const savePage = (sections: unknown[], documentId?: string) =>
    fetch(`${base}/api/showcases${documentId ? `/${documentId}` : ''}?status=draft`, {
      method: documentId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'A page', sections } }),
    })

  const saveArticle = (blocks: unknown[]) =>
    fetch(`${base}/api/posts?status=draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'An article', blocks } }),
    })

  async function refused(response: Response): Promise<Problem> {
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    const problem = (await response.json()) as Problem
    expect(problem).toMatchObject({ code: 'proseHeadingInvalid', status: 400, block: 'prose' })
    return problem
  }

  it('refuses a body that opens below h2 or skips a level, naming the position', async () => {
    const below = await refused(await savePage([quote, prose('Intro.\n\n### Deep\n\nText.')]))
    expect(below).toMatchObject({
      reason: 'opensBelowH2',
      zone: 'sections',
      position: 1,
      level: 3,
      heading: 'Deep',
      line: 3,
    })
    expect(below.detail).toContain('sections.1')
    expect(below.detail).toContain('"Deep"')

    const skip = await refused(
      await savePage([prose('## One\n\ntext\n\n#### Three levels down\n\ntext')])
    )
    expect(skip).toMatchObject({
      reason: 'skipsLevel',
      zone: 'sections',
      position: 0,
      level: 4,
      previousLevel: 2,
      heading: 'Three levels down',
      line: 5,
    })
    expect(skip.detail).toContain('sections.0')
    expect(skip.detail).toContain('"Three levels down"')

    const article = await refused(await saveArticle([prose('## One\n\n### Two\n\n##### Five\n')]))
    expect(article).toMatchObject({ zone: 'blocks', position: 0, reason: 'skipsLevel', level: 5 })
  })

  it('refuses a body that opens with h1, naming the position', async () => {
    for (const body of ['# Title\n\n## Next', 'Title\n=====\n\n## Next']) {
      const problem = await refused(await savePage([prose(body)]))
      expect(problem).toMatchObject({
        reason: 'opensWithH1',
        zone: 'sections',
        position: 0,
        level: 1,
        heading: 'Title',
      })
      expect(problem.detail).toContain('sections.0')
      expect(problem.detail).toContain('"Title"')
    }
    const article = await refused(await saveArticle([quote, prose('# Title')]))
    expect(article).toMatchObject({ zone: 'blocks', position: 1, reason: 'opensWithH1' })
  })

  it('refuses an h1 after the opening heading, naming the position', async () => {
    const problem = await refused(await savePage([prose('## One\n\ntext\n\n# Again\n\ntext')]))
    expect(problem).toMatchObject({
      reason: 'h1',
      zone: 'sections',
      position: 0,
      level: 1,
      heading: 'Again',
      line: 5,
    })
    expect(problem.detail).toContain('sections.0')
    expect(problem.detail).toContain('"Again"')
  })

  it('refuses it on an update, and writes nothing', async () => {
    const created = await savePage([prose('## One')])
    const documentId = ((await created.json()) as { data: { documentId: string } }).data.documentId
    await refused(await savePage([prose('## One'), prose('# Two')], documentId))
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
        data: { title: 'Two', site: siteDocumentId, sections: [prose('### Deep')] } as never,
      })
    ).rejects.toMatchObject({ details: { code: 'proseHeadingInvalid', reason: 'opensBelowH2' } })
  })

  it('accepts prose in a page and in an article', async () => {
    const body = [
      'Some text before the first heading.',
      '',
      '## One',
      '',
      '### One A',
      '',
      '#### One A i',
      '',
      '## Two',
      '',
      '```md',
      '# a heading inside a fence',
      '#### and another',
      '```',
      '',
      '### Two A',
      '',
      'Not a heading: #hashtag, and a rule below',
      '',
      '---',
    ].join('\n')
    expect((await savePage([prose(body), prose('No headings at all.')])).status).toBe(201)
    expect((await saveArticle([quote, prose(body)])).status).toBe(201)
    // `section.rich-text` is not a block of the catalogue any more and is not checked.
    expect(
      (await savePage([{ __component: 'section.rich-text', body: '# Free\n\n#### Form' }])).status
    ).toBe(201)
  })
})
