// Measures the `cost` of each block of the catalogue (ADR-0018, section 1) on a production build
// of `micelio`. `docs/blocks.md`, "How cost is measured", has the method and the commands.
//
//   node scripts/blocks/cost.mjs --build <theme>=<dir> [--islands <theme>=<report.json>] ...
//
// `<dir>` is `.output/public` of `nuxt build` with client source maps, one per theme;
// `<report.json>` is the `--out` of `scripts/perf/measure.mjs` for the same build.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { decode } from '@jridgewell/sourcemap-codec'
import postcss from 'postcss'

// The parts of the section kit a section renders through; `SectionRenderer` itself is the page's.
const HEAD = 'components/section/SectionHead.vue'
const LINK = 'components/section/SectionLink.vue'
const MEDIA = 'components/section/SectionMedia.vue'
const FIGURE_CREDIT = 'components/myc/MycFigureCredit.vue'
const FIGURES = 'helpers/figures.ts'
// Markdown as the frontend renders it: prose, code blocks, callouts and the Mermaid placeholder.
const MARKDOWN = ['.myc-prose', '.myc-code', '.myc-callout', '.myc-mermaid']

// What belongs to each block: the source files of its JS (relative to `app/`) and the selectors of
// its CSS (a `section:<id>` is `[data-section=<id>]`; a class matches itself and its `-` family).
// What every page loads anyway (the button, `useStrapi`, the post card of the blog) is not counted.
const OWNERS = {
  hero: {
    js: ['components/section/SectionHero.vue', HEAD, LINK, MEDIA],
    css: ['section:hero'],
  },
  'feature-grid': {
    js: ['components/section/SectionFeatureGrid.vue', HEAD, MEDIA],
    css: ['section:feature-grid', '.myc-section-icon'],
  },
  'media-showcase': {
    js: ['components/section/SectionMediaShowcase.vue', LINK, MEDIA],
    css: ['section:media-showcase'],
  },
  stats: {
    js: ['components/section/SectionStats.vue', HEAD],
    css: ['section:stats', '.myc-section-stat'],
  },
  'logo-cloud': {
    js: ['components/section/SectionLogoCloud.vue', HEAD, MEDIA],
    css: ['section:logo-cloud', '.myc-section-logo', '@keyframes myc-section-marquee'],
  },
  testimonials: {
    js: ['components/section/SectionTestimonials.vue', HEAD, MEDIA],
    css: ['section:testimonials', '.myc-section-quote', '.myc-section-author'],
  },
  pricing: {
    js: ['components/section/SectionPricing.vue', HEAD, LINK],
    css: ['section:pricing', '.myc-section-plan'],
  },
  faq: {
    js: ['components/section/SectionFaq.vue', HEAD],
    css: ['section:faq', '.myc-section-question', '.myc-section-answer'],
  },
  cta: {
    js: ['components/section/SectionCta.vue', HEAD, LINK],
    css: ['section:cta'],
  },
  'post-list': {
    js: ['components/section/SectionPostList.vue', HEAD],
    css: ['section:post-list'],
  },
  newsletter: {
    js: [
      'components/section/SectionNewsletter.vue',
      HEAD,
      'components/myc/MycNewsletterForm.vue',
      'composables/useNewsletter.ts',
      'helpers/newsletter.ts',
    ],
    css: ['section:newsletter', '.myc-news'],
  },
  'rich-text': {
    js: ['components/section/SectionRichText.vue'],
    css: ['section:rich-text', ...MARKDOWN],
  },
  gallery: {
    js: ['components/section/SectionGallery.vue', HEAD, MEDIA],
    css: ['section:gallery'],
  },
  scene: {
    js: ['components/section/SectionScene.vue', HEAD, MEDIA],
    css: ['section:scene', 'micelio-scene'],
  },
  prose: {
    js: ['components/strapi/RichTextBlock.vue', 'composables/useCodeBlockCopy.ts'],
    css: MARKDOWN,
  },
  quote: {
    js: ['components/strapi/QuoteBlock.vue'],
    css: ['.myc-quote'],
  },
  media: {
    js: ['components/strapi/MediaBlock.vue', FIGURE_CREDIT, FIGURES],
    css: ['.myc-fig', '.myc-credit'],
  },
  slider: {
    js: ['components/strapi/SliderBlock.vue', FIGURE_CREDIT, FIGURES],
    css: ['.myc-slider', '.myc-fig', '.myc-credit'],
  },
  playground: {
    js: [
      'components/strapi/PlaygroundBlock.vue',
      'components/myc/MycCodeBlock.vue',
      'helpers/playground.ts',
      'helpers/playgroundRunner.ts',
    ],
    css: ['.myc-playground'],
  },
}

