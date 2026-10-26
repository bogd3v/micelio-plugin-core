// The `populate` the frontend sends to the draft read, copied verbatim from `server/lib/constants.ts`
// of bogd3v/micelio (`origin/main` 2ab761e; the file last changed in 509309a). Test data only: the
// suites check that the draft read serves exactly this. Do not edit; copy it again when the
// frontend changes it.

/** The fields of an image that a page reads; the rest of what the CMS stores about a file stays there. */
const IMAGE = { fields: ['url', 'alternativeText', 'caption', 'width', 'height'] }

/** The fields of a media file that a page section or a SEO image reads (`mime` tells a model from an image). */
const PAGE_MEDIA = { fields: ['url', 'alternativeText', 'width', 'height', 'mime'] }

/**
 * The Strapi populate of a page.
 *
 * @remarks
 * Strapi does not mix '*' with keyed entries, so every relation of every section is named. Links and media are listed explicitly, and each media names its fields, so a new CMS field never widens the response.
 */
export const PAGE_POPULATE = {
  seo: { populate: { metaImage: PAGE_MEDIA } },
  localizations: { fields: ['slug', 'locale'] },
  sections: {
    on: {
      'section.hero': { populate: { primaryLink: true, secondaryLink: true, media: PAGE_MEDIA } },
      'section.feature-grid': { populate: { items: { populate: { icon: PAGE_MEDIA } } } },
      'section.media-showcase': { populate: { media: PAGE_MEDIA, link: true } },
      'section.stats': { populate: { items: true } },
      'section.logo-cloud': { populate: { logos: { populate: { image: PAGE_MEDIA } } } },
      'section.testimonials': { populate: { items: { populate: { avatar: PAGE_MEDIA } } } },
      'section.pricing': { populate: { plans: { populate: { link: true } } } },
      'section.faq': { populate: { items: true } },
      'section.cta': { populate: { primaryLink: true, secondaryLink: true } },
      'section.post-list': {
        populate: { category: { fields: ['slug'] }, tag: { fields: ['slug'] } },
      },
      'section.newsletter': { populate: '*' },
      'section.rich-text': { populate: '*' },
      'section.gallery': { populate: { images: PAGE_MEDIA } },
      'section.scene': { populate: { model: PAGE_MEDIA, poster: PAGE_MEDIA } },
    },
  },
}

/**
 * The Strapi populate of the site identity: one entry per relation or component `parseSiteSettings` reads.
 *
 * @remarks
 * Strapi does not mix '*' with keyed entries. `accentOverrides` sits inside `theme`, one level down, so `theme` needs its own populate.

/** The Strapi populate of a full article, with every block of the dynamic zone. */
export const ARTICLE_POPULATE = {
  cover: IMAGE,
  coverCredit: true,
  category: { fields: ['name', 'slug'] },
  author: { fields: ['name'], populate: { avatar: IMAGE } },
  seo: { populate: { metaImage: IMAGE } },
  tags: { fields: ['name', 'slug'] },
  blocks: {
    on: {
      'shared.rich-text': true,
      'shared.quote': true,
      'shared.media': { populate: { file: IMAGE, credit: true } },
      'shared.playground': true,
      'shared.slider': {
        populate: { items: { populate: { file: IMAGE, credit: true } }, files: IMAGE },
      },
    },
  },
  references: true,
  localizations: { fields: ['slug', 'locale', 'publishedAt'] },
}
