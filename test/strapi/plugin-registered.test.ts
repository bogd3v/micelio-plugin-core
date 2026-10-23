import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import packageJson from '../../package.json'
import { cleanupStrapi, setupStrapi } from './harness'

describe('a clean Strapi with the plugin installed', () => {
  let strapi: Core.Strapi

  beforeAll(async () => {
    strapi = await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('registers the plugin under its name', () => {
    expect(strapi.plugin('micelio')).toBeDefined()
  })

  it('loads it from this package', () => {
    const enabled =
      strapi.config.get<Record<string, { packageInfo?: { name?: string } }>>('enabledPlugins')
    expect(enabled.micelio?.packageInfo?.name).toBe(packageJson.name)
  })

  it('serves requests', async () => {
    const { port } = strapi.server.httpServer.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/_health`)
    expect(response.status).toBe(204)
  })
})
