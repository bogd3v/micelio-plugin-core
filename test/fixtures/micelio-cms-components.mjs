// Writes the fixture the block catalogue is tested against: the JSON of the components of
// `micelio-cms` under `src/components/section` and `shared` at one tag, keyed by UID. Test data
// only: it is never registered as a Strapi component (epic #1: no content type copied from
// `micelio-cms`).
//
//   node test/fixtures/micelio-cms-components.mjs <micelio-cms checkout> <tag>
//
// A catalogue update regenerates it from the new tag in the same pull request.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import prettier from 'prettier'

const CATEGORIES = ['section', 'shared']

const [checkout, tag] = process.argv.slice(2)
if (!checkout || !tag)
  throw new Error('usage: micelio-cms-components.mjs <micelio-cms checkout> <tag>')

const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' })
const commit = git('rev-parse', `${tag}^{commit}`).trim()
const components = {}
for (const category of CATEGORIES) {
  const files = git('ls-tree', '--name-only', `${tag}:src/components/${category}`).split('\n')
  for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
    const uid = `${category}.${file.replace(/\.json$/, '')}`
    components[uid] = JSON.parse(git('show', `${tag}:src/components/${category}/${file}`))
  }
}
const fixture = { source: { repository: 'bogd3v/micelio-cms', tag, commit }, components }
const out = new URL(`micelio-cms-${tag}-components.json`, import.meta.url)
const options = await prettier.resolveConfig(out)
writeFileSync(out, await prettier.format(JSON.stringify(fixture), { ...options, parser: 'json' }))
console.warn(
  `${Object.keys(components).length} components of ${tag} (${commit}) in ${out.pathname}`
)
