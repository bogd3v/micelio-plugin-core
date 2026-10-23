import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { testEnvironment } from '../strapi/harness'

// The test app, whose admin bundle lands in its `build/`, where Strapi serves it from.
const APP_DIR = fileURLToPath(new URL('../strapi/app', import.meta.url))

interface BuildOptions {
  cwd: string
  logger: unknown
  tsconfig: undefined
  bundler: 'vite'
  minify: boolean
  sourcemap: boolean
  stats: boolean
}

/**
 * Builds the admin of the test app, with this plugin's admin in it, once per run.
 *
 * @remarks
 * `strapi build` cannot run here: it looks for a `tsconfig.json` upwards, finds the repository's
 * and tries to compile the app as TypeScript. The build it runs is called directly, with no
 * tsconfig, from Strapi's own files: they are not exported, so a Strapi release that moves them
 * fails this setup, not a test.
 */
export default async function setup(): Promise<void> {
  const require = createRequire(import.meta.url)
  const strapiRoot = path.dirname(require.resolve('@strapi/strapi/package.json'))
  const { build } = require(path.join(strapiRoot, 'dist/src/node/build.js')) as {
    build(options: BuildOptions): Promise<void>
  }
  const { createLogger } = require(path.join(strapiRoot, 'dist/src/cli/utils/logger.js')) as {
    createLogger(options: { silent: boolean }): unknown
  }
  Object.assign(process.env, testEnvironment())
  // Vite resolves the entry Strapi writes (`.strapi/client/app.js`) from the working directory.
  const cwd = process.cwd()
  process.chdir(APP_DIR)
  try {
    await build({
      cwd: APP_DIR,
      logger: createLogger({ silent: true }),
      tsconfig: undefined,
      bundler: 'vite',
      minify: false,
      sourcemap: false,
      stats: false,
    })
  } finally {
    process.chdir(cwd)
  }
}
