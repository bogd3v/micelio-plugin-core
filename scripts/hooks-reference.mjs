// Generates docs/hooks.md, the reference of the plugin hooks API, from the TSDoc of
// server/src/types/hooks.ts (section 6 of the standard). With --check it writes nothing and fails
// when the file on disk differs from what the source generates: `npm run lint:reference`.
//
//   node scripts/hooks-reference.mjs [--check] [--source path/to/hooks.ts] [--out path/to/hooks.md]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = 'MicelioHooks'
const HOOKS = 'HookPayloads'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : path.resolve(process.argv[index + 1])
}

// The TSDoc comment of a node, split into its summary and its block tags.
function tsdoc(node, text) {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? []
  const range = ranges.filter((r) => text.startsWith('/**', r.pos)).at(-1)
  if (!range) return { summary: '', tags: [] }
  const body = text
    .slice(range.pos + 3, range.end - 2)
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim()
  const [summary, ...rest] = body.split(/\n?(?=^@\w+)/m)
  const tags = rest.map((block) => {
    const [, tag, content] = /^@(\w+)\s*([\s\S]*)$/.exec(block)
    return { tag, content: content.trim() }
  })
  return { summary: summary.trim(), tags }
}

function prose(markdown) {
  return markdown.replace(/\{@link\s+([^}\s]+)\s*\}/g, '`$1`')
}

function tagsOf(doc, name) {
  return doc.tags.filter(({ tag }) => tag === name).map(({ content }) => prose(content))
}

function describe(doc) {
  return [prose(doc.summary), ...tagsOf(doc, 'remarks')].filter(Boolean).join('\n\n')
}

function anchor(name) {
  return `#${name.toLowerCase()}`
}

function render(sourcePath) {
  const text = readFileSync(sourcePath, 'utf8')
  const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true)
  const declarations = new Map()
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      declarations.set(statement.name.text, statement)
    }
  }
  const registry = declarations.get(REGISTRY)
  const hooks = declarations.get(HOOKS)
  if (!registry || !hooks) throw new Error(`${sourcePath} must declare ${REGISTRY} and ${HOOKS}`)

  const lines = [
    '# Hooks',
    '',
    '<!-- Generated from server/src/types/hooks.ts by `npm run reference`. Do not edit by hand. -->',
    '',
    'The hooks other plugins use to react to content without touching the core (ADR-0017, section 5): react to an editorial transition, a publication or a new site here, not to `publishedAt`, Strapi lifecycles or the `entry.publish` event.',
    '',
    describe(tsdoc(hooks, text)),
    '',
    '## Registering a handler',
    '',
    describe(tsdoc(registry, text)),
  ]
  for (const member of registry.members) {
    if (!ts.isMethodSignature(member)) continue
    const doc = tsdoc(member, text)
    const signature = member.getText(source).replace(/\s+/g, ' ')
    lines.push('', `### \`${member.name.getText(source)}\``, '', '```ts', signature, '```')
    lines.push('', describe(doc))
    for (const returns of tagsOf(doc, 'returns')) lines.push('', `Returns ${lowerFirst(returns)}`)
    for (const throws of tagsOf(doc, 'throws')) lines.push('', `Throws ${throws}`)
    for (const example of tagsOf(doc, 'example')) lines.push('', example)
  }

  lines.push('', '## Hooks', '', '| Hook | Payload | When |', '| --- | --- | --- |')
  const hookMembers = hooks.members.filter(ts.isPropertySignature)
  for (const member of hookMembers) {
    const payload = member.type.getText(source)
    const summary = prose(tsdoc(member, text).summary).replace(/\n/g, ' ')
    lines.push(
      `| [\`${member.name.getText(source)}\`](${anchor(member.name.getText(source))}) | [\`${payload}\`](${anchor(payload)}) | ${summary} |`
    )
  }
  for (const member of hookMembers) {
    const payload = member.type.getText(source)
    lines.push('', `### \`${member.name.getText(source)}\``, '', describe(tsdoc(member, text)))
    lines.push('', `Payload: [\`${payload}\`](${anchor(payload)}).`)
  }

  lines.push('', '## Types')
  for (const [name, declaration] of declarations) {
    if (name === REGISTRY || name === HOOKS) continue
    lines.push('', `### \`${name}\``, '', describe(tsdoc(declaration, text)))
    if (ts.isTypeAliasDeclaration(declaration)) {
      lines.push('', '```ts', declaration.getText(source), '```')
      continue
    }
    lines.push('', '| Field | Type | Description |', '| --- | --- | --- |')
    for (const field of declaration.members.filter(ts.isPropertySignature)) {
      const description = describe(tsdoc(field, text)).replace(/\n+/g, ' ')
      const type = field.type.getText(source).replace(/\|/g, '\\|')
      lines.push(`| \`${field.name.getText(source)}\` | \`${type}\` | ${description} |`)
    }
  }
  return lines.join('\n') + '\n'
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1)
}

const sourcePath = argument('--source', path.join(ROOT, 'server/src/types/hooks.ts'))
const outPath = argument('--out', path.join(ROOT, 'docs/hooks.md'))
const options = (await prettier.resolveConfig(outPath)) ?? {}
const generated = await prettier.format(render(sourcePath), { ...options, filepath: outPath })

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(outPath, 'utf8')
  } catch {
    // A missing reference is drift like any other: reported below.
  }
  if (current !== generated) {
    console.error(
      `${path.relative(ROOT, outPath)} is out of date with ${path.relative(ROOT, sourcePath)}: run npm run reference`
    )
    process.exit(1)
  }
} else {
  writeFileSync(outPath, generated)
}
