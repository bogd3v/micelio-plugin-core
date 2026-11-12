import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ICONS,
  ICON_ALIASES,
  ICON_SET,
  IconCatalogue,
  TABLER_VERSION,
  iconsJsonSchema,
  resolveIconName,
} from '../contract/icons'
import { buildIndex, englishLabel, type TablerEntry } from '../packages/icons/scripts/index-build'
import { tablerEntries, tablerVersion } from '../packages/icons/scripts/tabler'
import type { IconIndex } from '../packages/icons/src/types'
import iconsPackage from '../packages/icons/package.json'
import iconsSchema from '../contract/icons.schema.json'

const GLYPHS = path.resolve(__dirname, '../packages/icons/glyphs')
const readIndex = (): IconIndex =>
  JSON.parse(readFileSync(path.resolve(__dirname, '../packages/icons/index.json'), 'utf8'))

describe('contract/icons.ts', () => {
  it('every name of contract/icons.ts has a glyph in @micelio/icons and every alias points to a name', () => {
    expect(IconCatalogue.safeParse(ICONS).success).toBe(true)
    expect(ICONS.set).toBe('tabler')
    const missing = ICONS.names.filter(
      (name) => !existsSync(path.join(GLYPHS, 'outline', `${name}.svg`))
    )
    expect(missing).toEqual([])
    const names = new Set(ICONS.names)
    for (const [old, name] of Object.entries(ICON_ALIASES)) {
      expect(names.has(name), `${old} points to ${name}`).toBe(true)
      expect(names.has(old), `${old} is also a name`).toBe(false)
      expect(resolveIconName(old)).toBe(name)
    }
    // The pin: the contract, the dev dependency and the installed set are one version.
    expect(TABLER_VERSION).toBe(tablerVersion())
    expect(iconsPackage.devDependencies['@tabler/icons']).toBe(TABLER_VERSION)
    expect(readIndex().version).toBe(TABLER_VERSION)
    expect(ICONS.names).toEqual(readIndex().icons.map((icon) => icon.name))
  })

  it('refuses an alias that is a name, one that points nowhere and a name listed twice', () => {
    const base = { set: ICON_SET, version: '1.0.0', names: ['leaf', 'tree'] }
    expect(IconCatalogue.safeParse({ ...base, aliases: { plant: 'leaf' } }).success).toBe(true)
    expect(IconCatalogue.safeParse({ ...base, aliases: { tree: 'leaf' } }).success).toBe(false)
    expect(IconCatalogue.safeParse({ ...base, aliases: { plant: 'shrub' } }).success).toBe(false)
    expect(IconCatalogue.safeParse({ ...base, names: ['leaf', 'leaf'], aliases: {} }).success).toBe(
      false
    )
    expect(IconCatalogue.safeParse({ ...base, set: 'lucide', aliases: {} }).success).toBe(false)
    expect(IconCatalogue.safeParse({ ...base, names: ['Leaf'], aliases: {} }).success).toBe(false)
  })

  it('resolves a stored name to the glyph it draws, an alias included', () => {
    const catalogue = { names: ['leaf', 'tree'], aliases: { plant: 'leaf' } }
    expect(resolveIconName('leaf', catalogue)).toBe('leaf')
    expect(resolveIconName('plant', catalogue)).toBe('leaf')
    expect(resolveIconName('shrub', catalogue)).toBeUndefined()
    expect(resolveIconName('map-pin')).toBe('map-pin')
    // A name of Object.prototype is not a name, and not an alias.
    expect(resolveIconName('constructor', catalogue)).toBeUndefined()
    expect(resolveIconName('toString')).toBeUndefined()
  })

  it('publishes a JSON Schema in which a name is one of the pinned ones', () => {
    expect(iconsSchema).toEqual(JSON.parse(JSON.stringify(iconsJsonSchema(ICONS))))
    const schema = JSON.stringify(iconsSchema)
    expect(schema).toContain('"map-pin"')
    expect(schema).toContain(`"${TABLER_VERSION}"`)
  })
})

