import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { exportArchive, jsonOf, rewrite, sha256, tar, untar, type Manifest } from './site-archive'

const REDIRECT = 'plugin::micelio.redirect' as UID.ContentType

interface RedirectsFile {
  site: { documentId: string; slug: string }
  redirects: { from: string; to: string; entryLocale: string | null }[]
}
interface Entry {
  from: string
  to: string
  entryLocale: string | null
}
interface Report {
  redirects: { created: number; existing: Entry[]; invalid: Entry[] }
}
type Row = Entry & { rule: string }

// The redirects of a site travel with its archive (#142): exported from one clean Strapi, imported
// into a second one, booted on an empty database.
describe('the redirects in the site archive', () => {
  let strapi: Core.Strapi
  let files: Map<string, Buffer>
  let archive: Buffer

  const TWO: Entry[] = [
    { from: '/landing', to: '/open-source', entryLocale: 'en' },
    { from: '/old', to: '/new', entryLocale: null },
  ]

  const siteId = async (slug = 'default') =>
    (await strapi.documents(SITE_UID as UID.ContentType).findFirst({ filters: { slug } }))!
      .documentId

  /** The redirects of a site, as the target holds them. */
  async function held(slug = 'default'): Promise<Row[]> {
    const rows = (await strapi.documents(REDIRECT).findMany({
      filters: { site: { slug } },
      fields: ['from', 'to', 'entryLocale', 'rule'],
      sort: ['from:asc', 'entryLocale:asc'],
    } as never)) as unknown as Row[]
    return rows.map(({ from, to, entryLocale, rule }) => ({ from, to, entryLocale, rule }))
  }

  async function clear(): Promise<void> {
    for (const { documentId } of (await strapi.documents(REDIRECT).findMany({})) as unknown as {
      documentId: string
    }[]) {
      await strapi.documents(REDIRECT).delete({ documentId })
    }
  }

  function importArchive(body: Buffer): Promise<Report> {
    return strapi
      .plugin('micelio')
      .service('siteExport')
      .import(Readable.from([body]), { into: 'default' }) as Promise<Report>
  }

  /** The archive with its redirects part replaced, still whole by its manifest. */
  function withRedirects(redirects: Entry[]): Buffer {
    const changed = new Map(files)
    rewrite<RedirectsFile>(changed, 'redirects.json', (file) => ({ ...file, redirects }))
    return tar(new Map([...changed].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const site = await siteId()
    const other = await strapi
      .documents(SITE_UID as UID.ContentType)
      .create({ data: { name: 'Other', slug: 'other', modules: {} } as never })
    const create = (data: object) => strapi.documents(REDIRECT).create({ data: data as never })
    // Written out of order: the archive sorts them.
    await create({ ...TWO[1], site })
    await create({ ...TWO[0], site })
    await create({ from: '/elsewhere', to: '/else', site: other.documentId })
    archive = await exportArchive(strapi)
    files = untar(archive)
    await cleanupStrapi()
    strapi = await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('writes the redirects of the site, without ids, and lists the part in the manifest', () => {
    const manifest = jsonOf<Manifest & { redirects: unknown }>(files, 'manifest.json')
    expect(manifest.formatVersion).toBe('1.2')
    expect(manifest.redirects).toEqual({ file: 'redirects.json', count: 2 })
    const body = files.get('redirects.json')!
    expect(manifest.files['redirects.json']).toEqual({ sha256: sha256(body), bytes: body.length })
    expect(jsonOf<RedirectsFile>(files, 'redirects.json')).toEqual({
      site: manifest.site,
      redirects: [TWO[0], TWO[1]],
    })
  })

  it('imports them into an empty site, which then lists both', async () => {
    expect(await held()).toEqual([])
    const report = await importArchive(archive)
    expect(report.redirects).toEqual({ created: 2, existing: [], invalid: [] })
    expect(await held()).toEqual(TWO.map((entry) => ({ ...entry, rule: 'slug-change' })))
    expect(await held('other')).toEqual([])
  })

  it('imports the same archive again without writing anything', async () => {
    const report = await importArchive(archive)
    expect(report.redirects).toEqual({ created: 0, existing: TWO, invalid: [] })
    expect(await held()).toHaveLength(2)
  })

  it("reports a redirect whose address the site already redirects, and keeps the site's", async () => {
    await clear()
    const site = await siteId()
    await strapi.documents(REDIRECT).create({
      data: { from: '/old', to: '/mine', entryLocale: null, site } as never,
    })
    const report = await importArchive(archive)
    expect(report.redirects).toEqual({ created: 1, existing: [TWO[1]], invalid: [] })
    expect((await held()).map(({ from, to }) => [from, to])).toEqual([
      ['/landing', '/open-source'],
      ['/old', '/mine'],
    ])
  })

  it('imports a redirect of the same address for another locale', async () => {
    await clear()
    const site = await siteId()
    await strapi.documents(REDIRECT).create({
      data: { from: '/landing', to: '/inicio', entryLocale: 'es', site } as never,
    })
    const report = await importArchive(archive)
    expect(report.redirects.created).toBe(2)
    expect((await held()).map(({ from, entryLocale }) => [from, entryLocale])).toEqual([
      ['/landing', 'en'],
      ['/landing', 'es'],
      ['/old', null],
    ])
  })

  it('skips and reports a redirect that leaves the site, and creates the others', async () => {
    await clear()
    const bad: Entry[] = [
      { from: '/a', to: 'https://evil.example/', entryLocale: null },
      { from: '/b', to: '//evil.example', entryLocale: 'en' },
      { from: '//c', to: '/c', entryLocale: null },
      { from: '/d', to: '/\\evil.example', entryLocale: null },
      { from: '/e', to: `/${'x'.repeat(512)}`, entryLocale: null },
    ]
    const report = await importArchive(withRedirects([...bad, ...TWO]))
    expect(report.redirects).toEqual({ created: 2, existing: [], invalid: bad })
    expect((await held()).map(({ from }) => from)).toEqual(['/landing', '/old'])
  })

  it('imports a format 1.1 archive as before, with no redirects', async () => {
    await clear()
    const old = new Map(files)
    old.delete('redirects.json')
    const manifest = jsonOf<Manifest & { redirects?: unknown }>(old, 'manifest.json')
    manifest.formatVersion = '1.1'
    delete manifest.redirects
    delete manifest.files['redirects.json']
    old.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
    const report = await importArchive(tar(new Map([...old].sort(([a], [b]) => (a < b ? -1 : 1)))))
    expect(report.redirects).toEqual({ created: 0, existing: [], invalid: [] })
    expect(await held()).toEqual([])
  })

  it('refuses an archive whose redirects file is not valid, before it writes anything', async () => {
    await clear()
    const broken = new Map(files)
    rewrite<unknown>(broken, 'redirects.json', () => ({ redirects: [{ from: 1 }] }))
    await expect(
      importArchive(tar(new Map([...broken].sort(([a], [b]) => (a < b ? -1 : 1)))))
    ).rejects.toMatchObject({ code: 'exportDocumentInvalid' })
    expect(await held()).toEqual([])
  })

  it('writes none when the export leaves the content out', async () => {
    await clear()
    await strapi.documents(REDIRECT).create({
      data: { from: '/kept', to: '/here', entryLocale: null, site: await siteId() } as never,
    })
    const scoped = untar(await exportArchive(strapi, { scope: { content: false } }))
    expect(jsonOf<RedirectsFile>(scoped, 'redirects.json').redirects).toEqual([])
  })
})
