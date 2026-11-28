import modulesSchema from '../../../server/src/components/site/modules.json'
import socialLinkSchema from '../../../server/src/components/site/social-link.json'
import themeSchema from '../../../server/src/components/site/theme.json'

/** The modules a site turns on or off: the fields of `micelio-site.modules`, in its order. */
export const MODULE_KEYS: string[] = Object.keys(modulesSchema.attributes)

/** The display fonts a site may choose: the enumeration of `displayFont` in `micelio-site.theme`. */
export const DISPLAY_FONTS: string[] = themeSchema.attributes.displayFont.enum

/** The networks of a social link: the enumeration of `network` in `micelio-site.social-link`. */
export const SOCIAL_NETWORKS: string[] = socialLinkSchema.attributes.network.enum

/** The pattern of a social link's `url` (`micelio-site.social-link`), and of the author's. */
const LINK_URL_PATTERN = new RegExp(socialLinkSchema.attributes.url.regex)

/** An accent colour as the site stores it: `#RRGGBB`. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** A role the accent family moves (`accent`, `accent-soft`, `on-accent`, `link`, …; `docs/api.md` of `micelio`). */
const ACCENT_ROLE = /(^|-)(accent|link|focus)(-|$)/

/** A mode slug, as `defaultMode` and an accent override's `mode` store it. */
const MODE_SLUG = /^[a-z][a-z0-9-]*$/

/** The media file the logo points to, as the Content Manager answers it. */
export interface LogoFile {
  id: number
  name: string
  url: string
  alternativeText?: string | null
}

/** One social link of the site. */
export interface SocialLink {
  network: string
  url: string
}

/** The theme's pin, which the page shows and sends back as it was read. */
export interface ThemePin {
  themeId: string | null
  themeVersion: string | null
  themeDigest: string | null
}

/** What the Customize page edits of a site, as its form holds it. */
export interface CustomizeValues {
  /** Localised: the value of the locale the page shows. */
  name: string
  /** Localised. */
  tagline: string
  /** Localised. */
  description: string
  logo: LogoFile | null
  /** The default author: empty name and URL save no author. */
  authorName: string
  authorUrl: string
  /** Every key of `MODULE_KEYS`; a key the site does not store is on, as the component's default. */
  modules: Record<string, boolean>
  socialLinks: SocialLink[]
  /** The accent override of each mode that has one, by mode, as `#RRGGBB`. */
  accents: Record<string, string>
  /** One of `DISPLAY_FONTS`, or empty for the theme's own. */
  displayFont: string
  /** A mode slug, or empty for the theme's own. */
  defaultMode: string
  /** Read only here. */
  pin: ThemePin
}

/** One pair of the contrast matrix: `role` on `surface`. */
export interface ContrastPair {
  role: string
  surface: string
  /** Floored to two decimals; `null` when a role has no colour. */
  ratio: number | null
  min: number
  passes: boolean
}

/** One mode of the contrast route's answer. */
export interface ContrastMode {
  mode: string
  /** The accent the candidate resolves to, or `null` when the theme's own stays. */
  accent: string | null
  pairs: ContrastPair[]
}

/** What `GET /_micelio/contrast` of the frontend answers, as the page reads it. */
export interface ContrastAnswer {
  theme: string
  modes: ContrastMode[]
}

/**
 * The AA result of a mode's accent (decision D1 of #60).
 *
 * @remarks
 * `theme`: no candidate, the theme's own accent. `passes`: the frontend renders the candidate as given
 * and every pair passes. `adjusted`: the frontend would render `shade` instead, the nearest shade that
 * passes. `fails`: no shade passes (`pair` undefined), or `pair` fails. `unknown`: the answer does
 * not list the mode.
 */
export type AccentResult =
  | { kind: 'theme' }
  | { kind: 'passes' }
  | { kind: 'adjusted'; shade: string; pair: ContrastPair | undefined }
  | { kind: 'fails'; pair: ContrastPair | undefined }
  | { kind: 'unknown' }

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const nullableText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

function logoOf(value: unknown): LogoFile | null {
  const file = recordOf(value)
  if (typeof file.id !== 'number') return null
  return {
    id: file.id,
    name: textOf(file.name),
    url: textOf(file.url),
    alternativeText: typeof file.alternativeText === 'string' ? file.alternativeText : null,
  }
}

/**
 * The form's values from `data` of `GET /content-manager/collection-types/plugin::micelio.site/:documentId`.
 *
 * @remarks
 * Anything outside a field's shape reads as empty: a social link with no known network or URL is left
 * out, and an accent override that is not a mode and a `#RRGGBB` too.
 */
