import { describe, expect, it } from 'vitest'
import type { Core, Schema } from '@strapi/strapi'
import { readDraftQuery } from '../server/src/preview/draft-query'
import type { PopulateSpec } from '../server/src/preview/draft-query'
import cms from './fixtures/micelio-cms-v0.4.0-components.json'
import { ARTICLE_POPULATE, PAGE_POPULATE } from './fixtures/micelio-populate'

// The draft read's allowlist against the `populate` the frontend really sends (the verbatim
// `ARTICLE_POPULATE` and `PAGE_POPULATE`, test/fixtures/micelio-populate.ts) on the components of
// `micelio-cms` v0.4.0 (test/fixtures/). The content types are the attributes of that tag's
// `article`, `page`, `author`, `category` and `tag`, plus what Strapi adds to a localised type with
// draft and publish. No boot: the suite of preview-populate.test.ts runs the read itself.

type Attributes = Record<string, Record<string, unknown>>

const localised: Attributes = {
  locale: { type: 'string' },
  publishedAt: { type: 'datetime' },
  localizations: { type: 'relation', target: undefined },
  createdBy: { type: 'relation', target: 'admin::user', private: true },
  updatedBy: { type: 'relation', target: 'admin::user', private: true },
}

function contentType(uid: string, attributes: Attributes): [string, Schema.ContentType] {
  const withSelf = { ...attributes, ...localised }
  withSelf.localizations = { type: 'relation', target: uid }
  return [uid, { uid, attributes: withSelf } as unknown as Schema.ContentType]
}

const contentTypes = Object.fromEntries([
  contentType('api::article.article', {
    title: { type: 'string' },
    description: { type: 'text' },
    slug: { type: 'uid' },
    cover: { type: 'media' },
    coverCredit: { type: 'component', component: 'shared.image-credit' },
    author: { type: 'relation', target: 'api::author.author' },
    category: { type: 'relation', target: 'api::category.category' },
    tags: { type: 'relation', target: 'api::tag.tag' },
    blocks: {
      type: 'dynamiczone',
      components: [
        'shared.media',
        'shared.playground',
        'shared.quote',
        'shared.rich-text',
        'shared.slider',
      ],
    },
    references: { type: 'component', component: 'shared.reference', repeatable: true },
    seo: { type: 'component', component: 'shared.seo' },
  }),
  contentType('api::page.page', {
    title: { type: 'string' },
    slug: { type: 'uid' },
    seo: { type: 'component', component: 'shared.seo' },
    sections: {
      type: 'dynamiczone',
      components: [
        'section.hero',
        'section.feature-grid',
        'section.media-showcase',
        'section.stats',
        'section.logo-cloud',
        'section.testimonials',
        'section.pricing',
        'section.faq',
        'section.cta',
        'section.post-list',
        'section.newsletter',
        'section.rich-text',
        'section.gallery',
        'section.scene',
      ],
    },
  }),
  contentType('api::author.author', {
    name: { type: 'string' },
    avatar: { type: 'media' },
    email: { type: 'string' },
    articles: { type: 'relation', target: 'api::article.article' },
  }),
  contentType('api::category.category', {
    name: { type: 'string' },
    slug: { type: 'uid' },
    articles: { type: 'relation', target: 'api::article.article' },
  }),
  contentType('api::tag.tag', {
    name: { type: 'string' },
    slug: { type: 'uid' },
    articles: { type: 'relation', target: 'api::article.article' },
  }),
  [
    'plugin::upload.file',
    {
      uid: 'plugin::upload.file',
      attributes: {
        name: { type: 'string' },
        alternativeText: { type: 'string' },
        caption: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        mime: { type: 'string' },
        url: { type: 'string' },
        related: { type: 'relation', relation: 'morphToMany' },
        folder: { type: 'relation', target: 'plugin::upload.folder' },
      },
    } as unknown as Schema.ContentType,
  ],
])

const strapi = {
  components: cms.components,
  contentTypes,
  contentType: (uid: string) => contentTypes[uid as keyof typeof contentTypes],
} as unknown as Core.Strapi

function read(uid: string, populate: unknown) {
  return readDraftQuery(strapi, { populate }, strapi.contentType(uid as never))
}

describe('the draft read allowlist against the frontend populate', () => {
  it('accepts the populate of an article, key by key', () => {
    const answer = read('api::article.article', ARTICLE_POPULATE)
    expect(answer).toHaveProperty('populate')
    const { children } = (answer as { populate: PopulateSpec }).populate
    expect([...children.keys()]).toEqual(Object.keys(ARTICLE_POPULATE))
    expect(children.get('localizations')?.fields).toEqual(['slug', 'locale', 'publishedAt'])
    expect(children.get('author')?.populate?.children.get('avatar')?.fields).toEqual([
      'url',
      'alternativeText',
      'caption',
      'width',
      'height',
    ])
    expect([...(children.get('blocks')?.on?.keys() ?? [])]).toEqual(
      Object.keys(ARTICLE_POPULATE.blocks.on)
    )
  })

  it('accepts the populate of a page, key by key', () => {
    const answer = read('api::page.page', PAGE_POPULATE)
    expect(answer).toHaveProperty('populate')
    const { children } = (answer as { populate: PopulateSpec }).populate
    expect([...children.keys()]).toEqual(Object.keys(PAGE_POPULATE))
    expect(children.get('localizations')?.fields).toEqual(['slug', 'locale'])
    expect([...(children.get('sections')?.on?.keys() ?? [])]).toEqual(
      Object.keys(PAGE_POPULATE.sections.on)
    )
  })

  it.each([
    ['article', 'api::article.article', ARTICLE_POPULATE, 'author', 'articles'],
    ['article', 'api::article.article', ARTICLE_POPULATE, 'localizations', 'localizations'],
    ['page', 'api::page.page', PAGE_POPULATE, 'localizations', 'localizations'],
  ])(
    'still refuses a relation under the %s relation %s',
    (_name, uid, populate, relation, deeper) => {
      const widened = {
        ...populate,
        [relation]: { ...(populate as Record<string, object>)[relation], populate: [deeper] },
      }
      expect(read(uid, widened)).toHaveProperty('problem')
    }
  )
})
