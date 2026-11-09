import type { Core, UID } from '@strapi/strapi'
import { checkSeo, type SeoProblemCode, type SeoReport } from '../../../contract/seo'
import { hasPageSettings } from '../page-settings'
import { hasSeo } from '.'
import { readSeoDraft } from './read'

/**
 * The problems and warnings of a draft's SEO fields (`contract/seo.ts`), or `null` when the type has
 * no `seo` component or was not made with `withPageSettings`, or the draft does not exist: such a page is not checked.
 */
export async function checkSeoOf(
  strapi: Core.Strapi,
  target: { uid: UID.ContentType; documentId: string; locale?: string | null }
): Promise<SeoReport | null> {
  const schema = strapi.contentType(target.uid)
  if (!hasPageSettings(schema) || !hasSeo(schema)) return null
  const draft = await readSeoDraft(strapi, target)
  if (!draft) return null
  return checkSeo({
    title: draft.title,
    metaTitle: draft.seo.metaTitle,
    metaDescription: draft.seo.metaDescription,
    image: draft.seo.image && { width: draft.seo.image.width, height: draft.seo.image.height },
  })
}

/** The sentence that says what a problem of `checkSeo` asks of the editor. */
export function describeSeoProblem(code: SeoProblemCode): string {
  switch (code) {
    case 'metaTitleMissing':
      return 'the meta title is empty'
    case 'metaTitleTooLong':
      return 'the meta title is over 60 characters'
    case 'metaDescriptionMissing':
      return 'the meta description is empty'
    case 'metaDescriptionTooShort':
      return 'the meta description is under 50 characters'
    case 'metaDescriptionTooLong':
      return 'the meta description is over 160 characters'
    case 'metaImageMissing':
      return 'the social image is missing'
    case 'metaImageSize':
      return 'the social image is not 1200 by 630 pixels'
  }
}