export function customizationOf(data: Record<string, unknown>): CustomizeValues {
  const author = recordOf(data.author)
  const storedModules = recordOf(data.modules)
  const theme = recordOf(data.theme)
  const accents: Record<string, string> = {}
  for (const override of Array.isArray(theme.accentOverrides) ? theme.accentOverrides : []) {
    const { mode, color } = recordOf(override)
    if (typeof mode === 'string' && typeof color === 'string' && HEX_COLOR.test(color)) {
      accents[mode] = color
    }
  }
  const font = textOf(theme.displayFont)
  return {
    name: textOf(data.name),
    tagline: textOf(data.tagline),
    description: textOf(data.description),
    logo: logoOf(data.logo),
    authorName: textOf(author.name),
    authorUrl: textOf(author.url),
    modules: Object.fromEntries(MODULE_KEYS.map((key) => [key, storedModules[key] !== false])),
    socialLinks: (Array.isArray(data.socialLinks) ? data.socialLinks : [])
      .map((link) => recordOf(link))
      .filter(
        (link): link is { network: string; url: string } =>
          typeof link.network === 'string' &&
          SOCIAL_NETWORKS.includes(link.network) &&
          typeof link.url === 'string'
      )
      .map(({ network, url }) => ({ network, url })),
    accents,
    displayFont: DISPLAY_FONTS.includes(font) ? font : '',
    defaultMode: textOf(theme.defaultMode),
    pin: {
      themeId: nullableText(theme.themeId),
      themeVersion: nullableText(theme.themeVersion),
      themeDigest: nullableText(theme.themeDigest),
    },
  }
}

/**
 * The body of the save: only the fields the page edits, so the site's other fields keep their
 * values, and the theme's pin (`themeId`, `themeVersion`, `themeDigest`) as it was read.
 *
 * @remarks
 * An author with no name is no author (the component requires one), an empty display font or default
 * mode is the theme's own (`null`), and the overrides are sent in the order of their modes.
 */
export function customizeBodyOf(values: CustomizeValues): Record<string, unknown> {
  const authorName = values.authorName.trim()
  const authorUrl = values.authorUrl.trim()
  return {
    name: values.name.trim(),
    tagline: values.tagline.trim() === '' ? null : values.tagline.trim(),
    description: values.description.trim() === '' ? null : values.description.trim(),
    logo: values.logo ? values.logo.id : null,
    author:
      authorName === '' ? null : { name: authorName, url: authorUrl === '' ? null : authorUrl },
    modules: Object.fromEntries(MODULE_KEYS.map((key) => [key, values.modules[key] !== false])),
    socialLinks: values.socialLinks.map(({ network, url }) => ({ network, url: url.trim() })),
    theme: {
      themeId: values.pin.themeId,
      themeVersion: values.pin.themeVersion,
      themeDigest: values.pin.themeDigest,
      accentOverrides: Object.entries(values.accents)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mode, color]) => ({ mode, color })),
      displayFont: values.displayFont === '' ? null : values.displayFont,
      defaultMode: values.defaultMode === '' ? null : values.defaultMode,
    },
  }
}

/** Whether a text, trimmed, is a URL the site stores for a social link or the author: `http(s)://` and no spaces. */
export function isLinkUrl(text: string): boolean {
  return LINK_URL_PATTERN.test(text.trim())
}

/** Whether a text is an accent the site can store: `#RRGGBB`. */
export function isAccentColor(text: string): boolean {
  return HEX_COLOR.test(text)
}

/** The accents of the form that are colours the site can store: what the contrast route is asked about. */
export function candidatesOf(accents: Record<string, string>): { mode: string; color: string }[] {
  return Object.entries(accents)
    .filter(([mode, color]) => MODE_SLUG.test(mode) && isAccentColor(color))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mode, color]) => ({ mode, color }))
}

/**
 * Reads the body of `GET /_micelio/contrast`; `null` when it is not the frontend's shape
 * (`docs/api.md` of `micelio`, "Contrast of the active theme").
 */
export function parseContrastAnswer(body: unknown): ContrastAnswer | null {
  const data = recordOf(recordOf(body).data)
  if (!Array.isArray(data.modes)) return null
  const modes: ContrastMode[] = []
  for (const entry of data.modes) {
    const mode = recordOf(entry)
    if (typeof mode.mode !== 'string' || !Array.isArray(mode.pairs)) return null
    const accent = mode.accent === null ? null : recordOf(mode.accent).accent
    if (accent !== null && typeof accent !== 'string') return null
    const pairs: ContrastPair[] = []
    for (const item of mode.pairs) {
      const pair = recordOf(item)
      if (
        typeof pair.role !== 'string' ||
        typeof pair.surface !== 'string' ||
        typeof pair.min !== 'number' ||
        typeof pair.passes !== 'boolean' ||
        (pair.ratio !== null && typeof pair.ratio !== 'number')
      ) {
        return null
      }
      pairs.push({
        role: pair.role,
        surface: pair.surface,
        ratio: pair.ratio,
        min: pair.min,
        passes: pair.passes,
      })
    }
    modes.push({ mode: mode.mode, accent, pairs })
  }
  return { theme: textOf(data.theme), modes }
}

