import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// compose.dev.yml is read as text: no YAML parser is a dependency of the package.
const COMPOSE = fs.readFileSync(
  fileURLToPath(new URL('../compose.dev.yml', import.meta.url)),
  'utf8'
)

// What stays a number: the ports inside the containers (`PORT: 1337`, the `cms` healthcheck, the
// target of a published port and of the forward, 8080 of the frontend) and nothing on the host.
const CMS = '${CMS_PORT:-1337}'
const FRONTEND = '${FRONTEND_PORT:-3000}'

const lines = COMPOSE.split('\n').filter((line) => !line.trim().startsWith('#'))

describe('compose.dev.yml', () => {
  it('publishes and names its host ports only through CMS_PORT and FRONTEND_PORT, with 1337 and 3000 as defaults', () => {
    // The published ports.
    const published = lines.filter((line) => /^\s*- '127\.0\.0\.1:/.test(line)).map((l) => l.trim())
    expect(published).toEqual([`- '127.0.0.1:${CMS}:1337'`, `- '127.0.0.1:${FRONTEND}:8080'`])

    // Every address of the host in an environment variable, and the forward of the CMS port.
    const origins = lines.filter((line) => /http:\/\/localhost/.test(line))
    expect(origins.length).toBeGreaterThanOrEqual(6)
    for (const line of origins) {
      expect(line).toMatch(/http:\/\/localhost:\$\{(CMS_PORT:-1337|FRONTEND_PORT:-3000)\}\s*$/)
    }
    expect(COMPOSE).toContain(`['node', '/forward.mjs', '${CMS}', 'cms:1337']`)

    // No other `localhost:<number>` or `127.0.0.1:<number>` outside the cms healthcheck, which runs
    // inside its container, and no bare host port once the two defaults are taken out.
    const stripped = lines
      .join('\n')
      .replaceAll(CMS, 'CMS')
      .replaceAll(FRONTEND, 'FRONTEND')
      .replace("fetch('http://127.0.0.1:1337/_health')", 'HEALTHCHECK')
    expect(stripped).not.toMatch(/(localhost|127\.0\.0\.1):\d/)
    expect(stripped).not.toMatch(/\b3000\b/)
    expect(stripped.match(/\b1337\b/g)).toHaveLength(3) // PORT, the published target, the forward target
  })

  it('keeps the default project name, which COMPOSE_PROJECT_NAME overrides', () => {
    expect(COMPOSE).toMatch(/^name: micelio-plugin-core-dev$/m)
  })
})