// A heavy island takes its bytes from the measurement of its own budget (`scripts/perf/budgets.json`).
const ISLAND_BUDGETS = { scene: 'scene', playground: 'playground' }

const { values } = parseArgs({
  options: {
    build: { type: 'string', multiple: true },
    islands: { type: 'string', multiple: true, default: [] },
  },
})
const builds = pairs(values.build ?? [])
const islandReports = pairs(values.islands)
if (!builds.size)
  throw new Error('--build <theme>=<dir of .output/public> is required, once per theme')

const results = {}
for (const [theme, dir] of builds) {
  const nuxt = join(dir, '_nuxt')
  const js = jsBySource(nuxt)
  const rules = cssRules(nuxt)
  const report = islandReports.has(theme)
    ? JSON.parse(readFileSync(islandReports.get(theme), 'utf8'))
    : undefined
  for (const [id, owner] of Object.entries(OWNERS)) {
    const missing = owner.js.filter((file) => !js.has(file))
    if (missing.length) throw new Error(`${theme}: no code of ${missing.join(', ')} in ${nuxt}`)
    const budget = ISLAND_BUDGETS[id]
    const island = budget && report?.islands?.[budget]
    if (budget && !island) throw new Error(`${theme}: no measurement of island ${budget}`)
    results[id] ??= {}
    results[id][theme] = {
      css: gzipBytes(
        rules
          .filter((rule) => owner.css.some((token) => matches(rule, token)))
          .map((rule) => rule.text)
          .join('')
      ),
      js: gzipBytes(owner.js.map((file) => js.get(file)).join('')),
      ...(island && { island: Math.round(island.scriptGzKb * 1024) }),
    }
  }
}

const declared = Object.fromEntries(
  Object.entries(results).map(([id, byTheme]) => {
    const measured = Object.values(byTheme)
    const max = (key) => Math.max(...measured.map((entry) => entry[key] ?? 0))
    return [
      id,
      { css: max('css'), js: max('js'), ...(ISLAND_BUDGETS[id] && { island: max('island') }) },
    ]
  })
)
console.log(JSON.stringify({ byTheme: results, declared }, null, 2))

function pairs(list) {
  return new Map(
    list.map((entry) => {
      const at = entry.indexOf('=')
      if (at < 1) throw new Error(`expected <theme>=<path>, got "${entry}"`)
      return [entry.slice(0, at), entry.slice(at + 1)]
    })
  )
}

// The generated code each source file contributes to the client chunks, by its source map.
function jsBySource(dir) {
  const code = new Map()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    let map
    try {
      map = JSON.parse(readFileSync(join(dir, `${file}.map`), 'utf8'))
    } catch {
      // A chunk without a map (a Nuxt virtual module) holds none of the blocks' code.
      continue
    }
    const lines = readFileSync(join(dir, file), 'utf8').split('\n')
    decode(map.mappings).forEach((segments, index) => {
      const line = lines[index] ?? ''
      segments.forEach((segment, at) => {
        if (segment.length < 2) return
        const source = map.sources[segment[1]].replace(/^(\.\.\/)*app\//, '')
        const end = segments[at + 1]?.[0] ?? line.length
        code.set(source, (code.get(source) ?? '') + line.slice(segment[0], end))
      })
    })
  }
  return code
}

// Every style rule and keyframes block of the built CSS: its selector, and its text inside its at-rules.
function cssRules(dir) {
  const rules = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.css'))) {
    postcss.parse(readFileSync(join(dir, file), 'utf8')).walk((node) => {
      const inKeyframes = node.parent?.type === 'atrule' && node.parent.name === 'keyframes'
      if (node.type === 'rule' && !inKeyframes)
        rules.push({ selector: node.selector, text: wrap(node) })
      if (node.type === 'atrule' && node.name === 'keyframes') {
        rules.push({ selector: `@keyframes ${node.params}`, text: wrap(node) })
      }
    })
  }
  return rules
}

function wrap(node) {
  let text = node.toString()
  for (let parent = node.parent; parent?.type === 'atrule'; parent = parent.parent) {
    text = `@${parent.name} ${parent.params}{${text}}`
  }
  return text
}

function matches({ selector }, token) {
  if (token.startsWith('@keyframes ')) return selector === token
  if (token.startsWith('section:')) {
    return new RegExp(`\\[data-section=["']?${token.slice(8)}["']?\\]`).test(selector)
  }
  return new RegExp(`${token.replace('.', '\\.')}(?![\\w])`).test(selector)
}

function gzipBytes(text) {
  return text ? gzipSync(text).length : 0
}
