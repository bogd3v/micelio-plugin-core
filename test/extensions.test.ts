import { describe, expect, it } from 'vitest'
import { missingLocales } from '../server/src/extensions'
import {
  parseAdminPage,
  parseExportSection,
  parseSiteSection,
  parseStatusChecks,
} from '../server/src/extensions/validate'
import config from '../server/src/config'
import type { StatusReport } from '../server/src/types/status'
import { diagnosticsText } from '../admin/src/utils/diagnostics'
import { localised } from '../admin/src/utils/localised'

describe('missingLocales', () => {
  it('lists the locales a text lacks, blank ones included', () => {
    expect(missingLocales({ en: 'Fediverse', es: 'Fediverso' })).toEqual([])
    expect(missingLocales({ en: 'Fediverse' })).toEqual(['es'])
    expect(missingLocales({ es: ' ' })).toEqual(['en', 'es'])
  })
})

describe('the registration parsers', () => {
  it('accept a well-formed registration', () => {
    const label = { en: 'A', es: 'B' }
    expect(
      parseAdminPage({ id: 'a-b', group: 'site', label, to: 'a/b-c', permission: 'x::y.z' }).to
    ).toBe('a/b-c')
    expect(
      parseSiteSection({ id: 'a', component: 'cat.name', label, panel: 'p', permission: 'x' }).id
    ).toBe('a')
    expect(parseStatusChecks({ id: 'a', label, permission: 'x', run: () => [] }).id).toBe('a')
    expect(
      parseExportSection({
        id: 'a',
        version: '1.2',
        personalData: false,
        permission: 'x',
        write: () => [],
        read: () => ({}),
      }).version
    ).toBe('1.2')
  })

  it('refuse a bad group, a path with ".." or an uppercase id, naming the field', () => {
    const base = { id: 'a', group: 'site', label: { en: 'A' }, to: 'a', permission: 'x' }
    expect(() => parseAdminPage({ ...base, group: 'menu' })).toThrow(/group/)
    expect(() => parseAdminPage({ ...base, to: '../a' })).toThrow(/to must be/)
    expect(() => parseAdminPage({ ...base, id: 'A' })).toThrow(/id must be/)
    expect(() => parseAdminPage({ ...base, label: {} })).toThrow(/label.en/)
    expect(() => parseStatusChecks({ ...base, run: 'no' })).toThrow(/run must be a function/)
  })
})

describe('the plugin configuration', () => {
  it('defaults the daily refresh to 04:00 and accepts false', () => {
    expect(config.default.statusRefreshRule).toBe('0 4 * * *')
    expect(() => config.validator({ statusRefreshRule: false })).not.toThrow()
    expect(() => config.validator({ statusRefreshRule: '' })).toThrow(/statusRefreshRule/)
  })
})

describe('the admin helpers', () => {
  it('localised falls back to English when a locale is missing', () => {
    expect(localised({ en: 'Page', es: 'Página' }, 'es-MX')).toBe('Página')
    expect(localised({ en: 'Page' }, 'es')).toBe('Page')
    expect(localised({ en: 'Page', es: 'Página' }, 'fr')).toBe('Page')
  })

  it('diagnosticsText has one summary line per plugin and copies no finding', () => {
    const report = {
      plugin: { version: '0.2.0', coreLine: '0.6' },
      hostCheck: { ok: true, results: [] },
      plugins: {
        fediverse: {
          label: { en: 'Fediverse', es: 'Fediverso' },
          ranAt: '2026-10-25T04:00:00.000Z',
          checks: [
            { id: 'a', status: 'ok', site: 's', title: { en: 'secret title', es: '' } },
            {
              id: 'b',
              status: 'warn',
              site: 's',
              title: { en: 'secret title', es: '' },
              detail: { en: 'secret detail', es: '' },
            },
          ],
        },
        idle: { label: { en: 'Idle', es: 'Inactivo' }, ranAt: null, checks: [] },
      },
    } as unknown as StatusReport
    const text = diagnosticsText(report)
    expect(text.split('\n')).toEqual([
      'Micelio 0.2.0 (core release line 0.6)',
      'Host check: ok (0 failed)',
      'fediverse: 1 ok, 1 warn, 0 fail',
      'idle: checks not run',
    ])
    expect(text).not.toContain('secret')
  })
})
