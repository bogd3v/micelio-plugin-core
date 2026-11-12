import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import { TABLER_VERSION } from '../contract/icons'

// The package as npm publishes it: packed, unpacked into a node_modules folder, and loaded by
// both of its entry points the way Strapi loads them (`./strapi-server` with `require`, the admin
// bundler with `import`). The folder sits inside the repository so the peer dependencies resolve.

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACK_DIR = path.join(ROOT, '.tmp', `pack-${process.env.VITEST_POOL_ID ?? '1'}`)
const INSTALLED = path.join(PACK_DIR, 'node_modules', ...packageJson.name.split('/'))

interface PackResult {
  filename: string
  files: { path: string }[]
}

interface ServerEntry {
  register: unknown
  bootstrap: unknown
  destroy: unknown
}

interface AdminEntry {
  register: unknown
  registerTrads: unknown
}

/** What Strapi takes from a CommonJS entry (`importDefault` of `@strapi/utils`). */
function defaultOf<T>(loaded: unknown): T {
  const module = loaded as { __esModule?: boolean; default?: T }
  return (module.__esModule ? module.default : loaded) as T
}

describe('the packed package', () => {
  let packed: PackResult
  const requireFromHost = createRequire(path.join(PACK_DIR, 'index.js'))

  beforeAll(() => {
    fs.rmSync(PACK_DIR, { recursive: true, force: true })
    fs.mkdirSync(INSTALLED, { recursive: true })
    // `--ignore-scripts`: the global setup has built `dist/`, and `prepack` would rebuild it under
    // the suites that are loading it. That `prepack` builds is the next test's job.
    const output = execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', PACK_DIR],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    )
    const results = JSON.parse(output) as PackResult[]
    packed = results[0]
    execFileSync('tar', [
      '-xzf',
      path.join(PACK_DIR, packed.filename),
      '-C',
      INSTALLED,
      '--strip-components=1',
    ])
  })

  it('declares the core release line it supports', () => {
    expect(packageJson.micelio).toMatch(/^\d+\.\d+$/)
    expect(packageJson.strapi).toMatchObject({ kind: 'plugin', name: 'micelio' })
  })

  it('check runs lint:ee', () => {
    // Strapi Enterprise code is not AGPL-compatible (THIRD-PARTY.md); only the lockfile may name the patterns.
    expect(packageJson.scripts['lint:ee']).toBe('micelio-lint-ee --allow package-lock.json')
    expect(packageJson.scripts.check.split(' && ')).toContain('npm run lint:ee')
  })

  it('builds the plugin before npm packs it, because the publish job runs no build', () => {
    expect(packageJson.scripts.prepack).toBe('npm run build')
    expect(packageJson.scripts.build).toBe('strapi-plugin build')
  })

  it('ships the built entry points and the licences', () => {
    const files = packed.files.map((file) => file.path)
    expect(files).toEqual(
      expect.arrayContaining([
        'LICENSE',
        'LICENSES/MIT.txt',
        'THIRD-PARTY.md',
        'package.json',
        'strapi-server.js',
        'strapi-admin.js',
        'dist/server/index.js',
        'dist/server/index.mjs',
        'dist/admin/index.js',
        'dist/admin/index.mjs',
      ])
    )
    expect(
      files.filter((file) => file.startsWith('test/') || file.startsWith('server/src/'))
    ).toEqual([])
  })

  it('loads strapi-server.js and its export', () => {
    const fromFile = defaultOf<ServerEntry>(
      requireFromHost(path.join(INSTALLED, 'strapi-server.js'))
    )
    const fromExport = defaultOf<ServerEntry>(requireFromHost(`${packageJson.name}/strapi-server`))
    for (const entry of [fromFile, fromExport]) {
      expect(entry.register).toBeTypeOf('function')
      expect(entry.bootstrap).toBeTypeOf('function')
      expect(entry.destroy).toBeTypeOf('function')
    }
  })

  it('exports the schema helpers a distribution makes its types with', () => {
    const entry = requireFromHost(`${packageJson.name}/strapi-server`) as Record<string, unknown>
    expect(entry.withSiteScope).toBeTypeOf('function')
    expect(entry.withEditorial).toBeTypeOf('function')
    expect(entry.withPageSettings).toBeTypeOf('function')
  })

  it('publishes the JSON Schema of the block catalogue', () => {
    const schema = requireFromHost(`${packageJson.name}/blocks.schema.json`) as {
      $defs: Record<string, unknown>
    }
    expect(Object.keys(schema.$defs)).toContain('hero')
  })

  it('loads strapi-admin.js and its export', async () => {
    const fromFile = defaultOf<AdminEntry>(requireFromHost(path.join(INSTALLED, 'strapi-admin.js')))
    const fromImport = (await import(
      pathToFileURL(path.join(INSTALLED, 'dist/admin/index.mjs')).href
    )) as { default: AdminEntry }
    for (const entry of [fromFile, fromImport.default]) {
      expect(entry.register).toBeTypeOf('function')
      expect(entry.registerTrads).toBeTypeOf('function')
    }
  })
})

