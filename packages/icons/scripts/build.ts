// Writes `glyphs/outline/<name>.svg` and `glyphs/filled/<name>.svg` of the package from the pinned
// `@tabler/icons`, normalised (ADR-0021, section 2), with the licence texts the package ships:
// `NOTICE` is Tabler's own `LICENSE`, copyright notice included, and `LICENSES/` the texts of the
// repository's. None is committed: `npm run build` makes them, `prepack` too. Nothing is fetched:
// the set is the dependency of the lockfile.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalise, violations } from './normalise'
import { TABLER_ROOT } from './tabler'
import type { GlyphStyle } from '../src/types'

const tabler = TABLER_ROOT
const OUT = new URL('../glyphs/', import.meta.url).pathname

rmSync(OUT, { recursive: true, force: true })
let count = 0
for (const style of ['outline', 'filled'] as const satisfies GlyphStyle[]) {
  mkdirSync(path.join(OUT, style), { recursive: true })
  for (const file of readdirSync(path.join(tabler, 'icons', style))) {
    if (!file.endsWith('.svg')) continue
    const svg = normalise(readFileSync(path.join(tabler, 'icons', style, file), 'utf8'), style)
    const broken = violations(svg)
    if (broken.length) throw new Error(`${style}/${file}: ${broken.join(', ')}`)
    writeFileSync(path.join(OUT, style, file), svg)
    count++
  }
}
const PACKAGE = new URL('../', import.meta.url).pathname
copyFileSync(path.join(tabler, 'LICENSE'), path.join(PACKAGE, 'NOTICE'))
rmSync(path.join(PACKAGE, 'LICENSES'), { recursive: true, force: true })
mkdirSync(path.join(PACKAGE, 'LICENSES'))
for (const id of ['AGPL-3.0-only', 'MIT']) {
  copyFileSync(
    path.join(PACKAGE, '../../LICENSES', `${id}.txt`),
    path.join(PACKAGE, 'LICENSES', `${id}.txt`)
  )
}
process.stdout.write(`${count} glyphs written to packages/icons/glyphs\n`)
