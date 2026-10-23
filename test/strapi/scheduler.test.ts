import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import config from '../../server/src/config'
import { SITE_UID } from '../../server/src/constants/site'
import type { Actor } from '../../server/src/editorial/machine'
import { registerScheduler, SCHEDULER_JOB } from '../../server/src/editorial/scheduler'
import type { TransitionsService } from '../../server/src/services/transitions'
import { cleanupStrapi, setupStrapi } from './harness'

// A fixture type made with `withSiteScope` and `withEditorial` (test/strapi/app/src/api/article/).
const ARTICLE_UID = 'api::article.article' as UID.ContentType
const EDITOR: Actor = { kind: 'user', id: 0, roles: ['strapi-editor'] }

describe('the scheduler', () => {
  let strapi: Core.Strapi
  let site: string

  const articles = () => strapi.documents(ARTICLE_UID)
  // Through the built plugin, as a host calls it: the guard recognises its own transitions.
  const transitions = () => strapi.plugin('micelio').service('transitions') as TransitionsService

  async function scheduledArticle(publishAt: Date): Promise<string> {
    const { documentId } = await articles().create({ data: { title: 'scheduled', site } } as never)
    await transitions().perform({
      uid: ARTICLE_UID,
      documentId,
      to: 'scheduled',
      publishAt,
      actor: EDITOR,
    })
    return documentId
  }

  async function stateOf(documentId: string): Promise<{ state?: string; published: boolean }> {
    const draft = (await articles().findOne({
      documentId,
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial?: { state?: string } } | null
    const published = await articles().findOne({ documentId, status: 'published' } as never)
    return { state: draft?.editorial?.state, published: published !== null }
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('runs every minute unless the host says otherwise', () => {
    expect(config.default.scheduledPublishRule).toBe('* * * * *')
  })

  it('publishes a scheduled entry once its publishAt has passed', async () => {
    const documentId = await scheduledArticle(new Date(Date.now() + 1000))
    expect(await stateOf(documentId)).toEqual({ state: 'scheduled', published: false })
    // The job runs every second in the test app; a minute is the bound the issue sets.
    await vi.waitFor(
      async () =>
        expect(await stateOf(documentId)).toEqual({ state: 'published', published: true }),
      { timeout: 60_000, interval: 250 }
    )
    const published = (await articles().findOne({
      documentId,
      status: 'published',
      populate: { editorial: { populate: ['publishedBy'] } },
    } as never)) as unknown as { editorial: { publishedBy: unknown } }
    expect(published.editorial.publishedBy).toBeNull()
  })

  it('leaves an entry whose publishAt has not passed', async () => {
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000)
    const documentId = await scheduledArticle(inAnHour)
    expect(await transitions().publishDue()).toBe(0)
    expect(await stateOf(documentId)).toEqual({ state: 'scheduled', published: false })

    expect(await transitions().publishDue(new Date(inAnHour.getTime() + 1000))).toBe(1)
    expect(await stateOf(documentId)).toEqual({ state: 'published', published: true })
  })

  it('validates its rule', () => {
    expect(() => config.validator({ scheduledPublishRule: '' })).toThrow(/cron rule or false/)
    expect(() => config.validator({ scheduledPublishRule: false })).not.toThrow()
  })

  it('registers no job when the rule is false', () => {
    const jobNames = () =>
      (strapi.cron as unknown as { jobs: { name: string }[] }).jobs.map((job) => job.name)
    expect(jobNames()).toContain(SCHEDULER_JOB)
    const previous = strapi.config.get('plugin::micelio.scheduledPublishRule')
    strapi.cron.remove(SCHEDULER_JOB)
    strapi.config.set('plugin::micelio.scheduledPublishRule', false)
    try {
      expect(registerScheduler(strapi)).toBe(false)
      expect(jobNames()).not.toContain(SCHEDULER_JOB)
    } finally {
      strapi.config.set('plugin::micelio.scheduledPublishRule', previous)
    }
  })
})
