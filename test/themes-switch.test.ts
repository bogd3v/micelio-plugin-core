import { describe, expect, it } from 'vitest'
import type { FrontendThemeStatus } from '../server/src/types/themes'
import { switchOutcome } from '../admin/src/utils/themes'

const identity = (id: string) => ({
  id,
  version: '1.0.0',
  digest: `d-${id}`,
  packageDigest: `p-${id}`,
})
const failure = (id: string, at: string): NonNullable<FrontendThemeStatus['error']> => ({
  rule: 'code',
  message: `${id} ships code`,
  at,
  requested: { id },
})
const status = (
  active: string,
  requested: string | null,
  error: FrontendThemeStatus['error'] = null
): FrontendThemeStatus => ({
  active: identity(active),
  requested: requested ? { id: requested } : null,
  lastGood: null,
  error,
  available: { builtIn: [] },
})

describe('where a change of the theme stands', () => {
  it('takes only a frontend error that came after the write as the change failure', () => {
    const earlier = failure('mosaico', '2026-11-26T10:00:00.000Z')
    // A retry of the theme that failed before: the earlier error is not this change's answer.
    expect(switchOutcome({ id: 'mosaico' }, status('bogota', 'mosaico', earlier), earlier)).toEqual(
      {
        kind: 'waiting',
      }
    )
    // A new failure for it is.
    const later = failure('mosaico', '2026-11-26T10:05:00.000Z')
    expect(switchOutcome({ id: 'mosaico' }, status('bogota', 'mosaico', later), earlier)).toEqual({
      kind: 'failed',
      message: 'mosaico ships code',
    })
    // A revert to the default theme after a failed activation: the error left from it is not the revert's.
    expect(switchOutcome(null, status('bogota', 'mosaico', earlier), earlier)).toEqual({
      kind: 'waiting',
    })
    expect(switchOutcome(null, status('bogota', null, earlier), earlier)).toEqual({ kind: 'done' })
    // An error that names another theme is not this change's either.
    expect(switchOutcome({ id: 'starter' }, status('bogota', 'starter', later), null)).toEqual({
      kind: 'waiting',
    })
    expect(
      switchOutcome({ id: 'starter' }, status('starter', 'starter', earlier), earlier)
    ).toEqual({
      kind: 'done',
    })
    expect(switchOutcome({ id: 'starter' }, null, null)).toEqual({ kind: 'waiting' })
  })
})