describe('the index of @micelio/icons', () => {
  it('the index has an English label, a category and the aliases of every name', () => {
    const index = readIndex()
    expect(index.icons).toHaveLength(ICONS.names.length)
    for (const entry of index.icons) {
      expect(entry.label, entry.name).toBe(englishLabel(entry.name))
      expect(entry.label.length).toBeGreaterThan(0)
      expect(index.categories, entry.name).toContain(entry.category)
      expect(Array.isArray(entry.aliases), entry.name).toBe(true)
      expect(typeof entry.filled).toBe('boolean')
    }
    expect(index.icons.some((entry) => entry.aliases.length > 0)).toBe(true)
    const filled = index.icons.filter((entry) => entry.filled)
    expect(filled.length).toBeGreaterThan(1000)
    for (const entry of filled) {
      expect(existsSync(path.join(GLYPHS, 'filled', `${entry.name}.svg`)), entry.name).toBe(true)
    }
  })

  it('carries the names a rename replaced as aliases of the new one', () => {
    const tabler: Record<string, TablerEntry> = {
      leaf: { name: 'leaf', category: 'Nature', tags: ['plant', 'plant'], styles: { outline: {} } },
      tree: { name: 'tree', category: 'Nature', tags: [], styles: { outline: {}, filled: {} } },
    }
    const index = buildIndex('1.0.0', tabler, { 'old-leaf': 'leaf' })
    expect(index.aliases).toEqual({ 'old-leaf': 'leaf' })
    expect(index.icons.map((icon) => icon.name)).toEqual(['leaf', 'tree'])
    expect(index.icons[0].aliases).toEqual(['old-leaf', 'plant'])
    expect(index.icons[1]).toMatchObject({ aliases: [], filled: true, label: 'Tree' })
    expect(index.categories).toEqual(['Nature'])
    // The real index is the one the pinned set makes.
    expect(readIndex()).toEqual(buildIndex(TABLER_VERSION, tablerEntries(), ICON_ALIASES))
  })

  it('reads the glyphs on demand: the package entry answers one name at a time', async () => {
    const { readGlyph, loadIndex } = await import('../packages/icons/src/index')
    expect((await loadIndex()).version).toBe(TABLER_VERSION)
    const outline = await readGlyph('map-pin')
    const filled = await readGlyph('map-pin', 'filled')
    expect(outline).toContain('stroke="currentColor"')
    expect(filled).toContain('fill="currentColor"')
    expect(filled).not.toBe(outline)
    // A name with no filled alternate answers its outline.
    const outlineOnly = readIndex().icons.find((entry) => !entry.filled)?.name as string
    expect(await readGlyph(outlineOnly, 'filled')).toBe(await readGlyph(outlineOnly, 'outline'))
    expect(await readGlyph('not-a-name')).toBeUndefined()
    expect(await readGlyph('constructor')).toBeUndefined()
  })

  it('never reaches for the network: the build and the entry import nothing remote', () => {
    for (const file of [
      'scripts/build.ts',
      'scripts/generate.ts',
      'src/index.ts',
      'src/search.ts',
    ]) {
      const source = readFileSync(path.resolve(__dirname, '../packages/icons', file), 'utf8')
      expect(source, file).not.toMatch(/https?:\/\/|fetch\(|node:https?|node:net/)
    }
  })
})

describe('npm run lint:icons', () => {
  const root = path.resolve(__dirname, '..')
  const FILES = [
    'contract/icons.names.json',
    'contract/icons.schema.json',
    'packages/icons/index.json',
  ]
  const check = (icons: string): number => {
    try {
      execFileSync('npx', ['jiti', 'packages/icons/scripts/generate.ts', '--check'], {
        cwd: root,
        env: { ...process.env, ICONS_ROOT: icons },
        stdio: 'pipe',
      })
      return 0
    } catch (error) {
      return (error as { status: number }).status
    }
  }
  const copy = (): string => {
    const dir = mkdtempSync(path.join(root, '.tmp', 'icons-drift-'))
    for (const file of FILES) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      copyFileSync(path.join(root, file), path.join(dir, file))
    }
    return dir
  }

  it('passes on the committed files', () => {
    expect(check(root)).toBe(0)
  })

  it('fails when a generated file drifts and passes after regeneration', () => {
    mkdirSync(path.join(root, '.tmp'), { recursive: true })
    const dir = copy()
    try {
      const schema = path.join(dir, 'contract/icons.schema.json')
      writeFileSync(schema, readFileSync(schema, 'utf8').replace('"map-pin",', ''))
      expect(check(dir)).toBe(1)
      // The files are written when the check is off, and then it passes.
      execFileSync('npx', ['jiti', 'packages/icons/scripts/generate.ts'], {
        cwd: root,
        env: { ...process.env, ICONS_ROOT: dir },
        stdio: 'pipe',
      })
      expect(check(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
