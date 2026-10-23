import { describe, expect, it } from 'vitest'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'
import { checkText } from '../admin/src/utils/checkText'
import { evaluateHostChecks, type HostFacts } from '../server/src/host-check/checks'
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
