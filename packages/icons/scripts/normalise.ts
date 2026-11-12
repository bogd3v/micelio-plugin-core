// Turns one of Tabler's SVG files into the glyph `@micelio/icons` ships (ADR-0021, section 2):
// `viewBox="0 0 24 24"`, no `width`, `height`, `class`, `id`, `style`, colour literal or stroke
// width, stroke or fill by `currentColor`. Pure: it reads and writes strings.
import type { GlyphStyle } from '../src/types'

const ELEMENTS = ['path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect']
/** What the root carries, or the theme sets in CSS, or the glyph's own geometry makes redundant. */
const DROPPED = ['width', 'height', 'class', 'id', 'style', 'stroke-width']
/** The values of `fill` and `stroke` that are not a colour literal. */
const PAINTS = ['none', 'currentColor']
/** The transparent square Tabler puts first in every file: it paints nothing. */
const BOUNDING_BOX = 'M0 0h24v24H0z'

interface Child {
  tag: string
  attributes: [string, string][]
}

/**
 * The glyph a Tabler SVG becomes. The outline root keeps `stroke="currentColor"` with round caps
 * and joins and no `stroke-width`; the filled root is `fill="currentColor"`.
 *
 * @param source - A file of `icons/outline` or `icons/filled` of `@tabler/icons`.
 * @param style - Which of the two the file is.
 * @throws When the file has an element or a shape the normaliser does not know: a Tabler bump
 * that changes the format fails here, not in a page.
 */
export function normalise(source: string, style: GlyphStyle): string {
  const root = /^\s*<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(source)
  if (!root) throw new Error('not an SVG document')
  const rootAttributes = new Map(attributesOf(root[1]))
  if (rootAttributes.get('viewBox') !== '0 0 24 24') throw new Error('viewBox is not 0 0 24 24')
  const children = childrenOf(root[2])
    .filter((child) => !isBoundingBox(child))
    .map(clean)
  const head =
    style === 'outline'
      ? `fill="none" stroke="currentColor" stroke-linecap="${rootAttributes.get('stroke-linecap') ?? 'round'}" stroke-linejoin="${rootAttributes.get('stroke-linejoin') ?? 'round'}"`
      : 'fill="currentColor"'
  const body = children.map(
    ({ tag, attributes }) =>
      `<${tag}${attributes.map(([name, value]) => ` ${name}="${value}"`).join('')}/>`
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${head}>${body.join('')}</svg>`
}

/**
 * What a normalised glyph still breaks of the rules of ADR-0021, section 2. Empty when it is clean.
 */
export function violations(svg: string): string[] {
  const found: string[] = []
  const root = /^<svg\b([^>]*)>/.exec(svg)
  if (!root) return ['not an SVG document']
  if (!/\bviewBox="0 0 24 24"/.test(root[1])) found.push('viewBox is not 0 0 24 24')
  for (const name of DROPPED) {
    if (new RegExp(`\\s${name}=`).test(svg)) found.push(`has ${name}`)
  }
  for (const match of svg.matchAll(/\s(?:fill|stroke)="([^"]*)"/g)) {
    if (!PAINTS.includes(match[1])) found.push(`has the colour literal ${match[1]}`)
  }
  if (!/\s(?:fill|stroke)="currentColor"/.test(root[1])) found.push('root is not by currentColor')
  return found
}

function attributesOf(source: string): [string, string][] {
  return [...source.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]])
}

function childrenOf(source: string): Child[] {
  const children: Child[] = []
  let rest = source.trim()
  while (rest) {
    const match = /^<([a-zA-Z]+)\b([^>]*?)\s*\/>\s*/.exec(rest)
    if (!match) throw new Error(`unexpected markup: ${rest.slice(0, 40)}`)
    if (!ELEMENTS.includes(match[1])) throw new Error(`unsupported element <${match[1]}>`)
    children.push({ tag: match[1], attributes: attributesOf(match[2]) })
    rest = rest.slice(match[0].length)
  }
  return children
}

function isBoundingBox(child: Child): boolean {
  return (
    child.tag === 'path' &&
    child.attributes.some(([name, value]) => name === 'd' && value === BOUNDING_BOX) &&
    child.attributes.every(([name, value]) => name === 'd' || PAINTS.includes(value))
  )
}

function clean(child: Child): Child {
  return {
    tag: child.tag,
    attributes: child.attributes.filter(
      ([name, value]) =>
        !DROPPED.includes(name) &&
        !((name === 'fill' || name === 'stroke') && !PAINTS.includes(value))
    ),
  }
}
