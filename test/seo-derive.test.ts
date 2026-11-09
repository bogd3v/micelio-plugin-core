import { describe, expect, it } from 'vitest'
import {
  SEO_LIMITS,
  checkSeo,
  deriveMetaDescription,
  deriveMetaTitle,
  firstParagraph,
  firstParagraphOf,
  repeatsTitle,
  structuredDataFor,
  structuredDataProblem,
  structuredDataType,
} from '../contract/seo'

const GOOD = { width: 1200, height: 630 }
const DESCRIPTION =
  'A plain-words guide to what open source is, what it is not, and why it matters to anyone who uses software.'

describe('the SEO derivations and checks', () => {
  it('derives the title and the description when they are empty', () => {
    expect(deriveMetaTitle('Open source, in plain words', 'Demo site')).toBe(
      'Open source, in plain words · Demo site'
    )
    const sections = [
      { __component: 'section.hero', title: 'Hero', text: '' },
      {
        __component: 'section.rich-text',
        body: `## Heading\n\n${DESCRIPTION}\n\nA second paragraph.`,
      },
    ]
    expect(deriveMetaDescription(firstParagraphOf(sections))).toBe(DESCRIPTION)
  })

  it('drops the site name, then cuts the title, to stay within 60 characters', () => {
    const long = 'A title that is long enough to leave no room for the name of its site'
    const derived = deriveMetaTitle(long, 'Demo site')
    expect(derived.length).toBeLessThanOrEqual(SEO_LIMITS.titleMax)
    expect(derived).toBe('A title that is long enough to leave no room for the name…')
    expect(
      deriveMetaTitle('Short title', 'A site name that is rather long indeed, to be honest ok')
    ).toBe('Short title')
    expect(deriveMetaTitle('  ', 'Demo site')).toBe('')
    expect(deriveMetaTitle('Only title', undefined)).toBe('Only title')
  })

  it('reads the first paragraph of Markdown as plain text', () => {
    expect(
      firstParagraph('# Title\n\n- a list\n\n**Bold** and [a link](https://example.com).\n\nNext')
    ).toBe('Bold and a link.')
    expect(firstParagraph('![alt](x.png)\n\n> quote\n\n```\ncode\n```\n')).toBe('')
    expect(firstParagraph(undefined)).toBe('')
  })

  it('derives no description from a paragraph shorter than 50 characters, and cuts a long one', () => {
    expect(deriveMetaDescription('Too short to describe a page.')).toBe('')
    const derived = deriveMetaDescription(`${DESCRIPTION} ${DESCRIPTION}`)
    expect(derived.length).toBeLessThanOrEqual(SEO_LIMITS.descriptionMax)
    expect(derived.endsWith('…')).toBe(true)
  })

  it('refuses what is over a limit and lacks the image', () => {
    const base = { title: 'A page', metaTitle: 'A page', metaDescription: DESCRIPTION, image: GOOD }
    expect(checkSeo(base)).toEqual({ problems: [], warnings: [] })
    expect(checkSeo({ ...base, metaTitle: 'x'.repeat(61) }).problems).toEqual(['metaTitleTooLong'])
    expect(checkSeo({ ...base, metaTitle: ' ' }).problems).toEqual(['metaTitleMissing'])
    expect(checkSeo({ ...base, metaDescription: 'x'.repeat(161) }).problems).toEqual([
      'metaDescriptionTooLong',
    ])
    expect(checkSeo({ ...base, metaDescription: 'x'.repeat(49) }).problems).toEqual([
      'metaDescriptionTooShort',
    ])
    expect(checkSeo({ ...base, metaDescription: '' }).problems).toEqual(['metaDescriptionMissing'])
    expect(checkSeo({ ...base, image: null }).problems).toEqual(['metaImageMissing'])
    expect(checkSeo({ ...base, image: { width: 1200, height: 628 } }).problems).toEqual([
      'metaImageSize',
    ])
    expect(checkSeo({ ...base, image: { width: null, height: null } }).problems).toEqual([
      'metaImageSize',
    ])
  })

  it('warns when the description says again the title', () => {
    expect(repeatsTitle('Open source, in plain words', ['Open source, in plain words'])).toBe(true)
    expect(repeatsTitle('Open source in plain words · Demo', ['open source, in plain words'])).toBe(
      true
    )
    expect(repeatsTitle(DESCRIPTION, ['Open source, in plain words'])).toBe(false)
    expect(repeatsTitle('Whatever', ['  '])).toBe(false)
    const report = checkSeo({
      title: 'Open source, in plain words',
      metaTitle: 'Open source, in plain words · Demo site',
      metaDescription: 'Open source, in plain words. Open source, in plain words, twice!',
      image: GOOD,
    })
    expect(report.warnings).toEqual(['descriptionRepeatsTitle'])
  })

  it('generates the structured data and validates what is written by hand', () => {
    expect(structuredDataType('api::article.article', undefined)).toBe('Article')
    expect(structuredDataType('api::page.page', 'long-read')).toBe('Article')
    expect(structuredDataType('api::page.page', 'standard')).toBe('WebPage')
    expect(
      structuredDataFor({ type: 'WebPage', headline: 'A page', description: '', language: 'en' })
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      headline: 'A page',
      inLanguage: 'en',
    })
    expect(structuredDataProblem(undefined)).toBeNull()
    expect(structuredDataProblem('')).toBeNull()
    expect(
      structuredDataProblem({ '@context': 'https://schema.org', '@type': 'Article' })
    ).toBeNull()
    expect(
      structuredDataProblem('[{"@context":"https://schema.org","@type":"FAQPage"}]')
    ).toBeNull()
    expect(structuredDataProblem('{not json')).toBe('It is not valid JSON')
    expect(structuredDataProblem('"text"')).toMatch(/JSON object/)
    expect(structuredDataProblem({ '@type': 'Article' })).toMatch(/@context/)
    expect(structuredDataProblem({ '@context': 'https://schema.org' })).toMatch(/@type/)
    expect(structuredDataProblem([])).toMatch(/empty list/)
    expect(
      structuredDataProblem({ '@context': 'x', '@type': 'y', text: 'z'.repeat(20_000) })
    ).toMatch(/longer than/)
  })
})
