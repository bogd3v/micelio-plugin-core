import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanupStrapi, setupStrapi, testEnvironment } from './harness'

const APP_DIR = fileURLToPath(new URL('app', import.meta.url))
const DOCTOR = fileURLToPath(new URL('../../bin/micelio.js', import.meta.url))
const DOCTOR_DATABASE = path.join('.tmp', `doctor-${process.env.VITEST_POOL_ID ?? '1'}.db`)
const CHECK_IDS = [
  'node',
  'database',
  'security-middlewares',
  'content-security-policy',
  'html-sanitiser',
  'upload-provider',
  'frontend-release-line',
  'preview-frame-src',
]

/** Runs `micelio doctor` in the test app, as an operator runs it in a Strapi project. */
async function runDoctor(environment: string): Promise<{ code: number; stdout: string }> {
  const env = {
    ...process.env,
    ...testEnvironment(environment),
    DATABASE_FILENAME: DOCTOR_DATABASE,
  }
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [DOCTOR, 'doctor'], {
      cwd: APP_DIR,
      env,
    })
    return { code: 0, stdout }
  } catch (error) {
    const { code, stdout } = error as { code: number; stdout: string }
    return { code, stdout }
  }
}

describe('the host check in production', () => {
  afterAll(async () => {
    await cleanupStrapi()
  })

  // The harness runs on SQLite, so in production the database check is the one that breaks.
  it('refuses to boot when a required check fails, naming it', async () => {
    await expect(setupStrapi('production')).rejects.toThrow(/host check failed[\s\S]*database/)
  })
})

// Each test boots Strapi in a child process, as long as a hook of the harness takes.
describe('micelio doctor', { timeout: 120_000 }, () => {
  afterAll(() => {
    fs.rmSync(path.join(APP_DIR, DOCTOR_DATABASE), { force: true })
  })

  it('prints every check with its status and exits 0 when the required ones pass', async () => {
    const { code, stdout } = await runDoctor('test')
    for (const id of CHECK_IDS) {
      expect(stdout).toMatch(new RegExp(`^(pass|fail|skip)\\s+${id}\\b`, 'm'))
    }
    expect(stdout).toContain('every required check passes')
    expect(code).toBe(0)
  })

  it('reports a failed required check without refusing, and exits 1', async () => {
    const { code, stdout } = await runDoctor('production')
    expect(stdout).toMatch(/^fail\s+database: The database client is sqlite\./m)
    expect(code).toBe(1)
  })
})
