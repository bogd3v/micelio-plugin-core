import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import type { ImportPreview } from '../../server/src/site-export/dry-run'
import type { ImportReport } from '../../server/src/site-export/importer'
import { SITE_UID } from '../../server/src/constants/site'
import { publishDueEntries } from '../../server/src/editorial/scheduler'
import { cleanupStrapi, setupStrapi } from './harness'
import {
  buildFixtureSite,
  exportArchive,
  jsonOf,
  NOTE,
  rewrite,
  tar,
  untar,
  type ContentFile,
  type FixtureSite,
  type Manifest,
} from './site-archive'

const TYPES = [NOTE, SITE_UID as UID.ContentType, 'plugin::upload.file']

// The dry run and the policies of an import (#58): the figures of the dry run are the report's.
describe('the dry run and the policies of an import', () => {
  let strapi: Core.Strapi
  let fixture: FixtureSite
  let archive: Buffer

  const service = () => strapi.plugin('micelio').service('siteExport')
  const preview = (request: object = {}): Promise<ImportPreview> =>
    service().preview(Readable.from([archive]), request)
  const run = (request: object = {}): Promise<ImportReport> =>
    service().import(Readable.from([archive]), request)

  async function snapshot(): Promise<unknown[]> {
    const rows: unknown[] = []
    for (const uid of TYPES) {
      rows.push([
        uid,
        await strapi.db
          .query(uid as UID.ContentType)
          .findMany({ select: ['id', 'documentId', 'updatedAt'], orderBy: { id: 'asc' } }),
      ])
    }
    return rows
  }

  /** The figures of a dry run in the words of a report. */
  function asReport(counts: ImportPreview['types']) {
    return Object.fromEntries(
      Object.entries(counts).map(([name, { create, update, skip }]) => [
        name,
        { created: create, replaced: update, skipped: skip },
      ])
    )
  }
  function ofReport(types: ImportReport['types']) {
    return Object.fromEntries(
      Object.entries(types).map(([name, { created, replaced, skipped }]) => [
        name,
        { created, replaced, skipped },
      ])
    )
  }

  beforeAll(async () => {
    const source = await setupStrapi()
    fixture = await buildFixtureSite(source)
    archive = await exportArchive(source)
    await cleanupStrapi()
    strapi = await setupStrapi()
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    await strapi
      .documents(SITE_UID as UID.ContentType)
      .create({ data: { name: 'Second', slug: 'second', modules: {} } as never })
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('writes nothing, and its figures are those of the import into another site with keep-both', async () => {
    const before = await snapshot()
    const plan = await preview({ into: 'second', existing: 'keep-both' })
    expect(await snapshot()).toEqual(before)
    expect(plan.types.story).toMatchObject({ inFile: 1, create: 1, update: 0, skip: 0 })
    expect(plan.media.inFile).toBeGreaterThan(0)
    expect(plan.media.reused).toBe(0)

    const report = await run({ into: 'second', existing: 'keep-both' })
    expect(ofReport(report.types)).toMatchObject(asReport(plan.types))
    expect(report.media).toEqual({ stored: plan.media.inFile, reused: plan.media.reused })
    // The site's own settings are left alone: the second site keeps its name.
    const second = await strapi.documents(SITE_UID as UID.ContentType).findFirst({
      filters: { slug: 'second' },
    })
    expect(second?.name).toBe('Second')
    // New documents of their own, under the second site; the first site's are untouched.
    const stories = (await strapi.db.query('api::story.story').findMany({
      select: ['documentId'],
      populate: { site: { select: ['slug'] } },
    })) as { documentId: string; site: { slug: string } | null }[]
    expect(stories.some((row) => row.documentId === fixture.story)).toBe(false)
    expect(stories.every((row) => row.site?.slug === 'second')).toBe(true)
  })

  it('does not take the archive site hosts into an existing site unless it updates it', async () => {
    const hosts = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
    await strapi.documents(SITE_UID as UID.ContentType).update({
      documentId: hosts,
      data: { hosts: ['source.test'] } as never,
    })
    const files = untar(archive)
    rewrite<ContentFile>(files, 'content/site.json', (content) => {
      content.documents[0]!.versions[0]!.data.hosts = ['Source.test']
      return content
    })
    const claimed = tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
    for (const existing of ['skip', 'keep-both'] as const) {
      await expect(
        service().preview(Readable.from([claimed]), { into: 'second', existing })
      ).resolves.toMatchObject({ site: { slug: 'second' } })
    }
    await expect(
      service().preview(Readable.from([claimed]), { into: 'second', existing: 'update' })
    ).rejects.toMatchObject({ code: 'exportHostTaken' })
  })

  it('writes nothing the second time, and the dry run says so', async () => {
    const before = await snapshot()
    const plan = await preview({ into: 'second', existing: 'keep-both' })
    for (const counts of Object.values(plan.types)) expect(counts.create + counts.update).toBe(0)
    const report = await run({ into: 'second', existing: 'keep-both' })
    expect(ofReport(report.types)).toMatchObject(asReport(plan.types))
    expect(report.media).toEqual({ stored: 0, reused: plan.media.inFile })
    expect(await snapshot()).toEqual(before)
  })

  it('leaves an existing entry as it is with skip, and replaces it with update', async () => {
    const files = untar(archive)
    const manifest = jsonOf<Manifest>(files, 'manifest.json')
    const note = manifest.types.find((type) => type.uid === NOTE)!
    rewrite<ContentFile>(files, note.file, (content) => {
      content.documents[0]!.versions[0]!.data.title = 'Changed by the file'
      return content
    })
    const changed = tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
    const titleOf = async () =>
      (await strapi.db.query(NOTE).findOne({
        where: { site: { slug: 'default' } },
      })) as { title: string } | null
    await service().import(Readable.from([changed]), { into: 'default', existing: 'update' })
    expect((await titleOf())?.title).toBe('Changed by the file')
    // Back to the original title, then skip: the file's title does not win.
    await service().import(Readable.from([archive]), { into: 'default', existing: 'update' })
    const skipped = await service().preview(Readable.from([changed]), {
      into: 'default',
      existing: 'skip',
    })
    expect(skipped.types.note).toMatchObject({ create: 0, update: 0, skip: 1 })
    const updated = await service().preview(Readable.from([changed]), {
      into: 'default',
      existing: 'update',
    })
    expect(updated.types.note).toMatchObject({ create: 0, update: 1, skip: 0 })
    await service().import(Readable.from([changed]), { into: 'default', existing: 'skip' })
    expect((await titleOf())?.title).toBe('Mine')
  })

  it('refuses an archive the import would refuse, as the dry run, with the same code', async () => {
    await expect(
      service().preview(Readable.from([archive]), { into: 'nowhere' })
    ).rejects.toMatchObject({ code: 'exportSiteNotFound' })
  })
})

// What an export may leave out stays an archive an import reads whole.
describe('the scope of an export', () => {
  let strapi: Core.Strapi

  beforeAll(async () => {
    strapi = await setupStrapi()
    await buildFixtureSite(strapi)
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  const preview = (archive: Buffer): Promise<ImportPreview> =>
    strapi
      .plugin('micelio')
      .service('siteExport')
      .preview(Readable.from([archive]), { into: 'default' })

  it('leaves the media out, with the references to it', async () => {
    const files = untar(await exportArchive(strapi, { scope: { media: false } }))
    const manifest = jsonOf<Manifest>(files, 'manifest.json')
    expect(manifest.media.count).toBe(0)
    expect([...files.keys()].some((name) => name.startsWith('media/sha256/'))).toBe(false)
    expect(JSON.stringify(jsonOf(files, 'content/story.json'))).not.toContain('"media"')
  })

  it('leaves the content out and keeps the site', async () => {
    const archive = await exportArchive(strapi, { scope: { content: false } })
    const manifest = jsonOf<Manifest>(untar(archive), 'manifest.json')
    expect(manifest.types.find((type) => type.name === 'site')?.documents).toBe(1)
    expect(
      manifest.types.filter((type) => type.name !== 'site').every((t) => t.documents === 0)
    ).toBe(true)
    expect(
      Object.values((await preview(archive)).types).every(
        (c) => c.create + c.update === 0 || c.inFile === 1
      )
    ).toBe(true)
  })

  it('leaves out what was never published, and the theme pin and settings', async () => {
    const full = jsonOf<Manifest>(untar(await exportArchive(strapi)), 'manifest.json')
    const archive = await exportArchive(strapi, { scope: { drafts: false, settings: false } })
    const files = untar(archive)
    const manifest = jsonOf<Manifest>(files, 'manifest.json')
    const count = (m: Manifest, name: string) => m.types.find((t) => t.name === name)!.documents
    expect(count(manifest, 'story')).toBe(count(full, 'story'))
    expect((manifest as Manifest & { theme: unknown }).theme).toBeNull()
    const site = jsonOf<ContentFile>(files, 'content/site.json')
    expect(Object.keys(site.documents[0]!.versions[0]!.data).sort()).toEqual(
      ['defaultLocale', 'hosts', 'isDefault', 'modules', 'name', 'slug', 'url'].filter(
        (k) => k in site.documents[0]!.versions[0]!.data
      )
    )
    await expect(preview(archive)).resolves.toMatchObject({ site: { slug: 'default' } })
  })
})

// What an import does for a caller with limits (#58): it keeps the identity of an existing site,
// publishes only what the caller may publish, and refuses an archive over its size.
describe('the limits of an import', () => {
  let strapi: Core.Strapi
  let archive: Buffer

  const service = () => strapi.plugin('micelio').service('siteExport')
  const stream = () => Readable.from([archive])
  const secondSite = () =>
    strapi.documents(SITE_UID as UID.ContentType).findFirst({ filters: { slug: 'second' } })

  beforeAll(async () => {
    const source = await setupStrapi()
    await buildFixtureSite(source)
    archive = await exportArchive(source)
    await cleanupStrapi()
    strapi = await setupStrapi()
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    await strapi.documents(SITE_UID as UID.ContentType).create({
      data: {
        name: 'Second',
        slug: 'second',
        hosts: ['second.test'],
        url: 'https://second.test',
        modules: {},
      } as never,
    })
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('refuses an archive over the size it may hold, and keeps nothing of it', async () => {
    const count = () => strapi.db.query('api::story.story').count()
    const before = await count()
    for (const run of [
      () => service().preview(stream(), { into: 'second', maxBytes: 1000 }),
      () => service().import(stream(), { into: 'second', maxBytes: 1000 }),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'exportArchiveCorrupt' })
    }
    expect(await count()).toBe(before)
  })

  it('shows what arrives as a draft, and writes no published version the caller may not make', async () => {
    const request = { into: 'second', existing: 'keep-both' as const, canPublish: () => false }
    const unrestricted = await service().preview(stream(), {
      into: 'second',
      existing: 'keep-both',
    })
    expect(unrestricted.types.story).toMatchObject({ create: 1, asDraft: 0 })
    const plan = await service().preview(stream(), request)
    expect(plan.types.story).toMatchObject({ create: 1, asDraft: 1 })

    await service().import(stream(), request)
    const rows = (await strapi.db.query('api::story.story').findMany({
      populate: { editorial: true },
    })) as { publishedAt: string | null; editorial?: { state?: string } | null }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((row) => row.publishedAt)).toEqual([])
    expect(rows.map((row) => row.editorial?.state)).not.toContain('published')
  })

  it('does not unpublish for a caller who may not publish', async () => {
    // The archive is now held as drafts; a caller who may publish brings the published version in.
    await service().import(stream(), { into: 'second', existing: 'update', keepIdentity: true })
    const published = () =>
      strapi.db.query('api::story.story').count({ where: { publishedAt: { $notNull: true } } })
    expect(await published()).toBe(1)
    await service().import(stream(), {
      into: 'second',
      existing: 'update',
      keepIdentity: true,
      canPublish: () => false,
    })
    expect(await published()).toBe(1)
  })

  it('keeps the name, hosts and url of an existing site when it updates its settings', async () => {
    await service().import(stream(), { into: 'second', existing: 'update', keepIdentity: true })
    expect(await secondSite()).toMatchObject({
      name: 'Second',
      slug: 'second',
      hosts: ['second.test'],
      url: 'https://second.test',
    })
    const plan = await service().preview(stream(), {
      into: 'second',
      existing: 'update',
      keepIdentity: true,
    })
    expect(plan.types.site).toMatchObject({ create: 0, update: 0, skip: 1 })
  })

  it('drops the schedule of a draft the caller may not publish, so the scheduler never publishes it', async () => {
    const files = untar(archive)
    rewrite<ContentFile>(files, 'content/story.json', (content) => {
      const document = content.documents[0]!
      document.documentId = 'scheduledstory000000000000'
      document.versions = document.versions.filter((version) => version.status === 'draft')
      const draft = document.versions.find((version) => version.locale === 'en')!
      draft.data.editorial = { state: 'scheduled', publishAt: '2026-10-01T00:00:00.000Z' }
      return content
    })
    const scheduled = tar(files)
    const request = { into: 'second', existing: 'keep-both' as const, canPublish: () => false }
    const plan = await service().preview(Readable.from([scheduled]), request)
    expect(plan.types.story).toMatchObject({ create: 1, asDraft: 1 })

    await service().import(Readable.from([scheduled]), request)
    const row = (await strapi.db.query('api::story.story').findMany({
      where: { title: 'Draft title' },
      populate: { editorial: true },
    })) as { publishedAt: string | null; editorial?: { state?: string; publishAt?: unknown } }[]
    expect(row.map((entry) => entry.editorial?.state)).not.toContain('scheduled')
    expect(row.every((entry) => !entry.editorial?.publishAt)).toBe(true)
    expect(await publishDueEntries(strapi, new Date('2027-01-01T00:00:00.000Z'))).toBe(0)
    expect(row.filter((entry) => entry.publishedAt)).toEqual([])
  })
})
