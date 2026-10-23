import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { BLOCKS } from '../../contract/blocks'
import packageJson from '../../package.json'
import { SITE_UID } from '../../server/src/constants/site'
import type { StatusReport } from '../../server/src/types/status'
import { closedOrigin, startFrontend, type FrontendStub } from './frontend'
import { cleanupStrapi, setupStrapi } from './harness'

const PASSWORD = 'Password1234'

type Role = 'strapi-super-admin' | 'strapi-editor'

describe('the status route', () => {
  let strapi: Core.Strapi
  let base: string
  let frontend: FrontendStub
  let unreachable: string
  const tokens = {} as Record<Role, string>

  async function login(role: Role): Promise<void> {
    const roleRow = (await strapi.db.query('admin::role').findOne({ where: { code: role } })) as {
      id: number
    }
    const email = `${role}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: role,
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleRow.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    tokens[role] = ((await response.json()) as { data: { token: string } }).data.token
  }

  function readStatus(role?: Role): Promise<Response> {
    return fetch(`${base}/micelio/status`, {
      headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {},
    })
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    frontend = await startFrontend('0.6.3')
    unreachable = await closedOrigin()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    for (const [slug, url] of [
      ['blog', `${frontend.origin}/blog?draft=1`],
      ['shop', `${frontend.origin}/`],
      ['docs', unreachable],
    ]) {
      await sites.create({
        data: {
          name: `The ${slug}`,
          slug,
          hosts: [`${slug}.example.com`],
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
          url,
        },
      })
    }
    await login('strapi-super-admin')
    await login('strapi-editor')
  })

  afterAll(async () => {
    await frontend.close()
    await cleanupStrapi()
  })

  it('answers the plugin, the sites, the frontends, the host check and the catalogue', async () => {
    const response = await readStatus('strapi-super-admin')
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as { data: StatusReport }
    expect(data.plugin).toEqual({ version: packageJson.version, coreLine: packageJson.micelio })
    expect(data.blocks).toEqual({ count: BLOCKS.length })
    // The default site first, then by slug; only the origin of a `url`.
    expect(
      data.sites.map(({ slug, hosts, isDefault, origin }) => [slug, hosts, isDefault, origin])
    ).toEqual([
      ['default', [], true, null],
      ['blog', ['blog.example.com'], false, frontend.origin],
      ['docs', ['docs.example.com'], false, unreachable],
      ['shop', ['shop.example.com'], false, frontend.origin],
    ])
    expect(data.frontends).toEqual(
      [
        { origin: frontend.origin, sites: ['blog', 'shop'], health: 'reachable', version: '0.6.3' },
        { origin: unreachable, sites: ['docs'], health: 'unavailable' },
      ].sort((a, b) => a.origin.localeCompare(b.origin))
    )
    // The boot's run: the sites above did not exist yet.
    expect(data.hostCheck?.ok).toBe(true)
    expect(data.hostCheck?.results.map(({ id }) => id)).toContain('frontend-release-line')
  })

  it('refuses an admin user whose role lacks the status permission', async () => {
    const response = await readStatus('strapi-editor')
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/)
    expect(((await response.json()) as { code: string }).code).toBe('statusForbidden')
  })

  it('needs an admin user', async () => {
    const response = await readStatus()
    expect(response.status).toBe(401)
  })

  it('registers the permission, so a role can be given it', () => {
    const actions = strapi.service('admin::permission').actionProvider.values() as {
      actionId: string
    }[]
    expect(actions.map(({ actionId }) => actionId)).toContain('plugin::micelio.status.read')
  })
})
