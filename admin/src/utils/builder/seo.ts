import {
  checkSeo,
  deriveMetaDescription,
  deriveMetaTitle,
  firstParagraphOf,
  structuredDataFor,
  structuredDataType,
  type SeoReport,
} from '../../../../contract/seo'
import { writeBlocks, type BuilderBlock } from './model'

/** The social image of a page, as the Content Manager answers it. */
export interface SeoImage {
  id: number
  name: string | undefined
  url: string | undefined
  /** The thumbnail's URL, when the media library made one. */
  thumbnail: string | undefined
  width: number | null
  height: number | null
  alternativeText: string | null
}

/** The `shared.seo` component of a page, as the drawer's SEO and social tab edits it. */
export interface SeoValues {
  metaTitle: string
  metaDescription: string
  image: SeoImage | null
  canonicalURL: string
  keywords: string
  metaRobots: string
  /** The hand-written structured data as text, `''` when there is none. */
  structuredData: string
}

/** What the tab sends for the fields it changed: the image by its id, the structured data as text or `null` to clear it. */
export type SeoChange = Partial<{
  metaTitle: string
  metaDescription: string
  metaImage: number | null
  canonicalURL: string
  keywords: string
  structuredData: unknown
}>

/** What a page that has no `seo` component shows as. */
export const NO_SEO: SeoValues = {
  metaTitle: '',
  metaDescription: '',
  image: null,
  canonicalURL: '',
  keywords: '',
  metaRobots: '',
  structuredData: '',
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The `seo` component as the Content Manager answers it, read with the defaults for what is missing. */
export function seoOf(raw: unknown): SeoValues {
  if (typeof raw !== 'object' || raw === null) return NO_SEO
  const own = raw as Record<string, unknown>
  const file = own.metaImage as Record<string, unknown> | null | undefined
  const formats = file?.formats as { thumbnail?: { url?: unknown } } | null | undefined
  const structured = own.structuredData
  return {
    metaTitle: text(own.metaTitle),
    metaDescription: text(own.metaDescription),
    image:
      file && typeof file.id === 'number'
        ? {
            id: file.id,
            name: text(file.name) || undefined,
            url: text(file.url) || undefined,
            thumbnail: text(formats?.thumbnail?.url) || undefined,
            width: typeof file.width === 'number' ? file.width : null,
            height: typeof file.height === 'number' ? file.height : null,
            alternativeText: typeof file.alternativeText === 'string' ? file.alternativeText : null,
          }
        : null,
    canonicalURL: text(own.canonicalURL),
    keywords: text(own.keywords),
    metaRobots: text(own.metaRobots),
    structuredData:
      structured === null || structured === undefined || structured === ''
        ? ''
        : typeof structured === 'string'
          ? structured
          : JSON.stringify(structured, null, 2),
  }
}

/** What an empty field of the tab starts from, from the page itself: the same defaults the server derives at save. */
export function seoDefaults(
  title: string,
  siteName: string | undefined,
  blocks: readonly BuilderBlock[]
): { metaTitle: string; metaDescription: string } {
  return {
    metaTitle: deriveMetaTitle(title, siteName),
    metaDescription: deriveMetaDescription(firstParagraphOf(writeBlocks([...blocks]))),
  }
}

/** The checks the tab lists under "Checks before review", from what it shows. */
export function seoChecks(
  title: string,
  shown: { metaTitle: string; metaDescription: string },
  image: SeoImage | null
): SeoReport {
  return checkSeo({
    title,
    metaTitle: shown.metaTitle,
    metaDescription: shown.metaDescription,
    image: image && { width: image.width, height: image.height },
  })
}

/** How full a counter is: `over` past the limit, `short` under a minimum, else `ok`. */
export function counterLevel(length: number, min: number, max: number): 'ok' | 'short' | 'over' {
  if (length > max) return 'over'
  return length < min ? 'short' : 'ok'
}

/** The `content` of the robots meta a page gets: `noindex` follows the visibility, else the stored value, else `index, follow`. */
export function robotsOf(isNoindex: boolean, stored: string): string {
  if (isNoindex) return 'noindex'
  return stored.trim() === '' ? 'index, follow' : stored.trim()
}

/** The JSON-LD of a page, generated from its fields, as the text the tab shows. */
export function generatedStructuredData(args: {
  uid: string
  pageType: string | undefined
  title: string
  description: string
  image: string | undefined
  language: string | null
  url: string | undefined
}): string {
  return JSON.stringify(
    structuredDataFor({
      type: structuredDataType(args.uid, args.pageType),
      headline: args.title,
      description: args.description,
      image: args.image,
      language: args.language ?? undefined,
      url: args.url,
    }),
    null,
    2
  )
}

/** The part of a URL the search result shows above the title: `host › path`. */
export function breadcrumbOf(host: string, slug: string): string {
  return slug === '' ? host : `${host} › ${slug}`
}

/** The URL of the frontend's social card for a document, from the URL the preview opens; `undefined` when it is not one. */
export function cardRoute(previewUrl: string, uid: string, documentId: string): string | undefined {
  let url: URL
  try {
    url = new URL(previewUrl)
  } catch {
    return undefined
  }
  const prefix = url.pathname.replace(/\/_preview\/?$/, '').replace(/\/+$/, '')
  url.pathname = `${prefix}/api/preview/${encodeURIComponent(uid)}/${encodeURIComponent(documentId)}/card`
  url.search = ''
  url.hash = ''
  return url.toString()
}
