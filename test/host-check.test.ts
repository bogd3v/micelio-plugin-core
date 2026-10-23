import { describe, expect, it } from 'vitest'
import {
  evaluateHostChecks,
  isCompatibleLine,
  satisfiesEngines,
  type HostFacts,
} from '../server/src/host-check/checks'
import { buildHostCheckReport, formatHostCheckReport } from '../server/src/host-check/report'

const passing: HostFacts = {
  environment: 'production',
  nodeVersion: '24.18.0',
  engines: '>=22.12',
  coreLine: '0.6',
  databaseClient: 'postgres',
  middlewares: ['strapi::logger', 'strapi::errors', 'strapi::security', 'strapi::cors'],
  csp: { 'default-src': ["'self'"], 'frame-src': ["'self'", 'https://example.com'] },
  uploadProvider: 'local',
  sanitiser: 'sanitize-html',
  siteOrigins: ['https://example.com'],
  frontends: [{ origin: 'https://example.com', reachable: true, version: '0.6.2' }],
}

function resultOf(facts: Partial<HostFacts>, id: string) {
  return evaluateHostChecks({ ...passing, ...facts }).find((result) => result.id === id)
}

describe('evaluateHostChecks', () => {
  it('passes every check on a host that has everything', () => {
    const results = evaluateHostChecks(passing)
    expect(results.map(({ id, status }) => [id, status])).toEqual([
      ['node', 'pass'],
      ['database', 'pass'],
      ['security-middlewares', 'pass'],
      ['content-security-policy', 'pass'],
      ['html-sanitiser', 'pass'],
      ['upload-provider', 'pass'],
      ['frontend-release-line', 'pass'],
      ['preview-frame-src', 'pass'],
    ])
  })

  it.each([
    ['node', { nodeVersion: '20.19.0' }],
    ['database', { databaseClient: 'sqlite' }],
    ['security-middlewares', { middlewares: ['strapi::errors', 'strapi::cors'] }],
    ['content-security-policy', { csp: false as const }],
    ['html-sanitiser', { sanitiser: undefined }],
    ['upload-provider', { uploadProvider: undefined }],
  ])('fails the required check %s, with a fix', (id, facts) => {
    const result = resultOf(facts, id)
    expect(result).toMatchObject({ id, required: true, status: 'fail' })
    expect(result?.fix).toBeTruthy()
  })

  it('skips the database outside production', () => {
    expect(
      resultOf({ environment: 'development', databaseClient: 'sqlite' }, 'database')
    ).toMatchObject({
      status: 'skip',
    })
  })

  it('fails a frontend of an older line, as an optional check', () => {
    const frontends = [{ origin: 'https://example.com', reachable: true, version: '0.4.0' }]
    expect(resultOf({ frontends }, 'frontend-release-line')).toMatchObject({
      required: false,
      status: 'fail',
      fix: 'Upgrade https://example.com to release line 0.6.',
    })
  })

  it('skips a frontend that is not reachable or reports no version', () => {
    const frontends = [
      { origin: 'https://example.com', reachable: false },
      { origin: 'https://other.test', reachable: true },
    ]
    expect(resultOf({ frontends }, 'frontend-release-line')).toMatchObject({ status: 'skip' })
    expect(resultOf({ frontends: [], siteOrigins: [] }, 'frontend-release-line')).toMatchObject({
      status: 'skip',
    })
  })

  it('names the site origins that frame-src does not allow', () => {
    const result = resultOf(
      { siteOrigins: ['https://example.com', 'https://other.test'] },
      'preview-frame-src'
    )
    expect(result).toMatchObject({ required: false, status: 'fail' })
    expect(result?.detail).toContain('https://other.test')
    expect(result?.detail).not.toContain('https://example.com')
  })

  it('reads frame-src from default-src when it is not set, and accepts a scheme or *', () => {
    expect(resultOf({ csp: { 'default-src': ["'self'"] } }, 'preview-frame-src')).toMatchObject({
      status: 'fail',
    })
    expect(resultOf({ csp: { 'default-src': ['https:'] } }, 'preview-frame-src')).toMatchObject({
      status: 'pass',
    })
    expect(resultOf({ csp: { 'child-src': ['*'] } }, 'preview-frame-src')).toMatchObject({
      status: 'pass',
    })
  })
})

describe('satisfiesEngines', () => {
  it.each([
    ['24.18.0', '>=22.12', true],
    ['22.12.0', '>=22.12', true],
    ['22.11.9', '>=22.12', false],
    ['24.18.0', '>=22.12.0 <=24.x.x', true],
    ['25.0.0', '>=22.12.0 <=24.x.x', false],
    ['24.0.0', '<24', false],
    ['24.9.0', '24', true],
    ['25.0.0', '>24.x', true],
    ['24.9.0', '>24.x', false],
  ])('%s against %s is %s', (version, range, expected) => {
    expect(satisfiesEngines(version, range)).toBe(expected)
  })

  it('cannot read a range with ||', () => {
    expect(satisfiesEngines('24.0.0', '^22 || ^24')).toBeUndefined()
  })
})

describe('isCompatibleLine', () => {
  it('accepts the same line and the previous minor, nothing else', () => {
    expect(isCompatibleLine('0.6.3', '0.6')).toBe(true)
    expect(isCompatibleLine('0.5.9', '0.6')).toBe(true)
    expect(isCompatibleLine('0.4.0', '0.6')).toBe(false)
    expect(isCompatibleLine('0.7.0', '0.6')).toBe(false)
    expect(isCompatibleLine('1.6.0', '0.6')).toBe(false)
    expect(isCompatibleLine('main', '0.6')).toBe(false)
  })
})

describe('the report', () => {
  const checkedAt = new Date('2026-10-23T00:00:00Z')

  it('is ok when only optional checks fail', () => {
    const results = evaluateHostChecks({ ...passing, csp: { 'default-src': ["'self'"] } })
    expect(buildHostCheckReport(results, 'production', checkedAt).ok).toBe(true)
  })

  it('is not ok when a required check fails, and prints every check with its status', () => {
    const results = evaluateHostChecks({ ...passing, databaseClient: 'mysql' })
    const report = buildHostCheckReport(results, 'production', checkedAt)
    expect(report.ok).toBe(false)
    const text = formatHostCheckReport(report)
    for (const { id } of results) {
      expect(text).toMatch(new RegExp(`^(pass|fail|skip)\\s+${id}`, 'm'))
    }
    expect(text).toContain('fail  database: The database client is mysql.')
  })
})
