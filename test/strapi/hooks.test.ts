import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import type { EditorialState } from '../../server/src/constants/editorial'
import { SITE_UID } from '../../server/src/constants/site'
import type { Actor } from '../../server/src/editorial/machine'
import type { TransitionsService } from '../../server/src/services/transitions'
import type { HookName, MicelioHooks } from '../../server/src/types/hooks'
import { cleanupStrapi, setupStrapi } from './harness'

// A fixture type made with `withSiteScope` and `withEditorial` (test/strapi/app/src/api/article/).
const ARTICLE_UID = 'api::article.article' as UID.ContentType

interface Call {
  hook: HookName
  payload: Record<string, unknown>
}

describe('the hooks API', () => {
  let strapi: Core.Strapi
  let site: string
  let AUTHOR: Actor
  let EDITOR: Actor

  const articles = () => strapi.documents(ARTICLE_UID)
  const transitions = () => strapi.plugin('micelio').service('transitions') as TransitionsService
  const hooks = () => (strapi.plugin('micelio') as unknown as { hooks: MicelioHooks }).hooks
  // What the fixture plugin (test/strapi/app/src/plugins/hook-recorder/) received.
  const calls = () =>
    (strapi.plugin('hook-recorder').service('recorder') as { calls: Call[] }).calls

  async function draftArticle(): Promise<string> {
    const { documentId } = await articles().create({ data: { title: 'hooked', site } } as never)
    return documentId
  }

  function move(documentId: string, to: EditorialState, actor: Actor, publishAt?: Date) {
    return transitions().perform({ uid: ARTICLE_UID, documentId, to, actor, publishAt })
  }

  // An admin user with one role: `reviewedBy` and `publishedBy` point at real users.
  async function adminUser(role: string): Promise<Actor> {
    const roleRow = (await strapi.db.query('admin::role').findOne({ where: { code: role } })) as {
      id: number
    }
    const user = (await strapi.service('admin::user').create({
      email: `${role}@example.com`,
      firstname: role,
      lastname: 'Test',
      roles: [roleRow.id],
      isActive: true,
    })) as { id: number }
    return { kind: 'user', id: user.id, roles: [role] }
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
    AUTHOR = await adminUser('strapi-author')
    EDITOR = await adminUser('strapi-editor')
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('is strapi.plugin("micelio").hooks, the same object as the hooks service', () => {
    expect(hooks()).toBe(strapi.plugin('micelio').service('hooks'))
  })

  it('reaches a plugin registered before the core, from the first boot step on', () => {
    // The default site is created in the core's bootstrap; the fixture subscribed in `register`.
    expect(calls().filter(({ hook }) => hook === 'siteCreated')).toEqual([
      { hook: 'siteCreated', payload: { site, slug: 'default', isDefault: true } },
    ])
  })

  describe('a fixture plugin', () => {
    beforeEach(() => {
      calls().length = 0
    })

    it('receives the documented payloads for every transition of the editorial workflow', async () => {
      const documentId = await draftArticle()
      const inAnHour = new Date(Date.now() + 60 * 60 * 1000)
      await move(documentId, 'in_review', AUTHOR)
      await move(documentId, 'draft', AUTHOR)
      await move(documentId, 'in_review', AUTHOR)
      await move(documentId, 'published', EDITOR)
      await move(documentId, 'draft', EDITOR)
      await move(documentId, 'scheduled', EDITOR, inAnHour)
      await move(documentId, 'draft', EDITOR)
      await move(documentId, 'scheduled', EDITOR, inAnHour)
      // The scheduler's own path: `scheduled -> published` as the plugin itself.
      expect(await transitions().publishDue(new Date(inAnHour.getTime() + 1000))).toBe(1)

      const placeholders = new Map<unknown, string>([
        [documentId, '<documentId>'],
        [site, '<site>'],
        [inAnHour.toISOString(), '<publishAt>'],
      ])
      const users = new Map<unknown, string>([
        [(AUTHOR as { id: number }).id, '<author>'],
        [(EDITOR as { id: number }).id, '<editor>'],
      ])
      const recorded = calls().map(({ hook, payload }) => {
        const { actor, ...rest } = payload as { actor: { kind: string; id?: number } }
        return {
          hook,
          payload: {
            ...Object.fromEntries(
              Object.entries(rest).map(([key, value]) => [key, placeholders.get(value) ?? value])
            ),
            actor: actor.kind === 'user' ? { kind: 'user', id: users.get(actor.id) } : actor,
          },
        }
      })
      expect(recorded).toMatchSnapshot()
    })

    it('is told when a site is created', async () => {
      const created = await strapi.documents(SITE_UID as UID.ContentType).create({
        data: { name: 'Second', slug: 'second', hosts: [], isDefault: false, modules: {} },
      } as never)
      expect(calls()).toEqual([
        {
          hook: 'siteCreated',
          payload: { site: created.documentId, slug: 'second', isDefault: false },
        },
      ])
    })
  })

  describe('the ordering rules', () => {
    it('runs handlers in the order they were registered, each awaited', async () => {
      const order: string[] = []
      const off = [
        hooks().on('afterTransition', async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          order.push('first')
        }),
        hooks().on('afterTransition', () => {
          order.push('second')
        }),
      ]
      try {
        await move(await draftArticle(), 'in_review', AUTHOR)
      } finally {
        for (const remove of off) remove()
      }
      expect(order).toEqual(['first', 'second'])
    })

    it('lets a beforeTransition handler refuse the transition, and writes nothing', async () => {
      const documentId = await draftArticle()
      await move(documentId, 'in_review', AUTHOR)
      calls().length = 0
      const off = hooks().on('beforeTransition', ({ to }) => {
        if (to === 'published') throw new Error('The legal review is pending')
      })
      try {
        await expect(move(documentId, 'published', EDITOR)).rejects.toMatchObject({
          status: 409,
          code: 'editorialTransitionRefused',
          message: 'The legal review is pending',
        })
      } finally {
        off()
      }
      expect(await stateOf(documentId)).toEqual({ state: 'in_review', published: false })
      // The fixture registered before the refusing handler, so it saw the attempt and nothing else.
      expect(calls().map(({ hook }) => hook)).toEqual(['beforeTransition'])
    })

    it('keeps the transition and the other handlers when an after handler throws', async () => {
      const seen: unknown[] = []
      const off = [
        hooks().on('afterPublish', () => {
          throw new Error('the outbox is down')
        }),
        hooks().on('afterPublish', (payload) => {
          seen.push(Object.isFrozen(payload))
        }),
      ]
      const documentId = await draftArticle()
      try {
        await move(documentId, 'in_review', AUTHOR)
        await move(documentId, 'published', EDITOR)
      } finally {
        for (const remove of off) remove()
      }
      expect(seen).toEqual([true])
      expect(await stateOf(documentId)).toEqual({ state: 'published', published: true })
    })

    it('stops calling a handler once it is removed', async () => {
      let count = 0
      const off = hooks().on('afterTransition', () => {
        count += 1
      })
      const documentId = await draftArticle()
      await move(documentId, 'in_review', AUTHOR)
      off()
      await move(documentId, 'draft', AUTHOR)
      expect(count).toBe(1)
    })

    it('refuses a hook that does not exist', () => {
      expect(() => hooks().on('afterSave' as HookName, () => undefined)).toThrow(TypeError)
    })
  })
})
