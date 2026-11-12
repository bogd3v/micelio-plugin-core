// Where the pinned `@tabler/icons` is installed. Its `exports` only open `icons/*`, so the root is
// found from a file it does open.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { TablerEntry } from './index-build'

const require = createRequire(import.meta.url)

/** The folder of the installed `@tabler/icons`. */
export const TABLER_ROOT = path.resolve(
  path.dirname(require.resolve('@tabler/icons/outline/a-b-2.svg')),
  '..',
  '..'
)

/** The installed version. */
export function tablerVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(TABLER_ROOT, 'package.json'), 'utf8')) as {
    version: string
  }
  return manifest.version
}

/** Tabler's `icons.json`: every name with its category and tags. */
export function tablerEntries(): Record<string, TablerEntry> {
  return JSON.parse(readFileSync(path.join(TABLER_ROOT, 'icons.json'), 'utf8')) as Record<
    string,
    TablerEntry
  >
}
