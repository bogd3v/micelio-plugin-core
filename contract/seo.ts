// What the server and the admin share about the SEO and social fields of a page (issue #53): the
// limits, what is derived when a field is empty, the checks that run before a page goes to review
// and the structured data. It imports nothing, so the admin bundles it without the server.

/** The limits of the fields of `shared.seo` and of the social image. */
export const SEO_LIMITS = {
  /** The longest meta title, in characters. */
  titleMax: 60,
  /** The shortest meta description, in characters. */
  descriptionMin: 50,
  /** The longest meta description, in characters. */
  descriptionMax: 160,
  /** The size the social image must have, in pixels. */
  image: { width: 1200, height: 630 },
} as const

/** The separator between a page's title and its site's name in a derived meta title. */
export const TITLE_SEPARATOR = ' · '

/** Why a page is not ready to leave `draft`: the `code` of one problem of `checkSeo`. */
export type SeoProblemCode =
  | 'metaTitleMissing'
  | 'metaTitleTooLong'
  | 'metaDescriptionMissing'
  | 'metaDescriptionTooShort'
  | 'metaDescriptionTooLong'
  | 'metaImageMissing'
  | 'metaImageSize'

/** A warning of `checkSeo`: the page may go on, the editor should know. */
export type SeoWarningCode = 'descriptionRepeatsTitle'

/** The `shared.seo` fields the checks read. */
export interface SeoFacts {
  /** The page's title. */
  title: string
  metaTitle: string
  metaDescription: string
  /** The social image's size, or `null` when the page has none. `width` and `height` are `null` for a file whose size is unknown. */
  image: { width: number | null; height: number | null } | null
}