/**
 * The AA result of one mode's candidate in the contrast route's answer (decision D1 of #60).
 *
 * @remarks
 * The route measures a candidate after the frontend has resolved it, so a candidate fails here when
 * the frontend would not render it as given: its answer's `accent` is another colour (`adjusted`, with
 * that shade) or `null` (`fails`: no shade passes, or the candidate is the theme's own accent). A pair
 * of the mode with `passes: false` fails it too. The `pair` the page names is the first that fails,
 * else, for an adjusted candidate, the first pair of an accent role, as measured on the shade. A mode
 * with no candidate is the theme's own, whatever its pairs say: the page has nothing to change there.
 *
 * @param candidate - The mode's accent in the form, `#RRGGBB`, or `undefined` for the theme's own.
 */
export function accentResult(
  answer: ContrastAnswer,
  mode: string,
  candidate: string | undefined
): AccentResult {
  const found = answer.modes.find((entry) => entry.mode === mode)
  if (!found) return { kind: 'unknown' }
  if (candidate === undefined) return { kind: 'theme' }
  const failing = found.pairs.find((pair) => !pair.passes)
  if (found.accent === null) return { kind: 'fails', pair: failing }
  if (found.accent.toLowerCase() !== candidate.toLowerCase()) {
    const ofAccent = found.pairs.find(
      ({ role, surface }) => ACCENT_ROLE.test(role) || ACCENT_ROLE.test(surface)
    )
    return { kind: 'adjusted', shade: found.accent, pair: failing ?? ofAccent }
  }
  return failing ? { kind: 'fails', pair: failing } : { kind: 'passes' }
}

/** Whether a result keeps the page from saving: a candidate the frontend would not render as given. */
export function blocksSave(result: { kind: string }): boolean {
  return result.kind === 'adjusted' || result.kind === 'fails'
}

/**
 * The URL of the contrast route of the site, from the URL the preview opens
 * (`<site.url>/_preview?token=…`), with the grant's document and the candidates; `undefined` when the
 * preview URL is not an `http` or `https` URL.
 *
 * @remarks
 * The token is dropped: the route is asked with the grant the frame holds, in its cookie.
 */
export function contrastRoute(
  previewUrl: string,
  documentId: string,
  candidates: { mode: string; color: string }[]
): string | undefined {
  let url: URL
  try {
    url = new URL(previewUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  const prefix = url.pathname.replace(/\/_preview\/?$/, '').replace(/\/+$/, '')
  const query = new URLSearchParams({ documentId })
  for (const { mode, color } of candidates) query.append('accent', `${mode}:${color}`)
  return `${url.origin}${prefix}/_micelio/contrast?${query}`
}

/**
 * The body of the customizer's save: only the site's `theme`, with the accents of the form and the
 * rest of the component (pin, display font, default mode) as it was read, so nothing else of the
 * site is written (#61).
 */
export function accentsBodyOf(values: CustomizeValues): Record<string, unknown> {
  return { theme: customizeBodyOf(values).theme }
}

/**
 * The modes whose accent in the form differs from the saved one: an override added, changed or
 * removed, the case of the colour aside. The customizer's "N of M modes changed" counts them.
 */
export function changedModes(
  accents: Record<string, string>,
  saved: Record<string, string>
): string[] {
  const modes = [...new Set([...Object.keys(saved), ...Object.keys(accents)])]
  return modes
    .filter((mode) => (accents[mode] ?? '').toLowerCase() !== (saved[mode] ?? '').toLowerCase())
    .sort((a, b) => a.localeCompare(b))
}

/**
 * The `accentOverrides` a preview token is asked with for the form's accents (ADR-0019 of
 * `micelio`, amendment of 2026-11-25): every mode's candidate, since they replace the saved ones;
 * `undefined` when no mode changed, so the frame renders the saved accents with a token that
 * carries none. An empty list renders every mode with the theme's own accent.
 */
export function previewOverridesOf(
  accents: Record<string, string>,
  saved: Record<string, string>
): { mode: string; color: string }[] | undefined {
  return changedModes(accents, saved).length === 0 ? undefined : candidatesOf(accents)
}
