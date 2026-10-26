import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { renameLegacyUids } from '../../server/src/migrations/rename-legacy-uids'
import { SITE_UID } from '../../server/src/constants/site'
import { CATEGORY_UID, TAG_UID } from '../../server/src/constants/taxonomy'
import { cleanupStrapi, setupStrapi } from './harness'

// What `micelio-cms` 0.4 stored under the UIDs of its host types, before 0.5 moved them into a
// plugin: `api::category.category`. The core renames them on boot, as 0.5 did.
const LEGACY_CATEGORY = 'api::category.category'
const LEGACY_TAG = 'api::tag.tag'
const LAYOUT_PREFIX = 'plugin_content_manager_configuration_content_types::'

interface Row {
  id: number
  [key: string]: unknown
}

/** The rows that carry a UID, as plain data, to compare one boot with the next. */
async function snapshot(strapi: Core.Strapi): Promise<Record<string, unknown>> {
  const query = (uid: string) => strapi.db.query(uid as UID.ContentType)
  const rows = async (uid: string, where = {}) =>
    ((await query(uid).findMany({ where, orderBy: { id: 'asc' } })) as Row[]).map(
      ({ updatedAt: _updatedAt, ...row }) => row
    )
  return {
    publicGrants: (
      await query('plugin::users-permissions.permission').findMany({
        where: { action: { $startsWith: 'plugin::micelio.' } },
        orderBy: { id: 'asc' },
        select: ['id', 'action'],
      })
    ).length,
    tokenGrants: await rows('admin::api-token-permission', {
      action: { $in: ['plugin::micelio.category.find', 'plugin::micelio.tag.find'] },
    }),
    adminSubjects: await rows('admin::permission', {
      subject: { $in: [CATEGORY_UID, TAG_UID] },
    }),
    layouts: await rows('strapi::core-store', { key: { $startsWith: LAYOUT_PREFIX } }),
    categories: await rows(CATEGORY_UID),
    tags: await rows(TAG_UID),
  }
}

