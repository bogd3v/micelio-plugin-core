import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalise, violations } from '../scripts/normalise'
import { TABLER_ROOT } from '../scripts/tabler'

const OUTLINE = `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="icon icon-tabler icons-tabler-outline icon-tabler-map-pin"
  style="color: red"
  id="pin"
>
  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
  <path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" class="a" id="b" style="fill: red" stroke="#ff0000" />
  <circle cx="12" cy="12" r="2" fill="rgb(1,2,3)" stroke-width="3" />
</svg>`

const FILLED = `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="currentColor"
  class="icon icon-tabler icons-tabler-filled icon-tabler-map-pin"
>
  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
  <path d="M18.364 4.636a9 9 0 0 1 .203 12.519" />
</svg>`

describe('the normaliser', () => {
  it('strips width, height, class, id, style and colour literals and keeps stroke by currentColor', () => {
    const svg = normalise(OUTLINE, 'outline')
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>' +
        '<circle cx="12" cy="12" r="2"/>' +
        '</svg>'
    )
    for (const attribute of ['width', 'height', 'class', 'id', 'style', 'stroke-width']) {
      expect(svg).not.toContain(`${attribute}=`)
    }
    expect(svg).not.toMatch(/#ff0000|rgb\(/)
    expect(violations(svg)).toEqual([])
  })

  it('keeps the filled alternate of a name that has one', () => {
    const svg = normalise(FILLED, 'filled')
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M18.364 4.636a9 9 0 0 1 .203 12.519"/>' +
        '</svg>'
    )
    expect(svg).not.toContain('stroke')
    expect(violations(svg)).toEqual([])
  })

  it('refuses what it does not know instead of shipping it', () => {
    const wrap = (inner: string, viewBox = '0 0 24 24') =>
      `<svg viewBox="${viewBox}" fill="none">${inner}</svg>`
    expect(() => normalise(wrap('<script/>'), 'outline')).toThrow('unsupported element <script>')
    expect(() => normalise(wrap('<g><path d="M0 0"/></g>'), 'outline')).toThrow('unexpected markup')
    expect(() => normalise(wrap('<path d="M0 0"/>', '0 0 16 16'), 'outline')).toThrow('viewBox')
    expect(() => normalise('<div/>', 'outline')).toThrow('not an SVG document')
  })

  it('finds what a glyph still breaks', () => {
    expect(
      violations(
        '<svg viewBox="0 0 16 16" width="16" fill="#fff" stroke="currentColor"><path/></svg>'
      )
    ).toEqual(['viewBox is not 0 0 24 24', 'has width', 'has the colour literal #fff'])
    expect(violations('<svg viewBox="0 0 24 24"><path/></svg>')).toEqual([
      'root is not by currentColor',
    ])
  })

  it('leaves no violation in any of the 6000 files of the pinned Tabler', () => {
    let count = 0
    for (const style of ['outline', 'filled'] as const) {
      const folder = path.join(TABLER_ROOT, 'icons', style)
      for (const file of readdirSync(folder)) {
        const svg = normalise(readFileSync(path.join(folder, file), 'utf8'), style)
        expect(violations(svg), `${style}/${file}`).toEqual([])
        count++
      }
    }
    expect(count).toBeGreaterThan(6000)
  })
})
