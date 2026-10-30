// The block catalogue (ADR-0018): the contract of the blocks a page is made of. `npm run
// blocks:generate` writes `contract/blocks.schema.json` and the reference in `docs/blocks.md` from
// it, and `npm run lint:blocks` fails when either drifts. Changing an entry follows ADR-0018,
// section 2.
import { z } from 'zod'
import { OPTIONS, OPTION_NAMES, valuesFor, type OptionName } from './options'
import {
  boolean,
  component,
  enumeration,
  integer,
  media,
  part,
  relation,
  richtext,
  string,
  text,
  type Part,
} from './fields'

/** A presentation option: a closed set of values from the theme contract and its default. */
export interface BlockOption {
  /** The values an editor may pick, in the order a theme lists them. */
  values: readonly [string, ...string[]]
  default: string
}

/** The heavy island a block renders (`app/islands/lib/constants.ts` in `micelio`). */
interface BlockIsland {
  /** Its `id` in the heavy island registry. */
  id: string
  /** Its key in `scripts/perf/budgets.json` of `micelio`. */
  budget: string
  /** Gzip bytes of the JS the island loads once it is used, as its budget measures it. */
  js: number
}

/**
 * What a block adds to a page (ADR-0018, section 1), in gzip bytes.
 *
 * @remarks
 * Measured on `micelio` `v0.4.0` in the `bogota` and `starter` themes; the declared value is the
 * larger of the two. HTML bytes are not part of it. `docs/blocks.md` has the method and the numbers.
 */
interface BlockCost {
  /** Its CSS: the core's rules for the block and the theme's. */
  css: number
  /** Its JS in the page bundle: its components and the code only they use. */
  js: number
  /** The heavy island it renders, or `null` when it renders none. */
  island: BlockIsland | null
}

/** A block of the catalogue: `{ id, schema, options, cost, static }` (ADR-0018, section 1). */
export interface Block {
  /** Stable and kebab-case: stored content, themes and the visual editor refer to the block by it. */
  id: string
  /** Where the block lives today: a page section or an article and About block. */
  group: BlockGroup
  /** The Strapi component that stores the block's content, with its parts nested. */
  schema: Part
  /**
   * The presentation options the block exposes: `variant` and names of the vocabulary
   * (`contract/options.ts`). Each is stored inside the component (ADR-0018).
   */
  options: BlockOptions
  cost: BlockCost
  /** What the block renders with no JavaScript: before hydration, and always in static builds. */
  static: string
}

/** The options a block exposes, by name. */
export type BlockOptions = { variant?: BlockOption } & { [Name in OptionName]?: BlockOption }

/** Where a block can be used today. */
type BlockGroup = 'section' | 'article'

/** The text of a `static` alternative for a block that needs no JavaScript. */
const ITSELF = 'Itself: the block needs no JavaScript.'

// Parts (ADR-0018, section 6, "Parts and fields"): they are nested in the blocks that use them and
// are never entries of the catalogue.
const link = part('section.link', {
  label: string({ required: true }),
  url: string({ required: true, regex: '^(https?://\\S+|mailto:\\S+|/\\S*)$' }),
})
const featureItem = part('section.feature-item', {
  icon: media(['images']),
  title: string({ required: true }),
  text: text(),
})
const faqItem = part('section.faq-item', {
  question: string({ required: true }),
  answer: richtext({ required: true }),
})
const logo = part('section.logo', {
  image: media(['images'], { required: true }),
  name: string({ required: true }),
  url: string({ regex: '^https?://\\S+$' }),
})
const plan = part('section.plan', {
  name: string({ required: true }),
  price: string({ required: true }),
  period: string(),
  features: text({ description: 'One feature per line' }),
  link: component(link),
  recommended: boolean({ default: false }),
})
const stat = part('section.stat', {
  value: string({ required: true }),
  label: string({ required: true }),
})
const testimonial = part('section.testimonial', {
  quote: text({ required: true }),
  author: string({ required: true }),
  role: string(),
  avatar: media(['images']),
})
const imageCredit = part('shared.image-credit', {
  kind: enumeration(['photo', 'illustration', 'diagram', 'screenshot'], {
    required: true,
    default: 'photo',
  }),
  author: string(),
  authorUrl: string({ regex: '^https?://\\S+$' }),
  source: string(),
  sourceUrl: string({ regex: '^https?://\\S+$' }),
  license: enumeration(
    [
      'own-work',
      'cc0',
      'public-domain',
      'cc-by-4.0',
      'cc-by-sa-4.0',
      'cc-by-nc-4.0',
      'unsplash',
      'permission',
      'other',
    ],
    { required: true }
  ),
  licenseUrl: string({ regex: '^https?://\\S+$' }),
  modifications: string(),
})
const slide = part('shared.slide', {
  file: media(['images'], { required: true }),
  caption: text(),
  credit: component(imageCredit),
})

