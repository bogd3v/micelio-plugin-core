import { describe, expect, it } from 'vitest'
import {
  GROUPS,
  SHORTCUTS,
  keyCaps,
  matchShortcut,
  nextGap,
  type Chord,
  type KeyPress,
  type Where,
} from '../admin/src/shortcuts'
import { EMPTY_HISTORY, redo, remember, undo } from '../admin/src/utils/builder/history'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'

const CALM: Where = {
  isField: false,
  isInPreview: false,
  isOnList: false,
  isOnControl: false,
  isInteractive: false,
  isCarrying: false,
}

/** The key press that a chord names, as a browser reports it. */
function pressOf(chord: Chord): KeyPress {
  return {
    code: chord.code ?? 'Slash',
    key: chord.key ?? chord.code ?? '',
    ctrlKey: chord.mod === true,
    metaKey: false,
    shiftKey: chord.shift === true,
    altKey: chord.alt === true,
  }
}

/** Where focus must be for the action to fire at all. */
const whereFor = (scope: string, id: string): Where => ({
  ...CALM,
  isOnList: scope === 'list',
  isOnControl: scope === 'control',
  isCarrying: id === 'carry',
})

const chordsOf = () =>
  SHORTCUTS.flatMap((shortcut) =>
    shortcut.keys.map((chord, index) => ({ shortcut, chord: chord as Chord, index }))
  )

describe('the table of shortcuts', () => {
  it('runs each key of each action as the action it names, and no key shadows another', () => {
    for (const { shortcut, chord, index } of chordsOf()) {
      expect(matchShortcut(pressOf(chord), whereFor(shortcut.scope, shortcut.id))).toEqual({
        id: shortcut.id,
        index,
      })
    }
  })

  it('has a label in both locales for each action and group, and no label without one', () => {
    for (const locale of [en, es] as Record<string, string>[]) {
      for (const { id } of SHORTCUTS) expect(locale[`shortcuts.${id}`], id).toBeTruthy()
      for (const group of GROUPS) expect(locale[`shortcuts.group.${group}`], group).toBeTruthy()
      const labelled = Object.keys(locale).filter(
        (key) => key.startsWith('shortcuts.') && !key.startsWith('shortcuts.group.')
      )
      const own = new Set(['title', 'subtitle', 'close', 'rules', 'rulesLabel'])
      expect(
        labelled.filter(
          (key) => !own.has(key.slice(10)) && !SHORTCUTS.some((s) => `shortcuts.${s.id}` === key)
        )
      ).toEqual([])
    }
  })

  it('fires only save, undo, redo and Esc inside a field', () => {
    const inField = { ...CALM, isField: true, isOnList: true, isOnControl: true }
    const fired = new Set<string>()
    for (const { chord } of chordsOf()) {
      const found = matchShortcut(pressOf(chord), inField)
      if (found) fired.add(`${found.id}:${found.index}`)
    }
    expect([...fired].sort()).toEqual(['parent:0', 'save:0', 'undo:0', 'undo:1'])
  })

  it('fires no key without a modifier inside the preview, Esc excepted', () => {
    const inPreview = { ...CALM, isInPreview: true, isOnList: true, isOnControl: true }
    const fired = chordsOf()
      .filter(({ chord }) => !chord.mod && !chord.alt)
      .flatMap(({ chord }) => matchShortcut(pressOf(chord), inPreview) ?? [])
      .map(({ id }) => id)
    expect([...new Set(fired)]).toEqual(['parent'])
    // The chords with ⌘, Ctrl or ⌥ are not single keys: they still run there.
    expect(matchShortcut(pressOf({ code: 'KeyS', mod: true }), inPreview)?.id).toBe('save')
  })

  it('leaves Enter to a button and takes it from a row of the list', () => {
    const enter = pressOf({ code: 'Enter' })
    expect(matchShortcut(enter, { ...CALM, isInteractive: true })).toBeUndefined()
    expect(matchShortcut(enter, { ...CALM, isInteractive: true, isOnList: true })?.id).toBe(
      'palette'
    )
    expect(matchShortcut(enter, CALM)?.id).toBe('palette')
  })

  it('gives the arrows to the choice they are on, and to a block picked up', () => {
    const left = pressOf({ code: 'ArrowLeft' })
    const right = pressOf({ code: 'ArrowRight' })
    expect(matchShortcut(right, CALM)?.id).toBe('items')
    expect(matchShortcut(right, { ...CALM, isOnControl: true })?.id).toBe('cycle')
    expect(matchShortcut(left, { ...CALM, isOnControl: true })).toEqual({ id: 'cycle', index: 0 })
    const down = pressOf({ code: 'ArrowDown' })
    expect(matchShortcut(down, { ...CALM, isOnList: true })?.id).toBe('block')
    expect(matchShortcut(down, { ...CALM, isOnList: true, isCarrying: true })).toEqual({
      id: 'carry',
      index: 2,
    })
  })

  it('treats ⌘ and Ctrl as one modifier, and both at once as none', () => {
    const save = pressOf({ code: 'KeyS', mod: true })
    expect(matchShortcut(save, CALM)?.id).toBe('save')
    expect(matchShortcut({ ...save, ctrlKey: false, metaKey: true }, CALM)?.id).toBe('save')
    expect(matchShortcut({ ...save, metaKey: true }, CALM)).toBeUndefined()
    // ⌘⇧S is the static toggle, not save.
    expect(matchShortcut({ ...save, shiftKey: true }, CALM)?.id).toBe('static')
  })

  it('writes the keys in the symbols of the platform', () => {
    const redoChord = { code: 'KeyZ', mod: true, shift: true }
    expect(keyCaps(redoChord, true)).toEqual(['⌘', '⇧', 'Z'])
    expect(keyCaps(redoChord, false)).toEqual(['Ctrl', 'Shift', 'Z'])
    expect(keyCaps({ code: 'Backspace', alt: true }, true)).toEqual(['⌥', '⌫'])
    expect(keyCaps({ code: 'Backspace', alt: true }, false)).toEqual(['Alt', 'Backspace'])
    expect(keyCaps({ code: 'ArrowUp' }, false)).toEqual(['↑'])
    expect(keyCaps({ code: 'Digit1' }, false)).toEqual(['1'])
    expect(keyCaps({ key: '?' }, false)).toEqual(['?'])
  })
})

describe('the gap a picked up block goes to', () => {
  it('skips the two gaps beside the block, which are where it already is', () => {
    // Five blocks, the third (2) picked up: gaps 0..5, with 2 and 3 being its own.
    expect(nextGap(2, -1, 2, 5)).toBe(1)
    expect(nextGap(2, 1, 2, 5)).toBe(4)
    expect(nextGap(4, -1, 2, 5)).toBe(2)
    expect(nextGap(5, 1, 2, 5)).toBe(5)
    expect(nextGap(0, -1, 2, 5)).toBe(0)
  })
})

describe('redo', () => {
  const page = (key: string) => [{ key, component: 'section.rich-text', fields: {} }]

  it('brings back what an undo took away, and a new change ends it', () => {
    const one = page('a')
    const two = page('b')
    const history = remember(EMPTY_HISTORY, one)
    const back = undo(history, two)!
    expect(back.blocks).toBe(one)
    const forward = redo(back.history, one)!
    expect(forward.blocks).toBe(two)
    expect(forward.history.past).toEqual([one])
    expect(redo(forward.history, two)).toBeUndefined()
    // After an undo, a change is a new branch: there is nothing to redo.
    expect(remember(back.history, page('c')).future).toEqual([])
  })
})
