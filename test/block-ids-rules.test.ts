import { describe, expect, it } from 'vitest'
import { assignIds, type Entry } from '../server/src/block-ids/rules'

const counter = () => {
  let n = 0
  return () => `new-${++n}`
}
const block = (component: string, blockId?: string): Entry => ({
  __component: component,
  ...(blockId && { blockId }),
})

describe('assignIds', () => {
  it('gives an entry with no id a fresh one and keeps the ids a create brings when unique', () => {
    const list = [block('a'), block('a', 'mine'), block('a', 'mine')]
    assignIds(list, [], 'blockId', counter())
    expect(list.map((entry) => entry.blockId)).toEqual(['new-1', 'mine', 'new-2'])
  })

  it('never takes a fresh id that the list already uses', () => {
    const list = [block('a', 'new-1'), block('a')]
    assignIds(list, [], 'blockId', counter())
    expect(list.map((entry) => entry.blockId)).toEqual(['new-1', 'new-2'])
  })

  it('keeps the stored id at a position over the one a save writes, and when it omits one', () => {
    const stored = [block('a', 'x'), block('b', 'y')]
    const list = [block('a', 'forged'), block('b')]
    assignIds(list, stored, 'blockId', counter())
    expect(list.map((entry) => entry.blockId)).toEqual(['x', 'y'])
  })

  it('moves an id with its entry on a reorder, and gives a new entry a fresh id', () => {
    const stored = [block('a', 'x'), block('b', 'y')]
    const list = [block('b', 'y'), block('a', 'x'), block('a')]
    assignIds(list, stored, 'blockId', counter())
    expect(list.map((entry) => entry.blockId)).toEqual(['y', 'x', 'new-1'])
  })

  it('keeps the original’s id when its copy, with no id, is placed above it', () => {
    const stored = [block('a', 'x'), block('b', 'y')]
    const list = [block('a'), block('a', 'x'), block('b', 'y')]
    assignIds(list, stored, 'blockId', counter())
    expect(list.map((entry) => entry.blockId)).toEqual(['new-1', 'x', 'y'])
  })

  it('does not hand a stored id to an entry of another component', () => {
    const stored = [block('a', 'x')]
    const list = [block('b', 'x')]
    assignIds(list, stored, 'blockId', counter())
    expect(list[0].blockId).toBe('new-1')
  })

  it('ignores what is not an object', () => {
    const list: unknown[] = [null, 'text', block('a')]
    assignIds(list, [], 'blockId', counter())
    expect(list[2]).toMatchObject({ blockId: 'new-1' })
  })
})
