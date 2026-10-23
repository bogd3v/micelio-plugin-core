// Writes the JSON Schema of the block catalogue and its reference from `contract/blocks.ts`
// (ADR-0018, section 3). With `--check` it writes nothing and fails when either file drifts.
//
//   npm run blocks:generate   # write contract/blocks.schema.json and the reference in docs/blocks.md
//   npm run lint:blocks       # the same, as a check
import { readFileSync, writeFileSync } from 'node:fs'
import prettier from 'prettier'
import { BLOCKS, type Block } from '../../contract/blocks'
import { blockJsonSchema, strapiComponents, type StrapiAttribute } from '../../contract/strapi'

const SCHEMA_FILE = new URL('../../contract/blocks.schema.json', import.meta.url)
const DOCS_FILE = new URL('../../docs/blocks.md', import.meta.url)
const START = '<!-- blocks:reference:start (npm run blocks:generate) -->'
const END = '<!-- blocks:reference:end -->'

const isCheck = process.argv.includes('--check')
const drifted: string[] = []

await write(SCHEMA_FILE, JSON.stringify(catalogueSchema()), 'json')
const docs = readFileSync(DOCS_FILE, 'utf8')
const start = docs.indexOf(START)
const end = docs.indexOf(END)
if (start < 0 || end < start)
  throw new Error(`docs/blocks.md needs the markers ${START} and ${END}`)
await write(
  DOCS_FILE,
  `${docs.slice(0, start + START.length)}\n\n${reference()}\n\n${docs.slice(end)}`,
  'markdown'
)

if (drifted.length) {
  console.error(
    `${drifted.join(' and ')} drifted from contract/blocks.ts: run npm run blocks:generate`
  )
  process.exitCode = 1
}

function catalogueSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Micelio block catalogue',
    description:
      'The content of each block of the catalogue as the content API answers it, options included. ' +
      'Generated from contract/blocks.ts of @micelio/strapi-plugin-core (ADR-0018); do not edit.',
    $defs: Object.fromEntries(BLOCKS.map((block) => [block.id, blockJsonSchema(block)])),
  }
}

function reference(): string {
  const parts = new Map<string, Record<string, StrapiAttribute>>()
  const sections = BLOCKS.map((block) => {
    const { component, components } = strapiComponents(block)
    for (const [uid, attributes] of Object.entries(components)) {
      if (uid !== component) parts.set(uid, attributes)
    }
    return blockSection(block, components[component])
  })
  const partSections = [...parts.keys()].sort().map((uid) => {
    const users = BLOCKS.filter((block) => uid in strapiComponents(block).components)
    return [
      `### \`${uid}\``,
      `Nested in ${users.map((block) => `\`${block.id}\``).join(', ')}.`,
      fieldTable(parts.get(uid) ?? {}),
    ].join('\n\n')
  })
  return [
    '## Blocks',
    summaryTable(),
    ...sections,
    '## Parts',
    'Nested components: each exists only inside the `schema` of the blocks listed with it.',
    ...partSections,
  ].join('\n\n')
}

function summaryTable(): string {
  const rows = BLOCKS.map((block) => {
    const island = block.cost.island ? `\`${block.cost.island.id}\`` : 'No'
    const variant = block.options.variant?.values.map((value) => `\`${value}\``).join(', ') ?? ''
    return `| \`${block.id}\` | \`${block.schema.component}\` | ${variant} | ${block.cost.css} | ${block.cost.js} | ${island} |`
  })
  return [
    '| id | Component | `variant` (default first) | CSS (B gzip) | JS (B gzip) | Island |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

function blockSection(block: Block, attributes: Record<string, StrapiAttribute>): string {
  const content = Object.fromEntries(
    Object.entries(attributes).filter(([name]) => name !== 'variant')
  )
  const variant = block.options.variant
  const island = block.cost.island
  const lines = [
    `- **Component:** \`${block.schema.component}\` (${block.group === 'section' ? 'page sections' : 'article and About blocks'})`,
    `- **Options:** ${variant ? `\`variant\`: ${variant.values.map((value) => `\`${value}\``).join(', ')}; default \`${variant.default}\`` : 'none'}`,
    `- **Cost:** ${block.cost.css} B of CSS and ${block.cost.js} B of JS, gzip${island ? `; the \`${island.id}\` island (budget \`${island.budget}\`) loads ${island.js} B of JS, gzip, once used` : ''}`,
    `- **Static:** ${block.static}`,
  ]
  return [`### \`${block.id}\``, lines.join('\n'), fieldTable(content)].join('\n\n')
}

function fieldTable(attributes: Record<string, StrapiAttribute>): string {
  const rows = Object.entries(attributes).map(
    ([name, attribute]) =>
      `| \`${name}\` | ${typeOf(attribute)} | ${attribute.required ? 'Yes' : 'No'} | ${detailsOf(attribute)} |`
  )
  return ['| Field | Type | Required | Details |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

function typeOf(attribute: StrapiAttribute): string {
  switch (attribute.type) {
    case 'media':
      return `media${attribute.multiple ? ', several' : ''} (${(attribute.allowedTypes as string[]).join(', ')})`
    case 'component':
      return `\`${String(attribute.component)}\`${attribute.repeatable ? ', repeatable' : ''}`
    case 'relation':
      return `relation to \`${String(attribute.target)}\``
    default:
      return attribute.type
  }
}

function detailsOf(attribute: StrapiAttribute): string {
  const details: string[] = []
  if (attribute.enum)
    details.push((attribute.enum as string[]).map((value) => `\`${value}\``).join(', '))
  // A `|` inside a table cell, even in code, ends the cell unless it is escaped.
  if (attribute.regex) details.push(`matches \`${String(attribute.regex).replaceAll('|', '\\|')}\``)
  if (attribute.minLength !== undefined)
    details.push(`at least ${String(attribute.minLength)} characters`)
  if (attribute.maxLength !== undefined)
    details.push(`at most ${String(attribute.maxLength)} characters`)
  if (attribute.min !== undefined) details.push(`at least ${String(attribute.min)}`)
  if (attribute.max !== undefined) details.push(`at most ${String(attribute.max)}`)
  if (attribute.default !== undefined) details.push(`default \`${String(attribute.default)}\``)
  if (attribute.description) details.push(String(attribute.description))
  return details.join('; ')
}

async function write(file: URL, content: string, parser: 'json' | 'markdown'): Promise<void> {
  const options = await prettier.resolveConfig(file)
  const formatted = await prettier.format(content, { ...options, parser })
  let current = ''
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    // A missing file is written, or drifted under --check.
  }
  if (current === formatted) return
  if (isCheck) drifted.push(file.pathname.split('/').slice(-2).join('/'))
  else writeFileSync(file, formatted)
}
