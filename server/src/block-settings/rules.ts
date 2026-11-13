import { BLOCKS, optionsOf, type Block, type SiteModule } from '../../../contract/blocks'
import { LABEL_LOCALES, LABEL_MAX_LENGTH } from '../constants/blocks'
import type { BudgetsConfig } from '../config'
import type { BlockLabels, BlockSetting, MergedOption } from '../types/blocks'
import type { BlockNotAllowedViolation } from './error'
import type { BlockOptionViolation } from '../block-options/rules'

/** A setting the catalogue refuses: a value outside the contract, or a field that names nothing. */
export type SettingViolation =
  | { kind: 'option'; violation: BlockOptionViolation }
  | { kind: 'field'; field: string; detail: string }

const field = (name: string, detail: string): SettingViolation => ({
  kind: 'field',
  field: name,
  detail,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The page types a site knows: the keys of its budgets (`budgets.pageTypes` and the site's own), in that order. */
export function knownPageTypes(budgets: BudgetsConfig, siteSlug: string | null): string[] {
  return [
    ...new Set([
      ...Object.keys(budgets.pageTypes),
      ...Object.keys(budgets.sites[siteSlug ?? ''] ?? {}),
    ]),
  ]
}

/**
 * Finds the first thing in a setting that the catalogue refuses.
 *
 * @remarks
 * A default is refused when the block does not expose the option or the value is not one the block
 * offers (a number is compared as the string Strapi stores); `null` or an absent field takes the
 * core's default. Only the fields the input names are checked, so an update that leaves one alone
 * cannot fail on it.
 *
 * @param input - The `data` of a write to `plugin::micelio.block-setting`.
 * @param block - The block the setting is for.
 * @param pageTypes - The page types the site knows.
 */
export function findSettingViolation(
  input: Record<string, unknown>,
  block: Block,
  pageTypes: readonly string[]
): SettingViolation | null {
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    return field('enabled', 'enabled must be true or false')
  }
  const allowed = input.allowedPageTypes
  if (allowed !== undefined && allowed !== null) {
    if (!Array.isArray(allowed) || allowed.some((type) => typeof type !== 'string')) {
      return field('allowedPageTypes', 'allowedPageTypes must be a list of page types or null')
    }
    const unknown = (allowed as string[]).find((type) => !pageTypes.includes(type))
    if (unknown !== undefined) {
      return field('allowedPageTypes', `This site has no page type "${unknown}"`)
    }
  }
  const defaults = input.defaultOptions
  if (defaults !== undefined && defaults !== null) {
    if (!isRecord(defaults)) {
      return field('defaultOptions', 'defaultOptions must be an object of option values or null')
    }
    const offered = new Map(optionsOf(block))
    for (const [option, value] of Object.entries(defaults)) {
      const values: readonly string[] = offered.get(option)?.values ?? []
      const isAllowed =
        (typeof value === 'string' || typeof value === 'number') && values.includes(String(value))
      if (!isAllowed)
        return { kind: 'option', violation: { block: block.id, option, value, allowed: values } }
    }
  }
  const labels = input.labels
  if (labels !== undefined && labels !== null) {
    if (!isRecord(labels))
      return field('labels', 'labels must be an object of texts by locale or null')
    for (const [locale, text] of Object.entries(labels)) {
      if (!(LABEL_LOCALES as readonly string[]).includes(locale)) {
        return field('labels', `labels takes ${LABEL_LOCALES.join(' and ')}, not "${locale}"`)
      }
      if (typeof text !== 'string' || text.length > LABEL_MAX_LENGTH) {
        return field(
          'labels',
          `The ${locale} label must be a text of at most ${LABEL_MAX_LENGTH} characters`
        )
      }
    }
  }
  return null
}

/** A stored row as a {@link BlockSetting}: what is missing or malformed takes the core's default. */
export function settingOf(blockId: string, row: Record<string, unknown> | undefined): BlockSetting {
  const defaults = isRecord(row?.defaultOptions) ? row.defaultOptions : {}
  const labels = isRecord(row?.labels) ? row.labels : {}
  return {
    block: blockId,
    enabled: row?.enabled !== false,
    allowedPageTypes: Array.isArray(row?.allowedPageTypes)
      ? row.allowedPageTypes.filter((type): type is string => typeof type === 'string')
      : null,
    defaultOptions: Object.fromEntries(
      Object.entries(defaults).flatMap(([name, value]) =>
        typeof value === 'string' ? [[name, value]] : []
      )
    ),
    labels: Object.fromEntries(
      LABEL_LOCALES.flatMap((locale) => {
        const text = labels[locale]
        return typeof text === 'string' && text.trim() !== '' ? [[locale, text.trim()]] : []
      })
    ) as BlockLabels,
  }
}

/**
 * The options of a block with the site's defaults in place of the core's, each keeping the core's
 * as `coreDefault`.
 *
 * @remarks
 * A stored default the contract no longer offers (a release withdrew the value) falls back to the
 * core's, so the palette never starts a block with a value the save would refuse.
 */
export function mergedOptions(
  block: Block,
  setting: Pick<BlockSetting, 'defaultOptions'> | undefined
): Record<string, MergedOption> {
  return Object.fromEntries(
    optionsOf(block).map(([name, option]) => {
      const chosen = setting?.defaultOptions[name]
      return [
        name,
        {
          values: option.values,
          default: chosen !== undefined && option.values.includes(chosen) ? chosen : option.default,
          coreDefault: option.default,
        },
      ]
    })
  )
}

/** The page types a block may be inserted in: the setting's list, or every page type the site knows. */
export function allowedPageTypesOf(
  setting: Pick<BlockSetting, 'allowedPageTypes'> | undefined,
  pageTypes: readonly string[]
): string[] {
  return setting?.allowedPageTypes ?? [...pageTypes]
}

const blockOfId = (id: string, blocks: readonly Block[]) => blocks.find((block) => block.id === id)

/** The catalogue block whose component is `uid`, if any. */
function blockOfComponent(uid: string, blocks: readonly Block[]): Block | undefined {
  return blocks.find((block) => block.schema.component === uid)
}

/**
 * The `id` of every catalogue block in the data of a document, in order, wherever it sits: in a
 * dynamic zone, in a component attribute, or nested in the parts of another component.
 *
 * @param attributes - The attributes of the content type.
 * @param data - What is being written, or a stored document populated through every level.
 * @param componentAttributes - The attributes of a component by UID, to walk into it.
 */
export function blockIdsIn(
  attributes: Record<string, unknown>,
  data: Record<string, unknown>,
  componentAttributes: (uid: string) => Record<string, unknown> | undefined,
  blocks: readonly Block[] = BLOCKS
): string[] {
  const found: string[] = []
  const enter = (uid: string, content: Record<string, unknown>): void => {
    const block = blockOfComponent(uid, blocks)
    if (block) found.push(block.id)
    walk(componentAttributes(uid) ?? {}, content)
  }
  const walk = (attrs: Record<string, unknown>, content: Record<string, unknown>): void => {
    for (const [name, attribute] of Object.entries(attrs)) {
      const value = content[name]
      if (!isRecord(attribute) || value === undefined || value === null) continue
      const entries = Array.isArray(value) ? value : [value]
      if (attribute.type === 'dynamiczone') {
        for (const entry of entries) {
          if (isRecord(entry) && typeof entry.__component === 'string') {
            enter(entry.__component, entry)
          }
        }
      } else if (attribute.type === 'component' && typeof attribute.component === 'string') {
        for (const entry of entries) if (isRecord(entry)) enter(attribute.component, entry)
      }
    }
  }
  walk(attributes, data)
  return found
}

/** The module of `site.modules` the block needs, when the site's `modules` component has it off. */
export function moduleOffOf(block: Pick<Block, 'module'>, modules: unknown): SiteModule | null {
  if (!block.module || !isRecord(modules)) return null
  return modules[block.module] === false ? block.module : null
}

/** The part of a setting the check of a save reads. */
export type SettingRule = Pick<BlockSetting, 'enabled' | 'allowedPageTypes'>

/**
 * Finds the first block a save adds that the site disabled or does not allow on the page's type.
 *
 * @remarks
 * Only an addition is refused: a block counts as added when the save holds more of it than the
 * document already stores, so a page that uses a disabled block can still be saved, reordered and
 * edited, and keeps rendering. A block with no setting is allowed.
 *
 * @param sent - The blocks in the data of the save, from {@link blockIdsIn}.
 * @param stored - The blocks the document holds now; empty for a new document.
 * @param settings - The site's rules by block `id`.
 * @param pageType - The page type of the document after the save.
 * @param modules - The site's `modules` component as stored (a key that is `false` is off); a block
 * that needs a module the site has off is refused with `moduleOff`, whatever its setting.
 */
export function findBlockNotAllowed(
  sent: readonly string[],
  stored: readonly string[],
  settings: ReadonlyMap<string, SettingRule>,
  pageType: string,
  modules?: unknown,
  blocks: readonly Block[] = BLOCKS
): BlockNotAllowedViolation | null {
  const count = (ids: readonly string[], id: string) => ids.filter((other) => other === id).length
  for (const id of new Set(sent)) {
    if (count(sent, id) <= count(stored, id)) continue
    const module = moduleOffOf(blockOfId(id, blocks) ?? {}, modules)
    if (module) return { block: id, reason: 'moduleOff', module }
    const rule = settings.get(id)
    if (!rule) continue
    if (!rule.enabled) return { block: id, reason: 'disabled' }
    if (rule.allowedPageTypes && !rule.allowedPageTypes.includes(pageType)) {
      return { block: id, reason: 'pageType', pageType }
    }
  }
  return null
}
