import { describe, expect, it } from 'vitest'
import type { CatalogueReport } from '../server/src/types/themes'
import {
  admissionPasses,
  manualCheckDate,
  modeNames,
  themeCards,
  versionChange,
} from '../admin/src/utils/themes'
import { newThemeBehaviour } from './strapi/theme-site'

const report = (extra: Partial<CatalogueReport> = {}): CatalogueReport => ({
  id: 'bogota',
  version: '1.0.0',
  digest: 'sha256:0',
  ok: true,
  summary: '',
  ...extra,
})

describe('the cards of the Themes page', () => {
  it('builds the three lists from the catalogue, the active theme first and a missing name as the id', () => {
    const { catalogue } = newThemeBehaviour()
    const status = {
      active: { id: 'starter', version: '1.2.0', digest: 'd', packageDigest: 'p' },
      requested: null,
      lastGood: null,
      error: null,
      available: { builtIn: [] },
    }
    const cards = themeCards(catalogue, status)
    expect(cards.installed.map(({ name }) => name)).toEqual(['Starter', 'Bogotá'])
    // A registry version takes the name of the installed theme of its id, and its modes only at the same version.
    expect(cards.registry.map(({ name, modes }) => [name, modes?.length ?? 0])).toEqual([
      ['Starter', 0],
      ['sendero', 0],
      ['mosaico', 0],
    ])
    expect(cards.update).toMatchObject([
      { kind: 'update', name: 'Starter', from: '1.2.0', contract: '2.3', code: false },
    ])
    expect(themeCards(null, null)).toEqual({ installed: [], registry: [], update: [] })
  })

  it('names the modes and the change of version, and reads the checks of a report', () => {
    expect(
      modeNames([
        { id: 'claro', scheme: 'light', name: 'Día' },
        { id: 'oscuro', scheme: 'dark' },
      ])
    ).toEqual(['Día', 'oscuro'])
    expect(versionChange('0.2.0', '0.3.0')).toBe('minor')
    expect(versionChange('1.2.0', '2.0.0')).toBe('major')
    expect(versionChange('1.2.0', '1.2.1')).toBe('patch')

    const passed = { static: 'passed', quality: 'passed', performance: 'passed' } as const
    expect(admissionPasses(report({ checks: passed }))).toEqual({ aa: true, budgets: true })
    expect(admissionPasses(report({ checks: { ...passed, quality: 'skipped' } }))).toEqual({
      aa: false,
      budgets: true,
    })
    // An older frontend's report has no checks.
    expect(admissionPasses(report())).toEqual({ aa: false, budgets: false })

    const checked = { status: 'passed', current: true, date: '2026-10-18' } as const
    expect(manualCheckDate(report({ accessibility: checked }))).toBe('2026-10-18')
    expect(manualCheckDate(report({ accessibility: { ...checked, date: null } }))).toBe('')
    expect(manualCheckDate(report({ accessibility: { ...checked, current: false } }))).toBeNull()
    expect(manualCheckDate(report({ accessibility: { ...checked, status: 'partial' } }))).toBeNull()
    expect(manualCheckDate(report({ accessibility: null }))).toBeNull()
    expect(manualCheckDate(undefined)).toBeNull()
  })
})
