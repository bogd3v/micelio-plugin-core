import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { testEnvironment } from './harness'
import { jsonOf, untar, type Manifest } from './site-archive'

const CLI = fileURLToPath(new URL('../../bin/micelio.js', import.meta.url))
const APP_DIR = fileURLToPath(new URL('app', import.meta.url))
const DATABASE = path.join('.tmp', 'export-cli.db')

/** Runs `micelio export default …` in the test app, as an operator runs it in a Strapi project. */
async function runExport(
  output: string,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env, ...testEnvironment(), DATABASE_FILENAME: DATABASE }
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [CLI, 'export', 'default', '--output', output, ...args],
      { cwd: APP_DIR, env }
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string }
    return { code, stdout, stderr }
  }
}

// Each test boots Strapi in a child process.
describe('micelio export', { timeout: 120_000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-cli-'))

  afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true })
    fs.rmSync(path.join(APP_DIR, DATABASE), { force: true })
  })

  it('leaves a section with personal data out by default', async () => {
    const output = path.join(directory, 'plain.tar.gz')
    const result = await runExport(output)
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain('fixture-members')
    const files = untar(fs.readFileSync(output))
    expect(jsonOf<Manifest & { plugins: unknown[] }>(files, 'manifest.json').plugins).toEqual([])
  })

  it('includes it with --include <id>', async () => {
    const output = path.join(directory, 'with.tar.gz')
    const result = await runExport(output, '--include', 'fixture-members')
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/sections: fixture-members, with personal data\./)
    const files = untar(fs.readFileSync(output))
    expect(files.has('plugins/fixture-members/members.json')).toBe(true)
  })

  it('refuses a section nobody registered, with its code', async () => {
    const result = await runExport(path.join(directory, 'none.tar.gz'), '--include', 'ghost')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('exportSectionUnknown')
  })
})