// Every test boots Strapi, and a boot under the load of the other suites passes the 5 s default.
describe(
  'a database with the grants of micelio-cms 0.4 (the UIDs before 0.5), with the core installed',
  { timeout: 60_000 },
  () => {
    // The public role and its grants are users-permissions', which micelio-cms installs.
    process.env.MICELIO_TEST_USERS_PERMISSIONS = 'true'
    process.env.JWT_SECRET = 'test-jwt-secret'

    afterAll(async () => {
      await cleanupStrapi()
      delete process.env.MICELIO_TEST_USERS_PERMISSIONS
      delete process.env.JWT_SECRET
    })

    let before: Record<string, unknown>

    it('starts on a fresh database, then gets what micelio-cms 0.4 wrote under the old UIDs', async () => {
      const strapi = await setupStrapi()
      const query = (uid: string) => strapi.db.query(uid as UID.ContentType)

      const publicRole = (await query('plugin::users-permissions.role').findOne({
        where: { type: 'public' },
      })) as Row
      const token = (await query('admin::api-token').create({
        data: {
          name: 'legacy token',
          type: 'custom',
          accessKey: 'not-a-real-key-hash',
          lifespan: null,
          expiresAt: null,
        },
      })) as Row
      const editor = (await query('admin::role').create({
        data: { name: 'Legacy editor', code: 'legacy-editor' },
      })) as Row

      for (const legacy of [LEGACY_CATEGORY, LEGACY_TAG]) {
        await query('plugin::users-permissions.permission').create({
          data: { action: `${legacy}.find`, role: publicRole.id },
        })
        await query('admin::api-token-permission').create({
          data: { action: `${legacy}.find`, token: token.id },
        })
        await query('admin::permission').create({
          data: {
            action: 'plugin::content-manager.explorer.read',
            subject: legacy,
            properties: { fields: ['name', 'slug'], locales: ['en'] },
            conditions: [],
            role: editor.id,
          },
        })
        await query('strapi::core-store').create({
          data: {
            key: `${LAYOUT_PREFIX}${legacy}`,
            value: JSON.stringify({ uid: legacy, settings: { pageSize: 10 } }),
            type: 'object',
            environment: null,
            tag: null,
          },
        })
      }
      // The grants of the new UIDs the first boot made: the old ones are all that micelio-cms wrote.
      await query('plugin::users-permissions.permission').deleteMany({
        where: { action: { $startsWith: 'plugin::micelio.' } },
      })
      await query('strapi::core-store').deleteMany({
        where: {
          key: { $in: [`${LAYOUT_PREFIX}${CATEGORY_UID}`, `${LAYOUT_PREFIX}${TAG_UID}`] },
        },
      })

      // Rows with no site and with no link row at all, as 0.4 wrote them (it had no sites): one
      // category in two locales and a tag.
      const created = (await query(CATEGORY_UID).create({
        data: {
          name: 'Essays',
          slug: 'essays',
          locale: 'en',
          documentId: 'legacycategory0000000001',
        },
      })) as Row
      await query(CATEGORY_UID).create({
        data: {
          name: 'Ensayos',
          slug: 'essays',
          locale: 'es',
          documentId: created.documentId as string,
        },
      })
      await query(TAG_UID).create({
        data: {
          name: 'Privacy',
          slug: 'privacy',
          locale: 'en',
          documentId: 'legacytag00000000000001',
        },
      })
      expect(await query(CATEGORY_UID).count({ where: { site: null } })).toBe(2)
      expect(await query(TAG_UID).count({ where: { site: null } })).toBe(1)

      await cleanupStrapi({ keepDatabase: true })
    })

    it('keeps the grants and the layouts under the new UIDs after one boot', async () => {
      const strapi = await setupStrapi(undefined, { keepDatabase: true })
      const query = (uid: string) => strapi.db.query(uid as UID.ContentType)

      const actions = async (uid: string) =>
        ((await query(uid).findMany({ select: ['action'] })) as { action: string }[])
          .map((row) => row.action)
          .filter((action) => /category|tag/.test(action))
          .sort()

      expect(await actions('plugin::users-permissions.permission')).toEqual([
        'plugin::micelio.category.find',
        'plugin::micelio.tag.find',
      ])
      expect(await actions('admin::api-token-permission')).toEqual([
        'plugin::micelio.category.find',
        'plugin::micelio.tag.find',
      ])
      expect(
        await query('admin::permission').count({
          where: { subject: { $in: [LEGACY_CATEGORY, LEGACY_TAG] } },
        })
      ).toBe(0)
      expect(
        await query('admin::permission').count({
          where: { subject: { $in: [CATEGORY_UID, TAG_UID] }, role: { code: 'legacy-editor' } },
        })
      ).toBe(2)
      expect(
        await query('strapi::core-store').count({
          where: {
            key: { $in: [`${LAYOUT_PREFIX}${LEGACY_CATEGORY}`, `${LAYOUT_PREFIX}${LEGACY_TAG}`] },
          },
        })
      ).toBe(0)
      expect(
        await query('strapi::core-store').count({
          where: {
            key: { $in: [`${LAYOUT_PREFIX}${CATEGORY_UID}`, `${LAYOUT_PREFIX}${TAG_UID}`] },
          },
        })
      ).toBe(2)

      // The legacy permission is the public role's read grant: the route answers again.
      const { port } = strapi.server.httpServer.address() as { port: number }
      expect((await fetch(`http://127.0.0.1:${port}/api/categories?locale=en`)).status).toBe(200)

      before = await snapshot(strapi)
      await cleanupStrapi({ keepDatabase: true })
    })

    it('gives every row with no site the default site, in every locale', async () => {
      const strapi = await setupStrapi(undefined, { keepDatabase: true })
      const query = (uid: string) => strapi.db.query(uid as UID.ContentType)
      const defaultSite = (await query(SITE_UID).findOne({ where: { isDefault: true } })) as Row

      for (const uid of [CATEGORY_UID, TAG_UID]) {
        expect(await query(uid).count({ where: { site: null } })).toBe(0)
        const rows = (await query(uid).findMany({ populate: { site: true } })) as (Row & {
          site: Row
        })[]
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) expect(row.site.id).toBe(defaultSite.id)
      }
      expect(await query(CATEGORY_UID).count()).toBe(2)
      expect(await query(TAG_UID).count()).toBe(1)
    })

    it('changes nothing on a second boot', async () => {
      // The previous test left the instance running: a restart is what the second boot is.
      await cleanupStrapi({ keepDatabase: true })
      const strapi = await setupStrapi(undefined, { keepDatabase: true })
      expect(await snapshot(strapi)).toEqual(before)
    })

    it('leaves a site the admin chose alone', async () => {
      const strapi = await setupStrapi(undefined, { keepDatabase: true })
      const query = (uid: string) => strapi.db.query(uid as UID.ContentType)
      const other = (await strapi.documents(SITE_UID as UID.ContentType).create({
        data: {
          name: 'Other',
          slug: 'other',
          hosts: [],
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
        },
      })) as Row
      await query(TAG_UID).update({ where: { slug: 'privacy' }, data: { site: other.id } })

      await cleanupStrapi({ keepDatabase: true })
      const again = await setupStrapi(undefined, { keepDatabase: true })
      const tag = (await again.db
        .query(TAG_UID as UID.ContentType)
        .findOne({ where: { slug: 'privacy' }, populate: { site: true } })) as Row & { site: Row }
      expect(tag.site.id).toBe(other.id)
    })

    it('leaves the grants of a legacy UID the host still registers alone', async () => {
      const strapi = await setupStrapi(undefined, { keepDatabase: true })
      const query = (uid: string) => strapi.db.query(uid as UID.ContentType)
      const publicRole = (await query('plugin::users-permissions.role').findOne({
        where: { type: 'public' },
      })) as Row
      await query('plugin::users-permissions.permission').create({
        data: { action: `${LEGACY_TAG}.find`, role: publicRole.id },
      })
      const legacyGrants = () =>
        query('plugin::users-permissions.permission').count({
          where: { action: `${LEGACY_TAG}.find` },
        })

      // A host that keeps its own `api::tag.tag` (on another table) registers it as a content type.
      const registered = vi
        .spyOn(strapi, 'contentTypes', 'get')
        .mockReturnValue({ ...strapi.contentTypes, [LEGACY_TAG]: { uid: LEGACY_TAG } } as never)
      try {
        expect(await renameLegacyUids(strapi)).toEqual({ actions: 0, subjects: 0, layouts: 0 })
        expect(await legacyGrants()).toBe(1)
      } finally {
        registered.mockRestore()
      }

      // Once the host drops the type, the same grant moves.
      expect((await renameLegacyUids(strapi)).actions).toBe(1)
      expect(await legacyGrants()).toBe(0)
    })

    it('renames a legacy UID only where it is the whole UID', async () => {
      const strapi = await setupStrapi(undefined, { keepDatabase: true })
      const query = (uid: string) => strapi.db.query(uid as UID.ContentType)
      const publicRole = (await query('plugin::users-permissions.role').findOne({
        where: { type: 'public' },
      })) as Row
      const editor = (await query('admin::role').findOne({
        where: { code: 'legacy-editor' },
      })) as Row

      // Host types whose UID starts with a legacy UID: they are the host's, not the takeover's.
      const GROUP = 'api::tag.tag-group'
      const IMAGE = 'api::category.category-image'
      const ARTICLE = 'api::journal.journal'
      const layout = (uid: string, value: unknown) =>
        query('strapi::core-store').create({
          data: {
            key: `${LAYOUT_PREFIX}${uid}`,
            value: JSON.stringify(value),
            type: 'object',
            environment: null,
            tag: null,
          },
        })
      const relations = {
        uid: ARTICLE,
        metadatas: {
          tags: { edit: { mainField: 'name', targetModel: LEGACY_TAG } },
          groups: { edit: { mainField: 'name', targetModel: GROUP } },
          images: { edit: { mainField: 'name', targetModel: IMAGE } },
          category: { edit: { mainField: 'name', targetModel: LEGACY_CATEGORY } },
        },
      }
      // Strapi wrote the layout of the new tag type on the first boot: a row under the new key wins.
      await query('strapi::core-store').delete({ where: { key: `${LAYOUT_PREFIX}${TAG_UID}` } })
      await layout(LEGACY_TAG, { uid: LEGACY_TAG, settings: { pageSize: 10 } })
      await layout(GROUP, { uid: GROUP, settings: { pageSize: 20 } })
      await layout(IMAGE, { uid: IMAGE, settings: { pageSize: 30 } })
      await layout(ARTICLE, relations)
      await query('plugin::users-permissions.permission').create({
        data: { action: `${IMAGE}.find`, role: publicRole.id },
      })
      await query('admin::permission').create({
        data: {
          action: 'plugin::content-manager.explorer.read',
          subject: IMAGE,
          properties: {},
          conditions: [],
          role: editor.id,
        },
      })

      // The tag layout, and the article layout once for each legacy UID it names.
      expect(await renameLegacyUids(strapi)).toEqual({ actions: 0, subjects: 0, layouts: 3 })

      const stored = async (uid: string) =>
        (await query('strapi::core-store').findOne({
          where: { key: `${LAYOUT_PREFIX}${uid}` },
        })) as (Row & { value: string }) | null
      expect(await stored(LEGACY_TAG)).toBeNull()
      expect(JSON.parse((await stored(TAG_UID))!.value)).toEqual({
        uid: TAG_UID,
        settings: { pageSize: 10 },
      })
      expect(JSON.parse((await stored(GROUP))!.value)).toEqual({
        uid: GROUP,
        settings: { pageSize: 20 },
      })
      expect(JSON.parse((await stored(IMAGE))!.value)).toEqual({
        uid: IMAGE,
        settings: { pageSize: 30 },
      })
      const metadatas = JSON.parse((await stored(ARTICLE))!.value).metadatas
      expect(
        Object.fromEntries(
          Object.entries(metadatas).map(([name, meta]) => [
            name,
            (meta as { edit: { targetModel: string } }).edit.targetModel,
          ])
        )
      ).toEqual({ tags: TAG_UID, groups: GROUP, images: IMAGE, category: CATEGORY_UID })

      // The action and the subject of the longer UID are the host's too.
      expect(
        await query('plugin::users-permissions.permission').count({
          where: { action: `${IMAGE}.find` },
        })
      ).toBe(1)
      expect(await query('admin::permission').count({ where: { subject: IMAGE } })).toBe(1)

      // A second run changes nothing.
      expect(await renameLegacyUids(strapi)).toEqual({ actions: 0, subjects: 0, layouts: 0 })
    })
  }
)
