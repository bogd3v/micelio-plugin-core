// The presentation options vocabulary (ADR-0018, section 1; the Options vocabulary artboard): the
// eight names a block may expose and the closed set of values of each. `contract/blocks.ts` says which
// block exposes which; the reference in `docs/blocks.md` and the generated schema follow. Adding a name
// or a value is a MINOR of the block contract, removing or renaming one a MAJOR (ADR-0018, section 2).

/** One option of the vocabulary. */
interface VocabularyOption {
  /** Every value, in the order a theme and the editor list them. */
  values: readonly [string, ...string[]]
  /** The value of a block that does not set it: what the block renders today. */
  default: string
}

/** The vocabulary. Values are stored as Strapi enumerations. */
export const OPTIONS = {
  /** How the block arranges its parts; maps to the theme's layout variants (ADR-0005). */
  layout: { values: ['centered', 'split', 'stacked'], default: 'centered' },
  /** How wide the block is; `full` is refused on article pages. */
  width: { values: ['prose', 'wide', 'full'], default: 'prose' },
  /** Columns of its grid; collapses to one at phone width. `6` is only for `logo-cloud`. */
  columns: { values: ['2', '3', '4', '6'], default: '3' },
  /** Theme spacing steps, never pixels. */
  density: { values: ['comfortable', 'compact'], default: 'comfortable' },
  /** Where its text sits. There is no `end`: it would mean right or left depending on the language. */
  align: { values: ['start', 'center'], default: 'start' },
  /** The theme surface it sits on: `surface`, `surface-raised` and `accent-soft`. */
  tone: { values: ['default', 'raised', 'accent'], default: 'default' },
  /** The aspect ratio of its media; `auto` reserves no space. */
  ratio: { values: ['16:9', '4:3', '1:1', 'auto'], default: '16:9' },
  /** How tall it is; `full` is one viewport. An island keeps its static alternative at the same height. */
  height: { values: ['s', 'm', 'l', 'full'], default: 'm' },
} as const satisfies Record<string, VocabularyOption>

/** The name of a presentation option of the vocabulary. */
export type OptionName = keyof typeof OPTIONS

/** The names of the vocabulary, in its order. */
export const OPTION_NAMES = Object.keys(OPTIONS) as readonly OptionName[]

/**
 * The values of an option that only some blocks may offer: articles never take `width: full`, and
 * `columns: 6` is for `logo-cloud` alone.
 */
function isWithheld(
  name: OptionName,
  value: string,
  block: { id: string; group: string }
): boolean {
  if (name === 'width') return value === 'full' && block.group === 'article'
  if (name === 'columns') return value === '6' && block.id !== 'logo-cloud'
  return false
}

/** The values the vocabulary lets a block offer for an option, in the vocabulary's order. */
export function valuesFor(
  name: OptionName,
  block: { id: string; group: string }
): readonly [string, ...string[]] {
  const [first, ...rest] = OPTIONS[name].values.filter((value) => !isWithheld(name, value, block))
  if (first === undefined) throw new Error(`${block.id} offers no value of ${name}`)
  return [first, ...rest]
}
