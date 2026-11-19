import { describe, expect, it } from 'vitest'
import {
  findHeadingFault,
  findProseHeadingViolation,
  headingsOf,
} from '../server/src/prose-headings/rules'

describe('headingsOf', () => {
  it('reads ATX headings with their level, text and line, closing hashes dropped', () => {
    expect(headingsOf('## One ##\n\ntext\n\n###### Six\n####### seven is text\n#nospace')).toEqual([
      { level: 2, text: 'One', line: 1 },
      { level: 6, text: 'Six', line: 5 },
    ])
  })

  it('reads setext headings, and a rule after a blank line is none', () => {
    expect(headingsOf('Title\n=====\n\nSub\n---\n\n---\n\n- item\n---')).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Sub', line: 4 },
    ])
  })

  it('leaves out what is inside a fenced code block, whatever the fence', () => {
    const body =
      '```\n# not\n```\n\n~~~~\n## not\n~~~\n### still code\n~~~~\n\n## yes\n\n````\n```\n# not\n````'
    expect(headingsOf(body)).toEqual([{ level: 2, text: 'yes', line: 11 }])
  })

  it('does not read an indented code line as a heading', () => {
    expect(headingsOf('    # code\n\n## real')).toEqual([{ level: 2, text: 'real', line: 3 }])
  })
})

describe('findHeadingFault', () => {
  it('accepts no headings, an opening h2 and levels that go back up', () => {
    expect(findHeadingFault('')).toBeNull()
    expect(findHeadingFault('text only')).toBeNull()
    expect(findHeadingFault('## a\n### b\n#### c\n## d\n### e')).toBeNull()
  })

  it('names the first fault: the opening heading, an h1 and a skipped level', () => {
    expect(findHeadingFault('# a')).toMatchObject({ reason: 'opensWithH1', line: 1 })
    expect(findHeadingFault('#### a')).toMatchObject({ reason: 'opensBelowH2', level: 4 })
    expect(findHeadingFault('## a\n\n# b')).toMatchObject({ reason: 'h1', heading: 'b', line: 3 })
    expect(findHeadingFault('## a\n#### b')).toMatchObject({
      reason: 'skipsLevel',
      level: 4,
      previousLevel: 2,
    })
    expect(findHeadingFault('## a\n### b\n##### c\n# d')).toMatchObject({ level: 5 })
  })
})

describe('findProseHeadingViolation', () => {
  const prose = (body: unknown) => ({ __component: 'shared.rich-text', body })

  it('finds the first bad prose block across zones, in order', () => {
    expect(
      findProseHeadingViolation({
        sections: [prose('## ok'), prose('x')],
        blocks: [{ __component: 'shared.quote' }, prose('# bad')],
      })
    ).toMatchObject({ zone: 'blocks', position: 1, block: 'prose', reason: 'opensWithH1' })
  })

  it('ignores section.rich-text, other blocks, non-text bodies and non-objects', () => {
    expect(
      findProseHeadingViolation({
        sections: [
          { __component: 'section.rich-text', body: '# free' },
          { __component: 'section.hero', body: '# x' },
          prose(null),
          prose(3),
          null,
          'text',
        ],
      })
    ).toBeNull()
  })

  it('checks nothing against a catalogue without prose', () => {
    expect(findProseHeadingViolation({ sections: [prose('# bad')] }, [])).toBeNull()
  })
})
