// A clean Strapi 5 on SQLite with only this plugin installed (test/strapi/app/), booted the way
// micelio-cms's suites boot theirs (its tests/strapi.ts).

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Core } from '@strapi/strapi'

// Strapi is loaded as CommonJS, as a host loads it: its ESM build imports lodash's named exports,
// which Node's ESM loader cannot resolve.
const { createStrapi } = createRequire(import.meta.url)(
  '@strapi/strapi'
) as typeof import('@strapi/strapi')

const APP_DIR = fileURLToPath(new URL('app', import.meta.url))

// One SQLite file per worker: test files run in parallel, and each one starts from an empty
// database. The path is relative to the app, as config/database.js resolves it.
const DATABASE_FILENAME = path.join('.tmp', `test-${process.env.VITEST_POOL_ID ?? '1'}.db`)
const DATABASE_PATH = path.join(APP_DIR, DATABASE_FILENAME)

/**
 * The variables Strapi requires, with values that are only good for tests.
 *
 * @param environment - `NODE_ENV`; `production` turns on the host check's refusals.
 */
export function testEnvironment(environment = 'test'): Record<string, string> {
  return {
    NODE_ENV: environment,
    PORT: '0',
    STRAPI_TELEMETRY_DISABLED: 'true',
    STRAPI_DISABLE_CRON: 'true',
    // The release feed is asked only by the suite that stubs it (test/strapi/about.test.ts).
    MICELIO_UPDATE_CHECK: 'false',
    DATABASE_FILENAME,
    APP_KEYS: 'testKeyOne,testKeyTwo',
    API_TOKEN_SALT: 'test-api-token-salt',
    ADMIN_JWT_SECRET: 'test-admin-jwt-secret',
    TRANSFER_TOKEN_SALT: 'test-transfer-token-salt',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
  }
}

function removeDatabase(): void {
  fs.rmSync(DATABASE_PATH, { force: true })
}

let instance: Core.Strapi | undefined

/**
 * Boots Strapi on an empty database, once per test file.
 *
 * @param environment - `NODE_ENV` of the boot.
 * @param options - `keepDatabase` boots on the file a previous run of this worker left, as a
 * restart does, instead of on an empty one.
 * @returns The running instance; its HTTP server listens on a free port.
 * @throws What the boot threw, once the instance is cleaned up.
 */
export async function setupStrapi(
  environment?: string,
  options: { keepDatabase?: boolean } = {}
): Promise<Core.Strapi> {
  if (instance) return instance
  Object.assign(process.env, testEnvironment(environment))
  if (!options.keepDatabase) removeDatabase()
  // The local upload provider refuses to start without its folder, as in a new Strapi project.
  fs.mkdirSync(path.join(APP_DIR, 'public', 'uploads'), { recursive: true })
  instance = createStrapi({ appDir: APP_DIR, distDir: APP_DIR })
  try {
    await instance.load()
    await instance.start()
  } catch (error) {
    // A refused boot leaves nothing running for the next test file to trip on.
    await cleanupStrapi()
    throw error
  }
  instance.log.level = 'error'
  return instance
}

/**
 * Stops Strapi, closes the database and removes its file.
 *
 * @param options - `keepDatabase` leaves the file for a restart (`setupStrapi`).
 */
export async function cleanupStrapi(options: { keepDatabase?: boolean } = {}): Promise<void> {
  if (!instance) return
  instance.server.httpServer.close()
  await instance.destroy()
  instance = undefined
  if (!options.keepDatabase) removeDatabase()
}