/** The block catalogue: the 19 blocks of ADR-0018, section 6, read only. */
export const BLOCKS: readonly Block[] = [
  {
    id: 'hero',
    group: 'section',
    schema: part('section.hero', {
      title: string({ required: true }),
      text: text(),
      primaryLink: component(link),
      secondaryLink: component(link),
      media: media(['images', 'videos']),
    }),
    options: {
      variant: variant('centered', 'split', 'full-bleed'),
      ...presentation('hero', 'section', 'layout', 'tone', 'height'),
    },
    cost: { css: 737, js: 1556, island: null },
    static: ITSELF,
  },
  {
    id: 'feature-grid',
    group: 'section',
    schema: part('section.feature-grid', {
      title: string(),
      text: text(),
      items: component(featureItem, { repeatable: true, min: 3, max: 6 }),
    }),
    options: {
      variant: variant('grid', 'list', 'bento'),
      ...presentation('feature-grid', 'section', 'columns', 'density'),
    },
    cost: { css: 643, js: 1350, island: null },
    static: ITSELF,
  },
  {
    id: 'media-showcase',
    group: 'section',
    schema: part('section.media-showcase', {
      title: string(),
      text: richtext(),
      media: media(['images', 'videos'], { required: true }),
      link: component(link),
    }),
    options: {
      variant: variant('left', 'right', 'stacked'),
      ...presentation('media-showcase', 'section', 'ratio'),
    },
    cost: { css: 214, js: 1423, island: null },
    static: 'Itself: the block needs no JavaScript, and a video shows its native controls.',
  },
  {
    id: 'stats',
    group: 'section',
    schema: part('section.stats', {
      title: string(),
      items: component(stat, { repeatable: true, min: 2, max: 4 }),
    }),
    options: {
      variant: variant('row', 'cards'),
      ...presentation('stats', 'section', 'columns', 'align', 'tone'),
    },
    cost: { css: 527, js: 540, island: null },
    static: ITSELF,
  },
  {
    id: 'logo-cloud',
    group: 'section',
    schema: part('section.logo-cloud', {
      title: string(),
      logos: component(logo, { repeatable: true, min: 1 }),
    }),
    options: {
      variant: variant('row', 'marquee'),
      ...presentation('logo-cloud', 'section', 'columns', 'density'),
    },
    cost: { css: 497, js: 1446, island: null },
    static:
      'Itself: the marquee is CSS only, and it stops under reduced motion and when a logo is a link.',
  },
  {
    id: 'testimonials',
    group: 'section',
    schema: part('section.testimonials', {
      title: string(),
      items: component(testimonial, { repeatable: true, min: 1 }),
    }),
    options: {
      variant: variant('single', 'grid'),
      ...presentation('testimonials', 'section', 'layout', 'density'),
    },
    cost: { css: 599, js: 1482, island: null },
    static: ITSELF,
  },
  {
    id: 'pricing',
    group: 'section',
    schema: part('section.pricing', {
      title: string(),
      text: text(),
      plans: component(plan, { repeatable: true, min: 1 }),
    }),
    options: {
      variant: variant('cards', 'table'),
      ...presentation('pricing', 'section', 'columns'),
    },
    cost: { css: 805, js: 1186, island: null },
    static: ITSELF,
  },
  {
    id: 'faq',
    group: 'section',
    schema: part('section.faq', {
      title: string(),
      items: component(faqItem, { repeatable: true, min: 1 }),
    }),
    options: {
      variant: variant('list', 'two-columns'),
      ...presentation('faq', 'section', 'density'),
    },
    cost: { css: 527, js: 525, island: null },
    static: 'Itself: the answers open and close with the native `<details>` element.',
  },
  {
    id: 'cta',
    group: 'section',
    schema: part('section.cta', {
      title: string({ required: true }),
      text: text(),
      primaryLink: component(link),
      secondaryLink: component(link),
    }),
    options: {
      variant: variant('banner', 'card'),
      ...presentation('cta', 'section', 'layout', 'align', 'tone'),
    },
    cost: { css: 483, js: 803, island: null },
    static: ITSELF,
  },
  {
    id: 'post-list',
    group: 'section',
    schema: part('section.post-list', {
      title: string(),
      category: relation('api::category.category'),
      tag: relation('api::tag.tag'),
      count: integer({ required: true, min: 1, max: 12, default: 3 }),
    }),
    options: {
      variant: variant('cards', 'list'),
      ...presentation('post-list', 'section', 'density'),
    },
    cost: { css: 376, js: 768, island: null },
    static: 'Itself: the posts are rendered with the page.',
  },
  {
    id: 'newsletter',
    group: 'section',
    schema: part('section.newsletter', {
      title: string(),
      text: text(),
      buttonLabel: string(),
    }),
    options: {
      variant: variant('inline', 'card'),
      ...presentation('newsletter', 'section', 'align', 'tone'),
    },
    cost: { css: 763, js: 1822, island: null },
    static:
      'In static builds, the static form (`MycNewsletterStatic`). In dynamic mode the form submits ' +
      'only once hydrated (a known limitation, `docs/blocks.md`). Nothing when the `newsletter` ' +
      'module is off.',
  },
  {
    id: 'rich-text',
    group: 'section',
    schema: part('section.rich-text', {
      body: richtext({ required: true }),
    }),
    options: { ...presentation('rich-text', 'section', 'width') },
    cost: { css: 1940, js: 226, island: null },
    static: ITSELF,
  },
  {
    id: 'gallery',
    group: 'section',
    schema: part('section.gallery', {
      title: string(),
      images: media(['images'], { required: true, multiple: true }),
    }),
    options: {
      variant: variant('grid', 'masonry'),
      ...presentation('gallery', 'section', 'width', 'density'),
    },
    cost: { css: 425, js: 1251, island: null },
    static: ITSELF,
  },
  {
    id: 'scene',
    group: 'section',
    schema: part('section.scene', {
      model: media(['files'], { required: true }),
      poster: media(['images'], { required: true }),
      alt: string({ required: true }),
      title: string(),
      text: text(),
    }),
    options: {
      variant: variant('background', 'inline'),
      ...presentation('scene', 'section', 'height'),
    },
    cost: { css: 601, js: 1303, island: { id: 'scene', budget: 'scene', js: 154900 } },
    static: 'The required poster, with the alt text of the scene.',
  },
  {
    id: 'prose',
    group: 'article',
    schema: part('shared.rich-text', {
      body: richtext(),
    }),
    options: {},
    cost: { css: 1895, js: 610, island: null },
    static:
      'Itself: the block needs no JavaScript. A Mermaid diagram inside it is the `mermaid` island, ' +
      'and shows its source until it loads.',
  },
  {
    id: 'quote',
    group: 'article',
    schema: part('shared.quote', {
      title: string(),
      body: text(),
    }),
    options: { ...presentation('quote', 'article', 'width', 'align') },
    cost: { css: 293, js: 259, island: null },
    static: ITSELF,
  },
  {
    id: 'media',
    group: 'article',
    schema: part('shared.media', {
      file: media(['images', 'files', 'videos']),
      caption: text(),
      credit: component(imageCredit),
    }),
    options: { ...presentation('media', 'article', 'width', 'ratio') },
    cost: { css: 543, js: 1400, island: null },
    static: ITSELF,
  },
  {
    id: 'slider',
    group: 'article',
    schema: part('shared.slider', {
      items: component(slide, { repeatable: true }),
      files: media(['images'], { multiple: true }),
    }),
    options: { ...presentation('slider', 'article', 'ratio') },
    cost: { css: 1545, js: 2615, island: null },
    static: 'The first slide, with its caption and credit; the controls work once hydrated.',
  },
  {
    id: 'playground',
    group: 'article',
    schema: part('shared.playground', {
      runtime: enumeration(['python', 'sql', 'javascript'], { required: true }),
      code: text({ required: true, maxLength: 5000 }),
      expectedOutput: text({ maxLength: 5000 }),
      setup: text({ maxLength: 20000 }),
      caption: text(),
    }),
    options: { ...presentation('playground', 'article', 'height') },
    cost: { css: 633, js: 1758, island: { id: 'playground', budget: 'playground', js: 67645 } },
    static: 'The highlighted code and its expected output.',
  },
]

