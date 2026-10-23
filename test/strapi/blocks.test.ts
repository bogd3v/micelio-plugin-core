import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import { BLOCKS } from '../../contract/blocks'
import catalogueSchema from '../../contract/blocks.schema.json'
import { cleanupStrapi, setupStrapi } from './harness'

const PASSWORD = 'Password1234'

interface Entry {
  id: string
  component: string
  schema: unknown
  options: unknown
  cost: unknown
  static: string
}

describe('the block catalogue route', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-author' },
    })) as { id: number }
    const email = 'author@example.com'
    await strapi.service('admin::user').create({
      email,
      firstname: 'Author',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    token = ((await response.json()) as { data: { token: string } }).data.token
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('answers every block of the catalogue to an admin user', async () => {
    const response = await fetch(`${base}/micelio/blocks`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as { data: Entry[] }
    expect(data.map((entry) => entry.id)).toEqual(BLOCKS.map((block) => block.id))
    for (const entry of data) {
      const block = BLOCKS.find((candidate) => candidate.id === entry.id)
      expect(entry.component).toBe(block?.schema.component)
      expect(entry.options).toEqual(block?.options)
      expect(entry.cost).toEqual(block?.cost)
      expect(entry.static).toBe(block?.static)
      // The schema is the one published in contract/blocks.schema.json.
      expect(entry.schema).toEqual((catalogueSchema.$defs as Record<string, unknown>)[entry.id])
    }
  })

  it('needs an admin user', async () => {
    const response = await fetch(`${base}/micelio/blocks`)
    expect(response.status).toBe(401)
  })
})
