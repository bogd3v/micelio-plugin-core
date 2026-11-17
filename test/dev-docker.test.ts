import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/dev-docker.mjs', import.meta.url))

let dir: string
let script: string
let record: string

// The script lives in a scratch project (it reads `.nvmrc` and writes `.env.docker` next to its
// `scripts/` folder), with a fake `docker` first on PATH that records its environment: no
// container starts and the working tree is not touched.
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-docker-'))
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.mkdirSync(path.join(dir, 'bin'))
  script = path.join(dir, 'scripts', 'dev-docker.mjs')
  fs.copyFileSync(SCRIPT, script)
  fs.writeFileSync(path.join(dir, '.nvmrc'), '22\n')
  record = path.join(dir, 'record.txt')
  const fake = path.join(dir, 'bin', 'docker')
  fs.writeFileSync(
    fake,
    `#!/bin/sh\necho "HOST_UID=$HOST_UID HOST_GID=$HOST_GID" >> "${record}"\n`,
    { mode: 0o755 }
  )
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function run(env: Record<string, string>) {
  fs.rmSync(record, { force: true })
  const base: Record<string, string | undefined> = { ...process.env }
  for (const name of [
    'HOST_UID',
    'HOST_GID',
    'CMS_PORT',
    'FRONTEND_PORT',
    'COMPOSE_PROJECT_NAME',
  ]) {
    delete base[name]
  }
  const result = spawnSync(process.execPath, [script, 'down'], {
    env: { ...base, ...env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}` },
    encoding: 'utf8',
  })
  const recorded = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim() : ''
  return { status: result.status, stderr: result.stderr, recorded }
}

describe('scripts/dev-docker.mjs', () => {
  it('keeps HOST_UID and HOST_GID set by the user', () => {
    const { status, recorded } = run({ HOST_UID: '0', HOST_GID: '0' })
    expect(status).toBe(0)
    expect(recorded).toBe('HOST_UID=0 HOST_GID=0')
  })

  it('keeps ids that differ from the host ids', () => {
    const { status, recorded } = run({ HOST_UID: '4242', HOST_GID: '4343' })
    expect(status).toBe(0)
    expect(recorded).toBe('HOST_UID=4242 HOST_GID=4343')
  })

  it('uses the host ids when HOST_UID is not set', () => {
    const { status, recorded } = run({})
    expect(status).toBe(0)
    expect(recorded).toBe(
      `HOST_UID=${process.getuid?.() ?? 1000} HOST_GID=${process.getgid?.() ?? 1000}`
    )
  })

  it('rejects a HOST_UID that is not a number', () => {
    const { status, stderr, recorded } = run({ HOST_UID: 'abc' })
    expect(status).toBe(1)
    expect(stderr).toContain('HOST_UID')
    expect(recorded).toBe('')
  })

  it('rejects a HOST_GID that is not a number', () => {
    const { status, stderr, recorded } = run({ HOST_GID: '-1' })
    expect(status).toBe(1)
    expect(stderr).toContain('HOST_GID')
    expect(recorded).toBe('')
  })
})
