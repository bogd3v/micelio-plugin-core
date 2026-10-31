import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core } from '@strapi/strapi'
import packageJson from '../../package.json'
import type { AboutReport } from '../../server/src/types/about'
import { startFrontend, type FrontendStub } from './frontend'
import { cleanupStrapi, setupStrapi } from './harness'
import { ADMIN_EMAIL, buildFixtureSite } from './site-archive'

const PASSWORD = 'Password1234'

// The About page's data (#58): the release feed is asked only while the check is on and never by a
// page load, and the diagnostics hold versions and counts, nothing of the content.
describe('the about route', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let feed: http.Server
  let frontend: FrontendStub
  let feedRequests = 0
  let accessKey = ''

  const read = async (path: string, method = 'GET') =>
    (
      (await (
        await fetch(`${base}/micelio${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()) as { data: AboutReport }
    ).data

  beforeAll(async () => {
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    feed = http.createServer((_request, response) => {
      feedRequests += 1
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({ tag_name: 'v9.9.0', html_url: 'https://example.com/releases/9.9.0' })
      )
    })
    await new Promise<void>((resolve) => feed.listen(0, '127.0.0.1', resolve))
    process.env.MICELIO_UPDATE_FEED = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/latest`
    frontend = await startFrontend('0.6.3')
    const fixture = await buildFixtureSite(strapi)
    await strapi.documents('plugin::micelio.site' as never).update({
      documentId: fixture.site,
      data: { url: frontend.origin } as never,
    })
    const created = (await strapi.service('admin::api-token').create({
      name: 'about-suite',
      type: 'full-access',
      lifespan: null,
    })) as { accessKey: string }
    accessKey = created.accessKey
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
    })
    token = ((await response.json()) as { data: { token: string } }).data.token
  })

  afterAll(async () => {
    delete process.env.MICELIO_UPDATE_FEED
    process.env.MICELIO_UPDATE_CHECK = 'false'
    await frontend.close()
    await new Promise((resolve) => feed.close(resolve))
    await cleanupStrapi()
  })

  it('asks the feed nothing while MICELIO_UPDATE_CHECK is false, whatever the page does', async () => {
    process.env.MICELIO_UPDATE_CHECK = 'false'
    const refreshed = await read('/about/refresh', 'POST')
    const loaded = await read('/about')
    expect(feedRequests).toBe(0)
    expect(refreshed.update).toEqual({ state: 'off' })
    expect(loaded.update).toEqual({ state: 'off' })
    // The frontend is still asked: it is the site's own, not a request that leaves the CMS.
    expect(loaded.frontends[0]).toMatchObject({ health: 'reachable', version: '0.6.3' })
  })

  it('asks the feed when the user runs the checks, never when the page loads', async () => {
    process.env.MICELIO_UPDATE_CHECK = 'true'
    await read('/about')
    await read('/about')
    expect(feedRequests).toBe(0)
    const refreshed = await read('/about/refresh', 'POST')
    expect(feedRequests).toBe(1)
    expect(refreshed.update).toEqual({
      state: 'available',
      version: '9.9.0',
      url: 'https://example.com/releases/9.9.0',
    })
    await read('/about')
    expect(feedRequests).toBe(1)
  })

  it('reads the feed once a day however often the checks are run, and limits who runs them', async () => {
    process.env.MICELIO_UPDATE_CHECK = 'true'
    const before = feedRequests
    const statuses: number[] = []
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await fetch(`${base}/micelio/about/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      statuses.push(response.status)
      if (response.status === 429) {
        expect(((await response.json()) as { code: string }).code).toBe('aboutRefreshLimited')
        expect(response.headers.get('retry-after')).toMatch(/^\d+$/)
      }
    }
    expect(feedRequests).toBe(before)
    expect(statuses).toContain(429)
    expect(statuses.indexOf(429)).toBeGreaterThan(0)
  })

  it('writes diagnostics with versions and counts, and none of the fixtures', async () => {
    const { diagnostics } = await read('/about')
    expect(diagnostics).toContain(
      `micelio-core ${packageJson.version} · line ${packageJson.micelio}`
    )
    expect(diagnostics).toMatch(/^sites 2 \(default default, other\)$/m)
    expect(diagnostics).toMatch(/^db sqlite /m)
    for (const secret of [
      ADMIN_EMAIL,
      'reader@example.com',
      'guest@example.com',
      'secret value',
      'pin value',
      'Draft title',
      'Published title',
      accessKey,
      frontend.origin,
      'example.com',
    ]) {
      expect(diagnostics, secret).not.toContain(secret)
    }
  })
})
