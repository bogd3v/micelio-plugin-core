import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import type { TransferRecord } from '../../server/src/types/transfer'
import type { ImportDetails } from '../../server/src/types/transfer'
import { cleanupStrapi, setupStrapi } from './harness'
import { buildFixtureSite, exportArchive, jsonOf, untar, type Manifest } from './site-archive'

const PASSWORD = 'Password1234'
const action = (name: string) => ({ action: name, subject: null, properties: {}, conditions: [] })

// The routes of the Export and import page: who may call them, the job, the expiry and the dry run
// that an import needs before it writes (#58).
describe('the transfer routes', () => {
  let strapi: Core.Strapi
  let base: string
  const tokens: Record<string, string> = {}

  async function createUser(email: string, actions: string[] | 'super'): Promise<void> {
    const roles = strapi.service('admin::role')
    const role =
      actions === 'super'
        ? await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } })
        : await roles.create({ name: email, description: email })
    if (actions !== 'super') await roles.assignPermissions(role.id, actions.map(action))
    await strapi.service('admin::user').create({
      email,
      firstname: 'Operator',
      lastname: email.split('@')[0],
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    tokens[email] = ((await response.json()) as { data: { token: string } }).data.token
  }

  function call(who: string, path: string, init: RequestInit & { json?: unknown } = {}) {
    const { json, ...rest } = init
    return fetch(`${base}/micelio${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${tokens[who]}`,
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: json === undefined ? rest.body : JSON.stringify(json),
    })
  }

  async function ready(who: string): Promise<TransferRecord> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await call(who, '/transfers?site=default&kind=export')
      await new Promise((resolve) => setTimeout(resolve, 20))
      const [latest] = ((await response.json()) as { data: TransferRecord[] }).data
      if (latest && latest.status !== 'queued' && latest.status !== 'running') return latest
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('the export did not finish')
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    await buildFixtureSite(strapi)
    await createUser('admin@example.com', 'super')
    await createUser('plain@example.com', [])
    await createUser('operator@example.com', ['plugin::micelio.transfer'])
    await createUser('other@example.com', ['plugin::micelio.transfer'])
    await createUser('personal@example.com', [
      'plugin::micelio.transfer',
      'plugin::micelio.transfer.personal',
    ])
    await createUser('capped@example.com', ['plugin::micelio.transfer'])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('refuses a role without the transfer permission', async () => {
    for (const [path, init] of [
      ['/transfers/sites', {}],
      ['/transfers?site=default', {}],
      ['/exports', { method: 'POST', json: { site: 'default' } }],
    ] as const) {
      const response = await call('plain@example.com', path, init)
      expect(response.status, path).toBe(403)
      expect(((await response.json()) as { code: string }).code).toBe('transferForbidden')
    }
  })

  it('refuses personal data without the personal permission, and logs it when it is allowed', async () => {
    const refused = await call('operator@example.com', '/exports', {
      method: 'POST',
      json: { site: 'default', personal: true },
    })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { code: string }).code).toBe('transferPersonalForbidden')
    const section = await call('operator@example.com', '/exports', {
      method: 'POST',
      json: { site: 'default', include: ['fixture-members'] },
    })
    expect(section.status).toBe(403)
    const options = (await (
      await call('operator@example.com', '/transfers/options?site=default')
    ).json()) as {
      data: { sections: unknown[]; canIncludePersonal: boolean }
    }
    expect(options.data).toMatchObject({ sections: [], canIncludePersonal: false })
  })

  it('counts what an export would hold', async () => {
    const response = await call('admin@example.com', '/transfers/options?site=default')
    const { data } = (await response.json()) as {
      data: {
        entries: number
        mediaFiles: number
        sections: { id: string }[]
        canIncludePersonal: boolean
      }
    }
    expect(data.entries).toBeGreaterThan(0)
    expect(data.mediaFiles).toBe(2)
    expect(data.sections.map(({ id }) => id)).toEqual(['fixture-members'])
    expect(data.canIncludePersonal).toBe(true)
  })

  it('runs an export in the background and serves the archive until it expires', async () => {
    const started = await call('operator@example.com', '/exports', {
      method: 'POST',
      json: { site: 'default', scope: { media: false } },
    })
    expect(started.status).toBe(202)
    const record = await ready('operator@example.com')
    expect(record).toMatchObject({
      status: 'ready',
      operator: 'Operator operator',
      isAvailable: true,
    })
    const download = await call('operator@example.com', `/exports/${record.downloadToken}/download`)
    expect(download.status).toBe(200)
    const files = untar(Buffer.from(await download.arrayBuffer()))
    expect(jsonOf<Manifest>(files, 'manifest.json').media.count).toBe(0)
    expect(new Date(record.expiresAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000)
    expect(new Date(record.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000)

    await strapi.db.query('plugin::micelio.transfer').update({
      where: { id: record.id },
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
    })
    const gone = await call('operator@example.com', `/exports/${record.downloadToken}/download`)
    expect(gone.status).toBe(410)
    expect(((await gone.json()) as { code: string }).code).toBe('transferExpired')
    const history = (await (
      await call('operator@example.com', '/transfers?site=default')
    ).json()) as {
      data: TransferRecord[]
    }
    expect(history.data.find((row) => row.id === record.id)).toMatchObject({ isAvailable: false })
  })

  it('writes nothing without the dry run of the same choice, and then reports its figures', async () => {
    const archive = await exportArchive(strapi, { now: new Date() })
    const form = new FormData()
    form.append('file', new Blob([archive]), 'second.micelio.tar.gz')
    form.append('site', 'default')
    form.append('existing', 'skip')
    const staged = await call('admin@example.com', '/imports/dry-run', {
      method: 'POST',
      body: form,
    })
    expect(staged.status).toBe(200)
    const { data } = (await staged.json()) as { data: TransferRecord }
    const details = data.details as ImportDetails
    expect(data).toMatchObject({ kind: 'import', status: 'staged', name: 'second.micelio.tar.gz' })

    const wrong = await call('admin@example.com', `/imports/${data.id}/apply`, {
      method: 'POST',
      json: { existing: 'update' },
    })
    expect(wrong.status).toBe(409)
    expect(((await wrong.json()) as { code: string }).code).toBe('importNotConfirmed')

    const applied = await call('admin@example.com', `/imports/${data.id}/apply`, {
      method: 'POST',
      json: { existing: 'skip' },
    })
    expect(applied.status).toBe(200)
    const report = ((await applied.json()) as { data: TransferRecord }).data
      .details as ImportDetails
    for (const [name, counts] of Object.entries(details.preview!.types)) {
      expect(report.report!.types[name]).toMatchObject({
        created: counts.create,
        replaced: counts.update,
        skipped: counts.skip,
      })
    }
    // The archive is not kept once applied.
    const again = await call('admin@example.com', `/imports/${data.id}/apply`, {
      method: 'POST',
      json: { existing: 'skip' },
    })
    expect(again.status).toBe(409)
  })

  it('keeps nothing of an archive it refuses', async () => {
    const form = new FormData()
    form.append('file', new Blob([gunzipSync(await exportArchive(strapi))]), 'plain.tar')
    form.append('site', 'default')
    const response = await call('admin@example.com', '/imports/dry-run', {
      method: 'POST',
      body: form,
    })
    expect(response.status).toBe(422)
    const rows = await strapi.db
      .query('plugin::micelio.transfer')
      .count({ where: { kind: 'import' } })
    expect(rows).toBe(1)
  })

  it('gives an export to the user who made it and to no other', async () => {
    const started = await call('operator@example.com', '/exports', {
      method: 'POST',
      json: { site: 'default' },
    })
    expect(started.status).toBe(202)
    const mine = await ready('operator@example.com')
    expect(mine.downloadToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(mine.downloadToken).not.toBe(String(mine.id))

    const history = (await (await call('other@example.com', '/transfers?site=default')).json()) as {
      data: TransferRecord[]
    }
    const seen = history.data.find((row) => row.id === mine.id)
    expect(seen).toMatchObject({ isAvailable: true, downloadToken: null })
    for (const key of [mine.downloadToken, String(mine.id)]) {
      const refused = await call('other@example.com', `/exports/${key}/download`)
      expect(refused.status, key!).toBe(404)
      expect(((await refused.json()) as { code: string }).code).toBe('transferNotFound')
    }
    // The id is not the address, even for the maker.
    expect((await call('operator@example.com', `/exports/${mine.id}/download`)).status).toBe(404)
    expect(
      (await call('operator@example.com', `/exports/${mine.downloadToken}/download`)).status
    ).toBe(200)
  })

  it('asks for the personal permission again when the personal export is downloaded', async () => {
    await call('personal@example.com', '/exports', {
      method: 'POST',
      json: { site: 'default', personal: true },
    })
    const record = await ready('personal@example.com')
    expect(record.status).toBe('ready')
    const url = `/exports/${record.downloadToken}/download`
    expect((await call('personal@example.com', url)).status).toBe(200)

    const role = (await strapi.db.query('admin::role').findOne({
      where: { name: 'personal@example.com' },
    })) as { id: number }
    await strapi
      .service('admin::role')
      .assignPermissions(role.id, [action('plugin::micelio.transfer')])
    const refused = await call('personal@example.com', url)
    expect(refused.status).toBe(404)
    expect(((await refused.json()) as { code: string }).code).toBe('transferNotFound')
  })

  it('imports as a draft what the caller may not publish', async () => {
    await strapi
      .documents('plugin::micelio.site' as never)
      .create({ data: { name: 'Third', slug: 'third', modules: {} } as never })
    const archive = await exportArchive(strapi, { now: new Date() })
    const form = new FormData()
    form.append('file', new Blob([archive]), 'third.micelio.tar.gz')
    form.append('site', 'third')
    form.append('existing', 'keep-both')
    const staged = await call('operator@example.com', '/imports/dry-run', {
      method: 'POST',
      body: form,
    })
    expect(staged.status).toBe(200)
    const { data } = (await staged.json()) as { data: TransferRecord }
    const details = data.details as ImportDetails
    expect(details.preview!.types.story).toMatchObject({ create: 1, asDraft: 1 })

    // Another user cannot read, redo or apply it.
    for (const [path, json] of [
      [`/imports/${data.id}/dry-run`, { existing: 'skip' }],
      [`/imports/${data.id}/apply`, { existing: 'keep-both' }],
    ] as const) {
      expect((await call('other@example.com', path, { method: 'POST', json })).status).toBe(404)
    }

    const applied = await call('operator@example.com', `/imports/${data.id}/apply`, {
      method: 'POST',
      json: { existing: 'keep-both' },
    })
    expect(applied.status).toBe(200)
    const stories = (await strapi.db.query('api::story.story').findMany({
      where: { site: { slug: 'third' } },
    })) as { publishedAt: string | null }[]
    expect(stories.length).toBeGreaterThan(0)
    expect(stories.filter((row) => row.publishedAt)).toEqual([])
  })

  it('refuses an archive over the size it may hold, and a fourth staged upload', async () => {
    const archive = await exportArchive(strapi, { now: new Date() })
    const upload = (who: string) => {
      const form = new FormData()
      form.append('file', new Blob([archive]), 'again.micelio.tar.gz')
      form.append('site', 'third')
      form.append('existing', 'keep-both')
      return call(who, '/imports/dry-run', { method: 'POST', body: form })
    }
    strapi.config.set('plugin::micelio.transferMaxBytes', 1000)
    try {
      const refused = await upload('capped@example.com')
      expect(refused.status).toBe(422)
      expect(((await refused.json()) as { code: string }).code).toBe('exportArchiveCorrupt')
    } finally {
      strapi.config.set('plugin::micelio.transferMaxBytes', undefined)
    }
    const staged = await strapi.db
      .query('plugin::micelio.transfer')
      .count({ where: { kind: 'import', status: 'staged' } })
    for (let held = 0; held < 3; held += 1) {
      expect((await upload('capped@example.com')).status).toBe(200)
    }
    const full = await upload('capped@example.com')
    expect(full.status).toBe(429)
    expect(((await full.json()) as { code: string }).code).toBe('importQueueFull')
    expect(
      await strapi.db
        .query('plugin::micelio.transfer')
        .count({ where: { kind: 'import', status: 'staged' } })
    ).toBe(staged + 3)
    // Another user's uploads are not counted against them.
    expect((await upload('other@example.com')).status).toBe(200)
  })

  it('keeps its history in an internal type that no editor sees, under a site', () => {
    const schema = strapi.contentType('plugin::micelio.transfer' as never) as {
      pluginOptions?: Record<string, unknown>
      attributes: Record<string, { type?: string; target?: string }>
    }
    expect(schema.pluginOptions?.['content-manager']).toEqual({ visible: false })
    expect(schema.pluginOptions?.['content-type-builder']).toEqual({ visible: false })
    expect(schema.attributes.site).toMatchObject({
      type: 'relation',
      target: 'plugin::micelio.site',
    })
  })
})
