import { describe, expect, it } from 'vitest'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'
import { checkText } from '../admin/src/utils/checkText'
import { BLOCKS } from '../contract/blocks'
import { EDITORIAL_STATES } from '../server/src/constants/editorial'
import { evaluateHostChecks, type HostFacts } from '../server/src/host-check/checks'
import { contractsOf, describeSiblings } from '../server/src/status/siblings'
import type { HostCheckResult } from '../server/src/types/host-check'

const FACTS: HostFacts = {
  environment: 'production',
  nodeVersion: '24.18.0',
  engines: '>=22.12',
  coreLine: '0.6',
  databaseClient: 'sqlite',
  middlewares: [],
  csp: false,
  siteOrigins: ['https://example.com'],
  frontends: [{ origin: 'https://example.com', reachable: true, version: '0.4.0' }],
}

const isKnown = (id: string) => Object.hasOwn(en, id)

describe('the status page strings', () => {
  it('has every string in English and Spanish', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })

  it('translates the title and the fix of every check the host check runs', () => {
    // Facts on which every check fails, so each one has a fix.
    for (const result of evaluateHostChecks(FACTS).filter(({ id }) => id !== 'node')) {
      expect(result.status).toBe('fail')
      expect(checkText(result, 'title', isKnown)).toEqual({
        messageId: `status.hostCheck.check.${result.id}.title`,
      })
      expect(checkText(result, 'fix', isKnown)).toEqual({
        messageId: `status.hostCheck.check.${result.id}.fix`,
      })
    }
    const ids = evaluateHostChecks(FACTS).map(({ id }) => id)
    expect(ids.every((id) => isKnown(`status.hostCheck.check.${id}.fix`))).toBe(true)
  })

  it("falls back to the server's text for a check it has no message for", () => {
    const result: HostCheckResult = {
      id: 'a-newer-check',
      title: 'A newer check',
      required: false,
      status: 'fail',
      detail: 'It failed.',
      fix: 'Do this.',
    }
    expect(checkText(result, 'title', isKnown)).toEqual({ text: 'A newer check' })
    expect(checkText(result, 'fix', isKnown)).toEqual({ text: 'Do this.' })
    expect(checkText({ ...result, fix: undefined }, 'fix', isKnown)).toBeNull()
  })
})

describe('the sibling plugins and the contracts of the status report', () => {
  const fediverse = { id: 'fediverse', name: '@micelio/strapi-plugin-fediverse', version: '0.7.0' }
  const quiet = { id: 'quiet', name: '@micelio/strapi-plugin-quiet', version: '1.2.3' }
  const registration = (id: string, plugin: string) => ({
    id,
    permission: `plugin::${plugin}.read`,
  })

  it('reports the sibling plugins with what each one registered', () => {
    const siblings = describeSiblings([fediverse, quiet], {
      adminPages: [registration('fediverse', 'fediverse')],
      siteSections: [registration('fediverse-actor', 'fediverse')],
      statusChecks: [registration('fediverse-checks', 'fediverse'), registration('other', 'other')],
      exportSections: [registration('fediverse-follows', 'fediverse')],
    })
    expect(siblings).toEqual([
      {
        name: '@micelio/strapi-plugin-fediverse',
        version: '0.7.0',
        adminPages: ['fediverse'],
        siteSections: ['fediverse-actor'],
        statusChecks: ['fediverse-checks'],
        exportSections: ['fediverse-follows'],
        hidden: false,
      },
      {
        name: '@micelio/strapi-plugin-quiet',
        version: '1.2.3',
        adminPages: [],
        siteSections: [],
        statusChecks: [],
        exportSections: [],
        hidden: false,
      },
    ])
    expect(
      describeSiblings([], {
        adminPages: [],
        siteSections: [],
        statusChecks: [],
        exportSections: [],
      })
    ).toEqual([])
  })

  it('leaves out the ids the caller may not see and says that some were', () => {
    const registrations = {
      adminPages: [registration('fediverse', 'fediverse')],
      siteSections: [{ id: 'fediverse-actor', permission: 'plugin::fediverse.actor' }],
      statusChecks: [],
      exportSections: [],
    }
    const can = (permission: string) => permission === 'plugin::fediverse.read'
    // Some hidden: the rest is listed. All hidden: empty lists, and still `hidden`.
    expect(describeSiblings([fediverse, quiet], registrations, can)).toMatchObject([
      { adminPages: ['fediverse'], siteSections: [], hidden: true },
      { adminPages: [], siteSections: [], hidden: false },
    ])
    expect(describeSiblings([fediverse], registrations, () => false)).toMatchObject([
      { adminPages: [], siteSections: [], statusChecks: [], exportSections: [], hidden: true },
    ])
  })

  it('reports the contracts this core exposes', () => {
    expect(contractsOf()).toEqual({
      blocks: BLOCKS.length,
      editorialStates: [...EDITORIAL_STATES],
      hooks: [
        'beforeTransition',
        'afterTransition',
        'afterPublish',
        'afterUnpublish',
        'siteCreated',
        'blockCatalogueChanged',
      ],
      extensionPoints: [
        'registerAdminPage',
        'registerSiteSection',
        'registerStatusChecks',
        'registerExportSection',
      ],
    })
  })
})
