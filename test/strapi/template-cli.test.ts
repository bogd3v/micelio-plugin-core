import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { testEnvironment } from './harness'

const CLI = fileURLToPath(new URL('../../bin/micelio.js', import.meta.url))
const APP_DIR = fileURLToPath(new URL('app', import.meta.url))
const DATABASE = path.join('.tmp', 'template-cli.db')

/** Runs `micelio template …` in the test app, as an operator runs it in a Strapi project. */
async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env, ...testEnvironment(), DATABASE_FILENAME: DATABASE }
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [CLI, 'template', ...args],
      { cwd: APP_DIR, env }
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string }
    return { code, stdout, stderr }
  }
}

const TEMPLATE = {
  format: 1,
  name: 'Explainer landing',
  description: 'A grid and a text.',
  pageTypes: ['landing'],
  scope: 'site',
  origin: 'site',
  version: 3,
  blocks: [
    {
      block: 'feature-grid',
      component: 'section.feature-grid',
      content: 'sample',
      fixed: true,
      data: { title: 'Why', columns: '4', density: 'compact' },
    },
    {
      block: 'rich-text',
      component: 'section.rich-text',
      content: 'clear',
      fixed: false,
      data: {},
    },
  ],
}

// Each test boots Strapi in a child process.
describe('micelio template', { timeout: 120_000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-template-cli-'))

  afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true })
    fs.rmSync(path.join(APP_DIR, DATABASE), { force: true })
  })

  it('imports a template file on a site, and exports it by name as the same file', async () => {
    const file = path.join(directory, 'in.json')
    fs.writeFileSync(file, JSON.stringify(TEMPLATE))
    const imported = await run('import', file, '--site', 'default')
    expect(imported.code).toBe(0)
    expect(imported.stdout).toMatch(/^Explainer landing \(\w+\), version 3\.$/m)

    const output = path.join(directory, 'out.json')
    const exported = await run(
      'export',
      'Explainer landing',
      '--site',
      'default',
      '--output',
      output
    )
    expect(exported.code).toBe(0)
    expect(exported.stdout.trim()).toBe(output)
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual(TEMPLATE)
  })

  it('refuses a name it cannot find, a missing site and a file that is no template', async () => {
    const missing = await run('export', 'Ghost', '--site', 'default')
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('There is no template "Ghost"')

    const file = path.join(directory, 'bad.json')
    fs.writeFileSync(file, JSON.stringify({ name: 'x' }))
    const bad = await run('import', file, '--site', 'default')
    expect(bad.code).toBe(1)

    const noSite = await run('import', file)
    expect(noSite.code).toBe(2)
    expect(noSite.stderr).toContain('Usage:')
  })
})