/** What `checkSeo` found. */
export interface SeoReport {
  /** What refuses the move out of `draft`, in the order of the fields. */
  problems: SeoProblemCode[]
  warnings: SeoWarningCode[]
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Text for comparing two sentences: lower case, letters and digits only, one space between words. */
function plain(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Cuts `text` at the last word that fits in `max` characters, and ends it with an ellipsis. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

/**
 * The meta title a page gets when it has none: its title and its site's name, within the limit.
 *
 * @remarks
 * The site's name goes after the title (`Title · Site`). When both do not fit in
 * {@link SEO_LIMITS}`.titleMax` the name is dropped, and a title that is still too long is cut at a
 * word with an ellipsis. Empty when the page has no title.
 */
export function deriveMetaTitle(title: unknown, siteName?: unknown): string {
  const name = clean(title)
  if (name === '') return ''
  const site = clean(siteName)
  const joined = site === '' ? name : `${name}${TITLE_SEPARATOR}${site}`
  return joined.length <= SEO_LIMITS.titleMax ? joined : shorten(name, SEO_LIMITS.titleMax)
}

/** Markdown, as one plain line: the marks of emphasis, links, images and code are taken off. */
function plainMarkdown(block: string): string {
  return block
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The first paragraph of a text in Markdown: the first block of lines that is neither a heading,
 * a list, a quote, a table, a code fence nor an image alone, as plain text, of at least `min`
 * characters.
 */
export function firstParagraph(markdown: unknown, min = 1): string {
  if (typeof markdown !== 'string') return ''
  const blocks = markdown.replace(/\r\n/g, '\n').split(/\n\s*\n/)
  for (const block of blocks) {
    const trimmed = block.trim()
    if (trimmed === '' || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|---|===)/.test(trimmed))
      continue
    const text = plainMarkdown(trimmed)
    if (text.length >= min) return text
  }
  return ''
}

/**
 * The meta description a page gets when it has none, from the first paragraph of its text, cut to
 * the limit; empty when the paragraph is shorter than {@link SEO_LIMITS}`.descriptionMin`, since
 * such a text is not a description.
 */
export function deriveMetaDescription(paragraph: unknown): string {
  const text = clean(paragraph).replace(/\s+/g, ' ')
  if (text.length < SEO_LIMITS.descriptionMin) return ''
  return shorten(text, SEO_LIMITS.descriptionMax)
}

/**
 * The block fields that hold a page's running text, by component: the body of the text blocks and
 * the text of a hero. The first paragraph of the first block that has one is the page's.
 */
const TEXT_FIELDS: Readonly<Record<string, string>> = {
  'section.hero': 'text',
  'section.rich-text': 'body',
  'shared.rich-text': 'body',
}

/** The component of the block whose first media is the page's social image. */
export const HERO_COMPONENT = 'section.hero'

/** The field of that block that holds the media. */
export const HERO_MEDIA_FIELD = 'media'

/**
 * The first paragraph of a page's blocks, in order, long enough to be a description
 * ({@link SEO_LIMITS}`.descriptionMin`): a short lead is skipped. Empty when no block has one.
 */
export function firstParagraphOf(blocks: readonly unknown[]): string {
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const own = block as Record<string, unknown>
    const field = TEXT_FIELDS[String(own.__component)]
    const paragraph =
      field === undefined ? '' : firstParagraph(own[field], SEO_LIMITS.descriptionMin)
    if (paragraph !== '') return paragraph
  }
  return ''
}

/**
 * What stops a page from leaving `draft` and what the editor should know, from its SEO fields:
 * the limits of the title and the description, a social image of the right size, and a
 * description that only repeats the title (a warning).
 */
export function checkSeo(facts: SeoFacts): SeoReport {
  const problems: SeoProblemCode[] = []
  const title = clean(facts.metaTitle)
  const description = clean(facts.metaDescription)
  if (title === '') problems.push('metaTitleMissing')
  else if (title.length > SEO_LIMITS.titleMax) problems.push('metaTitleTooLong')
  if (description === '') problems.push('metaDescriptionMissing')
  else if (description.length < SEO_LIMITS.descriptionMin) problems.push('metaDescriptionTooShort')
  else if (description.length > SEO_LIMITS.descriptionMax) problems.push('metaDescriptionTooLong')
  if (facts.image === null) problems.push('metaImageMissing')
  else if (
    facts.image.width !== SEO_LIMITS.image.width ||
    facts.image.height !== SEO_LIMITS.image.height
  ) {
    problems.push('metaImageSize')
  }
  const warnings: SeoWarningCode[] = []
  if (description !== '' && repeatsTitle(description, [facts.title, title])) {
    warnings.push('descriptionRepeatsTitle')
  }
  return { problems, warnings }
}

/**
 * Whether a description only says again the title: once the title is taken out of it, as many
 * times as it appears, fewer than 15 characters are left (a site name, a word or two). Compared
 * without case, accents or punctuation.
 */
export function repeatsTitle(description: string, titles: readonly string[]): boolean {
  const said = plain(description)
  return titles.some((title) => {
    const heard = plain(title)
    if (heard.length < 3) return false
    return said.includes(heard) && said.split(heard).join(' ').trim().length < 15
  })
}

/** The `@type` of the structured data generated for a page. */
export type StructuredDataType = 'Article' | 'WebPage'

/** The type of a page's structured data: an article reads as `Article`, any other page as `WebPage`. */
export function structuredDataType(uid: string, pageType: string | undefined): StructuredDataType {
  return uid === 'api::article.article' || pageType === 'long-read' ? 'Article' : 'WebPage'
}

/** What the generated structured data is made from. */
export interface StructuredDataSource {
  type: StructuredDataType
  headline: string
  description: string
  /** The social image's URL, absolute. */
  image?: string
  /** The page's language, as a BCP 47 tag. */
  language?: string
  /** The page's address, absolute, when the site's URL is known. */
  url?: string
}

/** The JSON-LD of a page, as an object: only the members that have a value. */
export function structuredDataFor(source: StructuredDataSource): Record<string, unknown> {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': source.type,
    headline: source.headline,
  }
  if (source.description !== '') data.description = source.description
  if (source.image) data.image = source.image
  if (source.language) data.inLanguage = source.language
  if (source.url) data.mainEntityOfPage = source.url
  return data
}

/** The longest hand-written structured data, in characters of its JSON. */
export const STRUCTURED_DATA_MAX = 20_000

/**
 * Why a hand-written structured data is not valid JSON-LD for a page, or `null` when it is: a
 * JSON object, or a list of them, each with a `@context` and a `@type`, no longer than
 * {@link STRUCTURED_DATA_MAX} characters. `undefined`, `null` and `''` mean none and are valid.
 */
export function structuredDataProblem(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return 'It is not valid JSON'
    }
  }
  if (JSON.stringify(parsed).length > STRUCTURED_DATA_MAX) {
    return `It is longer than ${STRUCTURED_DATA_MAX} characters`
  }
  const nodes = Array.isArray(parsed) ? parsed : [parsed]
  if (nodes.length === 0) return 'It is an empty list'
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return 'It must be a JSON object, or a list of them'
    }
    const own = node as Record<string, unknown>
    if (typeof own['@context'] !== 'string' && typeof own['@context'] !== 'object') {
      return 'Each object needs a "@context", such as "https://schema.org"'
    }
    if (typeof own['@type'] !== 'string' || own['@type'] === '') {
      return 'Each object needs a "@type", such as "Article"'
    }
  }
  return null
}
