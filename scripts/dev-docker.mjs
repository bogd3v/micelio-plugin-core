// `npm run dev:docker`: writes .env.docker on first run (throwaway secrets), brings up
// compose.dev.yml, waits until every service is healthy and prints where to open it.
// `node scripts/dev-docker.mjs down` stops it and deletes its volumes. docs/operate/manual-testing.md.

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = join(ROOT, '.env.docker')
const COMPOSE = ['compose', '-f', join(ROOT, 'compose.dev.yml'), '--env-file', ENV_FILE]

const secret = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** Writes .env.docker with a new secret per variable, unless it exists. */
function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return
  const lines = [
    '# Written by npm run dev:docker. Throwaway secrets for compose.dev.yml; never committed.',
    `DATABASE_PASSWORD=${secret(18)}`,
    `APP_KEYS=${[1, 2, 3, 4].map(() => secret(16)).join(',')}`,
    `API_TOKEN_SALT=${secret()}`,
    `ADMIN_JWT_SECRET=${secret()}`,
    `TRANSFER_TOKEN_SALT=${secret()}`,
    `ENCRYPTION_KEY=${secret()}`,
    `JWT_SECRET=${secret()}`,
    `FRONTEND_API_TOKEN=${randomBytes(64).toString('hex')}`,
    `PREVIEW_API_TOKEN=${randomBytes(64).toString('hex')}`,
  ]
  writeFileSync(ENV_FILE, `${lines.join('\n')}\n`, { mode: 0o600 })
  console.warn('Wrote .env.docker with new throwaway secrets.')
}

/** The Node major the project uses, for the image of the CMS. */
function nodeVersion() {
  return readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
}

function docker(args) {
  const result = spawnSync('docker', [...COMPOSE, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_VERSION: nodeVersion(),
      HOST_UID: String(process.getuid?.() ?? 1000),
      HOST_GID: String(process.getgid?.() ?? 1000),
    },
  })
  if (result.error) {
    console.error(`Cannot run docker: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

ensureEnvFile()

if (process.argv[2] === 'down') {
  process.exit(docker(['down', '-v']))
}

const status = docker(['up', '--build', '--detach', '--wait', '--wait-timeout', '600'])
if (status !== 0) {
  console.error('The stack did not come up. Read the logs: docker compose -f compose.dev.yml logs')
  process.exit(status)
}

console.warn(`
Admin:     http://localhost:1337/admin
           Strapi asks for the first admin's name, email and password on the first visit.
Frontend:  http://localhost:3000
Site:      "default", host localhost (seeded)
Logs:      docker compose -f compose.dev.yml logs -f cms
Reset:     npm run dev:docker -- down   (deletes the database; the next run seeds again)
`)
