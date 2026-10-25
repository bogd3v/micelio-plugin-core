import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/hooks-reference.mjs')
const SOURCE = path.join(ROOT, 'server/src/types/hooks.ts')
const EXTENSIONS = path.join(ROOT, 'server/src/types/extensions.ts')

function lintReference(
  source = SOURCE,
  extensions = EXTENSIONS
): { status: number | null; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--check', '--source', source, '--extensions', extensions],
    {
      encoding: 'utf8',
    }
  )
  return { status: result.status, stderr: result.stderr }
}

describe('npm run lint:reference', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-hooks-'))

  afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('passes while docs/hooks.md is what the TSDoc of the hooks generates', () => {
    expect(lintReference()).toMatchObject({ status: 0 })
  })

  it("fails when a hook's TSDoc changes without regenerating docs/hooks.md", () => {
    const edited = fs
      .readFileSync(SOURCE, 'utf8')
      .replace('Runs after every editorial transition', 'Runs after each editorial transition')
    expect(edited).not.toBe(fs.readFileSync(SOURCE, 'utf8'))
    const source = path.join(directory, 'hooks.ts')
    fs.writeFileSync(source, edited)

    const result = lintReference(source)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/docs\/hooks\.md is out of date .*npm run reference/)
  })

  it("fails when an extension point's TSDoc changes without regenerating docs/hooks.md", () => {
    const edited = fs
      .readFileSync(EXTENSIONS, 'utf8')
      .replace('Adds a page of your plugin', 'Adds one page of your plugin')
    expect(edited).not.toBe(fs.readFileSync(EXTENSIONS, 'utf8'))
    const extensions = path.join(directory, 'extensions.ts')
    fs.writeFileSync(extensions, edited)

    const result = lintReference(SOURCE, extensions)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/docs\/hooks\.md is out of date .*npm run reference/)
  })
})
