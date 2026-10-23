import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core } from '@strapi/strapi'
import type { HostCheckService } from '../../server/src/services/host-check'
import { cleanupStrapi, setupStrapi } from './harness'

describe('the host check at boot, on a clean Strapi', () => {
  let strapi: Core.Strapi

  beforeAll(async () => {
    strapi = await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('boots, with every required check passing or not applying', () => {
    const report = (strapi.plugin('micelio').service('hostCheck') as HostCheckService).latest()
    expect(report?.ok).toBe(true)
    expect(report?.environment).toBe('test')
    const required = report?.results.filter(({ required: isRequired }) => isRequired) ?? []
    expect(required.map(({ id, status }) => [id, status])).toEqual([
      ['node', 'pass'],
      ['database', 'skip'],
      ['security-middlewares', 'pass'],
      ['content-security-policy', 'pass'],
      ['html-sanitiser', 'pass'],
      ['upload-provider', 'pass'],
    ])
  })
})
