// Writes what the pinned Tabler version makes of the contract of icons (ADR-0021): the names, the
// JSON Schema and the index of the package. With `--check` it writes nothing and fails when a
// file drifts, or when the pinned version is not the installed `@tabler/icons`.
//
//   npm run icons:generate   # write contract/icons.names.json, contract/icons.schema.json and packages/icons/index.json
//   npm run lint:icons       # the same, as a check
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  ICON_ALIASES,
  IconCatalogue,
  TABLER_VERSION,
  iconsJsonSchema,
} from '../../../contract/icons'
import { buildIndex } from './index-build'
import { tablerEntries, tablerVersion } from './tabler'

const installed = tablerVersion()

const isCheck = process.argv.includes('--check')
const drifted: string[] = []

if (installed !== TABLER_VERSION) {
  console.error(
    `contract/icons.ts pins Tabler ${TABLER_VERSION} but @tabler/icons ${installed} is installed: pin the same version in both`
  )
  process.exit(1)
}

const index = buildIndex(TABLER_VERSION, tablerEntries(), ICON_ALIASES)
const catalogue = IconCatalogue.parse({
  set: 'tabler',
  version: TABLER_VERSION,
  names: index.icons.map((icon) => icon.name),
  aliases: ICON_ALIASES,
})

// Compact JSON: these are data files of thousands of entries, and prettier ignores them.
write(file('contract/icons.names.json'), catalogue.names)
write(file('contract/icons.schema.json'), iconsJsonSchema(catalogue))
write(file('packages/icons/index.json'), index)

if (drifted.length) {
  console.error(
    `${drifted.join(' and ')} drifted from contract/icons.ts: run npm run icons:generate`
  )
  process.exitCode = 1
}

/** A generated file of the repository, or of the copy `ICONS_ROOT` names (the test of the drift check). */
function file(relative: string): URL {
  const root = process.env.ICONS_ROOT
    ? pathToFileURL(`${process.env.ICONS_ROOT.replace(/\/$/, '')}/`)
    : new URL('../../../', import.meta.url)
  return new URL(relative, root)
}

function write(file: URL, data: unknown): void {
  const text = `${JSON.stringify(data)}\n`
  let current = ''
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    // A missing file is written, or drifted under --check.
  }
  if (current === text) return
  if (isCheck) drifted.push(file.pathname.split('/').slice(-2).join('/'))
  else writeFileSync(file, text)
}