describe('the packed icons package', () => {
  const ICONS_PACK_DIR = path.join(ROOT, '.tmp', `pack-icons-${process.env.VITEST_POOL_ID ?? '1'}`)
  const ICONS_INSTALLED = path.join(ICONS_PACK_DIR, 'node_modules', '@micelio', 'icons')
  let files: string[]

  beforeAll(() => {
    fs.rmSync(ICONS_PACK_DIR, { recursive: true, force: true })
    fs.mkdirSync(ICONS_INSTALLED, { recursive: true })
    // `--ignore-scripts`: the global setup has built the glyphs and `dist/`.
    const output = execFileSync(
      'npm',
      [
        'pack',
        '-w',
        '@micelio/icons',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        ICONS_PACK_DIR,
      ],
      { cwd: ROOT, encoding: 'utf8' }
    )
    const [packed] = JSON.parse(output) as PackResult[]
    files = packed.files.map((file) => file.path)
    execFileSync('tar', [
      '-xzf',
      path.join(ICONS_PACK_DIR, packed.filename),
      '-C',
      ICONS_INSTALLED,
      '--strip-components=1',
    ])
  })

  it("the icons package ships LICENSES/MIT.txt and Tabler's notice", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'LICENSES/MIT.txt',
        'LICENSES/AGPL-3.0-only.txt',
        'NOTICE',
        'THIRD-PARTY.md',
        'package.json',
      ])
    )
    const notice = fs.readFileSync(path.join(ICONS_INSTALLED, 'NOTICE'), 'utf8')
    expect(notice).toContain('Copyright (c) 2020-2026 Paweł Kuna')
    expect(notice).toContain(
      'The above copyright notice and this permission notice shall be included'
    )
    const thirdParty = fs.readFileSync(path.join(ICONS_INSTALLED, 'THIRD-PARTY.md'), 'utf8')
    expect(thirdParty).toContain(`Tabler Icons`)
    expect(thirdParty).toContain(`**Version:** ${TABLER_VERSION}`)
    // The plugin's own list names the pinned version too.
    expect(fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8')).toContain(
      `Tabler Icons ${TABLER_VERSION}`
    )
  })

  it('ships the glyphs, the index and the entry, and none of the build', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'dist/index.js',
        'dist/index.d.ts',
        'index.json',
        'labels/es.json',
        'glyphs/outline/map-pin.svg',
        'glyphs/filled/map-pin.svg',
      ])
    )
    expect(files.filter((file) => /^(scripts|test|src|labels\/core-names)/.test(file))).toEqual([])
    expect(files.filter((file) => file.startsWith('glyphs/outline/')).length).toBeGreaterThan(5000)
  })

  it('loads from the tarball and answers a glyph', async () => {
    const entry = (await import(
      pathToFileURL(path.join(ICONS_INSTALLED, 'dist/index.js')).href
    )) as {
      readGlyph(name: string): Promise<string | undefined>
    }
    expect(await entry.readGlyph('map-pin')).toContain('viewBox="0 0 24 24"')
  })
})
