import { describe, expect, it } from 'vitest'
import { exportNameOf, exportPolicyOf, isWritten } from '../server/src/site-export/names'

describe('exportNameOf', () => {
  it.each([
    ['api::article.article', 'article'],
    ['plugin::micelio.site', 'site'],
    ['plugin::fediverse.follower', 'fediverse.follower'],
    ['plugin::comments.comment-report', 'comments.comment-report'],
  ])('names %s %s', (uid, name) => {
    expect(exportNameOf(uid, { info: { singularName: uid.split('.').at(-1)! } })).toBe(name)
  })

  it('takes the name a type declares', () => {
    expect(
      exportNameOf('api::post.post', { pluginOptions: { micelio: { exportName: 'article' } } })
    ).toBe('article')
  })

  it('refuses a name that is not a safe file name', () => {
    expect(() =>
      exportNameOf('api::post.post', { pluginOptions: { micelio: { exportName: '../post' } } })
    ).toThrow(/export name/)
  })
})

describe('exportPolicyOf', () => {
  it.each([
    [{ type: 'string' }, 'always'],
    [{ type: 'string', private: true }, 'never'],
    [
      { type: 'email', private: true, pluginOptions: { micelio: { export: 'personal' } } },
      'personal',
    ],
    [{ type: 'string', pluginOptions: { micelio: { export: 'never' } } }, 'never'],
    [{ type: 'password', pluginOptions: { micelio: { export: 'personal' } } }, 'never'],
  ])('reads %j as %s', (declared, policy) => {
    expect(exportPolicyOf(declared)).toBe(policy)
  })

  it('writes personal data only in a personal archive', () => {
    expect([isWritten('personal', false), isWritten('personal', true)]).toEqual([false, true])
    expect([isWritten('never', true), isWritten('always', false)]).toEqual([false, true])
  })
})
