import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// The content types of `micelio-cms` at `v0.4.0` (`git ls-tree v0.4.0` of its `src/api/` and
// `src/plugins/`, and the plugins its `config/plugins.ts` installs), and the `site` type of this
// plugin. `docs/export-format.md` must give each one a row: the acceptance criterion of #9.
const CONTENT_TYPES = [
  'plugin::micelio.site',
  'api::about.about',
  'api::article.article',
  'api::article-stat.article-stat',
  'api::author.author',
  'api::category.category',
  'api::global.global',
  'api::page.page',
  'api::site-setting.site-setting',
  'api::subscriber.subscriber',
  'api::tag.tag',
  'plugin::fediverse.follower',
  'plugin::fediverse.interaction',
  'plugin::comments.comment',
  'plugin::comments.comment-report',
  'plugin::upload.file',
  'plugin::upload.folder',
  'plugin::i18n.locale',
  'plugin::users-permissions.user',
  'plugin::users-permissions.role',
  'plugin::users-permissions.permission',
]

const DOCUMENT = new URL('../docs/export-format.md', import.meta.url)

/** The UIDs in the first column of the tables of the `Content types` section. */
function documentedTypes(markdown: string): string[] {
  const section = markdown.split(/^## Content types$/m)[1]?.split(/^## /m)[0] ?? ''
  return [...section.matchAll(/^\| `([a-z0-9-]+::[a-z0-9.-]+)` +\|/gm)].map(([, uid]) => uid ?? '')
}

describe('the export format specification', () => {
  const documented = documentedTypes(fs.readFileSync(DOCUMENT, 'utf8'))

  it.each(CONTENT_TYPES)('gives %s its serialisation', (uid) => {
    expect(documented).toContain(uid)
  })

  it('documents each type once', () => {
    expect(new Set(documented).size).toBe(documented.length)
  })
})
