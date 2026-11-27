import { describe, expect, it } from 'vitest'
import {
  EMPTY_PIN,
  isPinInstalled,
  isSamePin,
  parseThemeCatalogue,
  parseThemeStatus,
  pinFrom,
  planActivation,
} from '../server/src/themes/rules'
import type { FrontendThemeStatus } from '../server/src/types/themes'
import { newThemeBehaviour } from './strapi/theme-site'

const DIGEST = `sha256:${'a'.repeat(64)}`

function statusOf(behaviour = newThemeBehaviour()): FrontendThemeStatus {
  return {
    active: { id: 'bogota', version: '1.0.0', digest: 'd1', packageDigest: 'p-bogota' },
    requested: null,
    lastGood: null,
    error: null,
    available: { builtIn: behaviour.builtIn },
  }
}

describe('the rules of the Themes page', () => {
  it('lets a theme activate when the frontend lists it as built in, or when it is data-only, and never a code theme the frontend was not built with', () => {
    const behaviour = newThemeBehaviour()
    const status = statusOf(behaviour)
    const { catalogue } = behaviour
    const sendero = catalogue.registry!.find(({ id }) => id === 'sendero')!.versions[0]!

    // Built in: the id alone, whatever the version asked, the code theme of the image included.
    expect(planActivation({ id: 'starter', version: '1.2.0' }, status, catalogue)).toEqual({
      kind: 'pin',
      pin: { themeId: 'starter', themeVersion: null, themeDigest: null },
    })
    expect(planActivation({ id: 'bogota' }, status, catalogue)).toEqual({
      kind: 'pin',
      pin: { themeId: 'bogota', themeVersion: null, themeDigest: null },
    })
    // Data-only from the registry: the version and its package digest, which the frontend installs.
    expect(planActivation({ id: 'sendero', version: '2.1.0' }, status, catalogue)).toEqual({
      kind: 'pin',
      pin: { themeId: 'sendero', themeVersion: '2.1.0', themeDigest: sendero.digest },
    })
    // Another version of a built-in theme is another theme: data-only, pinned in full.
    expect(planActivation({ id: 'starter', version: '1.3.0' }, status, catalogue)).toMatchObject({
      kind: 'pin',
      pin: { themeId: 'starter', themeVersion: '1.3.0' },
    })
    // A data-only theme of the deployment store: its package digest.
    const deployed = {
      ...catalogue,
      installed: [
        ...catalogue.installed,
        {
          id: 'lienzo',
          version: '1.0.0',
          packageDigest: DIGEST,
          contract: '2.3',
          code: false,
          store: 'deployment' as const,
        },
      ],
    }
    expect(planActivation({ id: 'lienzo', version: '1.0.0' }, status, deployed)).toEqual({
      kind: 'pin',
      pin: { themeId: 'lienzo', themeVersion: '1.0.0', themeDigest: DIGEST },
    })

    // A code theme the image was not built with, from the registry or a store: never pinned.
    expect(planActivation({ id: 'mosaico', version: '0.9.0' }, status, catalogue)).toEqual({
      kind: 'rebuild',
    })
    const codeInStore = {
      ...catalogue,
      installed: [{ ...deployed.installed.at(-1)!, code: true }],
    }
    expect(planActivation({ id: 'lienzo', version: '1.0.0' }, status, codeInStore)).toEqual({
      kind: 'rebuild',
    })
    // The image's own code theme at another version is not the image's either.
    const bogotaNext = {
      ...catalogue,
      registry: [
        ...catalogue.registry!,
        { id: 'bogota', versions: [{ ...sendero, version: '2.0.0', code: true }] },
      ],
    }
    expect(planActivation({ id: 'bogota', version: '2.0.0' }, status, bogotaNext)).toEqual({
      kind: 'rebuild',
    })

    // Unknown: not built in and in no catalogue, an id alone that is not built in, a version that does not run here.
    expect(planActivation({ id: 'nadie', version: '1.0.0' }, status, catalogue)).toEqual({
      kind: 'unknown',
    })
    expect(planActivation({ id: 'sendero' }, status, catalogue)).toEqual({ kind: 'unknown' })
    expect(planActivation({ id: 'sendero', version: '2.1.0' }, status, null)).toEqual({
      kind: 'unknown',
    })
    const notRunning = {
      ...catalogue,
      registry: [{ id: 'sendero', versions: [{ ...sendero, runs: false }] }],
    }
    expect(planActivation({ id: 'sendero', version: '2.1.0' }, status, notRunning)).toEqual({
      kind: 'unknown',
    })
  })

  it('tells whether the theme a pin names is still installed', () => {
    const status = statusOf()
    expect(isPinInstalled(EMPTY_PIN, status)).toBe(true)
    expect(isPinInstalled({ ...EMPTY_PIN, themeId: 'starter' }, status)).toBe(true)
    expect(isPinInstalled({ ...EMPTY_PIN, themeId: 'sendero' }, status)).toBe(false)
    const sendero = { themeId: 'sendero', themeVersion: '2.1.0', themeDigest: DIGEST }
    expect(isPinInstalled(sendero, status)).toBe(false)
    const held = { id: 'sendero', version: '2.1.0', digest: 'd2', packageDigest: DIGEST }
    expect(isPinInstalled(sendero, { ...status, lastGood: held })).toBe(true)
    expect(isPinInstalled(sendero, { ...status, active: held })).toBe(true)
    expect(isPinInstalled({ ...sendero, themeId: 'starter', themeVersion: '1.2.0' }, status)).toBe(
      true
    )
  })

  it('reads pins and the frontend answers, leaving out what has another shape', () => {
    expect(pinFrom({ id: 3, themeId: 'starter', themeVersion: '', themeDigest: null })).toEqual({
      themeId: 'starter',
      themeVersion: null,
      themeDigest: null,
    })
    expect(pinFrom(null)).toEqual(EMPTY_PIN)
    expect(isSamePin(EMPTY_PIN, { themeId: '', themeVersion: null, themeDigest: '' })).toBe(true)
    expect(isSamePin(EMPTY_PIN, { ...EMPTY_PIN, themeId: 'starter' })).toBe(false)

    expect(parseThemeStatus(null)).toBeNull()
    expect(parseThemeStatus({ active: { id: 'x' } })).toBeNull()
    const status = parseThemeStatus({
      ...statusOf(),
      available: { builtIn: [{ id: 'starter', code: 'no' }, 7], registry: {} },
      lastGood: 'none',
    })
    expect(status?.available.builtIn).toEqual([{ id: 'starter', version: undefined, code: false }])
    expect(status?.lastGood).toBeNull()

    expect(parseThemeCatalogue({ registry: [] })).toBeNull()
    const catalogue = parseThemeCatalogue({
      installed: [{ id: 'starter', version: '1.2.0', store: 'deployment' }, { id: 1 }],
      registry: null,
      reason: 'the index did not verify',
      updates: 'none',
    })
    expect(catalogue).toEqual({
      installed: [
        {
          id: 'starter',
          version: '1.2.0',
          packageDigest: '',
          contract: '',
          code: false,
          store: 'deployment',
          report: undefined,
        },
      ],
      registry: null,
      reason: 'the index did not verify',
      updates: [],
      reports: [],
    })
    const full = newThemeBehaviour().catalogue
    expect(parseThemeCatalogue(JSON.parse(JSON.stringify(full)))).toEqual(
      JSON.parse(JSON.stringify(full))
    )
  })
})
