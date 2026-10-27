// The command of the `cms` service: keeps the plugin's `dist/` built from the mounted sources and
// runs `strapi develop` on it. Strapi watches this project only, so a rebuild of the plugin touches
// `reload.txt` here to restart it.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { forward } from './forward.mjs'

const PLUGIN = '/plugin'
const DIST = join(PLUGIN, 'dist')
const PROJECT = join(PLUGIN, 'docker', 'cms')
const RELOAD_FILE = join(PROJECT, 'reload.txt')
// The components of micelio-cms the block catalogue is tested against (test/fixtures/). The page
// fixture lists them all because the frontend populates every section it knows.
const COMPONENTS_FIXTURE = join(PLUGIN, 'test', 'fixtures', 'micelio-cms-v0.4.0-components.json')
const BUNDLES = [join(DIST, 'server', 'index.js'), join(DIST, 'admin', 'index.js')]

// A rebuild writes `dist/` in several steps (bundles, then declarations): Strapi loads it only after this long without a write.
const QUIET_MS = 8000

const REQUIRED = [
  'DATABASE_PASSWORD',
  'APP_KEYS',
  'API_TOKEN_SALT',
  'ADMIN_JWT_SECRET',
  'TRANSFER_TOKEN_SALT',
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'FRONTEND_API_TOKEN',
]

// compose.dev.yml passes them empty so `down` and `logs` work without .env.docker; `up` without it stops here.
const missing = REQUIRED.filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`Missing ${missing.join(', ')}. Run npm run dev:docker, which writes .env.docker.`)
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function newestChange(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).reduce((newest, entry) => {
      const path = join(dir, entry.name)
      return Math.max(newest, entry.isDirectory() ? newestChange(path) : statSync(path).mtimeMs)
    }, 0)
  } catch {
    // The build deleted it while it was being read; the next poll sees the result.
    return 0
  }
}

/** Waits for both bundles to exist and for the first build to stop writing, so Strapi never loads a half-written `dist/`. */
async function waitForFirstBuild() {
  for (;;) {
    await sleep(1000)
    const isBuilt = BUNDLES.every((bundle) => existsSync(bundle))
    if (isBuilt && Date.now() - newestChange(DIST) > QUIET_MS) return
  }
}

// The fixture is micelio-cms v0.4.0, whose category and tag are `api::` types of the host. The core
// owns them now, under the UIDs micelio-cms 0.5 stores, and `post-list` points at those.
const TAXONOMY_UIDS = {
  'api::category.category': 'plugin::micelio.category',
  'api::tag.tag': 'plugin::micelio.tag',
}

/** Writes the fixture's components into the project's `src/components/` (gitignored), where Strapi loads them from. */
function writeComponents() {
  const { components } = JSON.parse(readFileSync(COMPONENTS_FIXTURE, 'utf8'))
  for (const [uid, schema] of Object.entries(components)) {
    const [category, name] = uid.split('.')
    const folder = join(PROJECT, 'src', 'components', category)
    mkdirSync(folder, { recursive: true })
    let text = `${JSON.stringify(schema, null, 2)}\n`
    for (const [legacy, current] of Object.entries(TAXONOMY_UIDS))
      text = text.replaceAll(legacy, current)
    writeFileSync(join(folder, `${name}.json`), text)
  }
}

// The site's `url` is the frontend as a browser reaches it (`http://localhost:3000`), and at publish the
// plugin asks that address for the weight of the page from this server, where `localhost` is this
// container. A forward from that port to the `frontend` service makes the one `url` work for both.
if (process.env.FRONTEND_FORWARD && process.env.FRONTEND_ORIGIN) {
  forward(Number(new URL(process.env.FRONTEND_ORIGIN).port), process.env.FRONTEND_FORWARD)
}

const watcher = spawn('npm', ['run', 'dev'], { cwd: PLUGIN, stdio: 'inherit' })
await waitForFirstBuild()

mkdirSync(join(PROJECT, 'public', 'uploads'), { recursive: true })
writeComponents()
const strapi = spawn('npx', ['strapi', 'develop'], { cwd: PROJECT, stdio: 'inherit' })

// Polls instead of `fs.watch`: a rebuild deletes folders, which makes a recursive watch throw.
let seen = newestChange(DIST)
setInterval(() => {
  const latest = newestChange(DIST)
  // 0 and a missing bundle mean a rebuild is emptying `dist/`: wait for it.
  if (latest === 0 || !BUNDLES.every((bundle) => existsSync(bundle))) return
  if (latest === seen || Date.now() - latest < QUIET_MS) return
  seen = latest
  writeFileSync(RELOAD_FILE, `${new Date().toISOString()}\n`)
}, 1000)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    watcher.kill(signal)
    strapi.kill(signal)
  })
}
strapi.on('exit', (code) => {
  watcher.kill()
  // Always a failure: Strapi stopped on its own (a build that does not boot), and `restart: on-failure` starts it again.
  process.exit(code || 1)
})