/**
 * The options of a block as the content API answers them: each one's name with its values and
 * default, `variant` first and then the vocabulary's order.
 */
export function optionsOf(block: Block): [string, BlockOption][] {
  return (['variant', ...OPTION_NAMES] as const).flatMap((name) => {
    const option = block.options[name]
    return option ? [[name, option] as [string, BlockOption]] : []
  })
}

/** The content of one block as the content API answers it, options included, for validation. */
export function blockContentSchema(block: Block): z.ZodObject {
  const options = optionsOf(block)
  if (!options.length) return block.schema.fields
  return block.schema.fields.extend(
    Object.fromEntries(
      options.map(([name, option]) => [
        name,
        // `variant` is required in Strapi; the vocabulary's options are optional and have a default.
        enumeration(option.values, { required: name === 'variant', default: option.default }),
      ])
    )
  )
}

function variant(...values: [string, ...string[]]): BlockOption {
  return { values, default: values[0] }
}

// The vocabulary's options a block exposes, with the values the vocabulary lets this block offer and its default.
function presentation(id: string, group: BlockGroup, ...names: OptionName[]): BlockOptions {
  return Object.fromEntries(
    names.map((name) => [
      name,
      { values: valuesFor(name, { id, group }), default: OPTIONS[name].default },
    ])
  )
}
