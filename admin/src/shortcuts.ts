/**
 * The keyboard of the builder (issue #50): one table of actions, their keys and where each fires.
 * The sheet that `?` opens renders from it and so does the code that reacts to a key, so the sheet
 * cannot say what the page does not do.
 *
 * @remarks
 * Rules, enforced by {@link matchShortcut}:
 * - Inside a field (a text input, a text area, a select) only the actions whose scope is `anywhere`
 *   fire: save, undo and redo, and `Esc`.
 * - A key with no modifier never fires inside the preview, except `Esc`: its controls keep Tab,
 *   Enter and Space for themselves.
 * - Every pointer action has a key or is a control Tab reaches in the order palette, list,
 *   preview, panel.
 */

/** The groups of the sheet, in the order it shows them. */
export const GROUPS = ['selecting', 'composing', 'options', 'preview', 'page'] as const

/** A group of the sheet. */
export type GroupId = (typeof GROUPS)[number]

/**
 * Where an action fires:
 * - `anywhere`: even inside a field;
 * - `outside-fields`: when focus is not in a field;
 * - `idle`: outside fields and when focus is not on a control that uses the key itself (a button
 *   keeps Enter), a row of the block list excepted;
 * - `list`: with focus on a row of the block list;
 * - `control`: with focus on a row of the choices of an option.
 */
export type Scope = 'anywhere' | 'outside-fields' | 'idle' | 'list' | 'control'

/** One key press. `mod` is ⌘ on macOS and Ctrl elsewhere. A chord names a `code` or, for a printed character, a `key`. */
export interface Chord {
  code?: string
  key?: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

/** An action of the builder's keyboard. */
export interface Shortcut {
  id: string
  group: GroupId
  scope: Scope
  /** The presses that run it; the handler gets the position of the one that was pressed. */
  keys: readonly Chord[]
  /** The sheet shows the first key, an ellipsis and the last (`1 … 9`), not each. */
  isRange?: boolean
}

const mod = (code: string): Chord => ({ code, mod: true })
const digits: Chord[] = Array.from({ length: 9 }, (_, index) => ({ code: `Digit${index + 1}` }))

/**
 * Every action, in the order of the Shortcuts artboard. The label of each is the message
 * `shortcuts.<id>`.
 */
export const SHORTCUTS = [
  {
    id: 'block',
    group: 'selecting',
    scope: 'outside-fields',
    keys: [{ code: 'ArrowDown' }, { code: 'ArrowUp' }],
  },
  { id: 'items', group: 'selecting', scope: 'outside-fields', keys: [{ code: 'ArrowRight' }] },
  { id: 'parent', group: 'selecting', scope: 'anywhere', keys: [{ code: 'Escape' }] },
  { id: 'jump', group: 'selecting', scope: 'outside-fields', keys: digits, isRange: true },
  {
    id: 'focus',
    group: 'selecting',
    scope: 'outside-fields',
    keys: [mod('Digit1'), mod('Digit2')],
  },
  { id: 'palette', group: 'composing', scope: 'idle', keys: [{ code: 'Enter' }] },
  { id: 'search', group: 'composing', scope: 'outside-fields', keys: [{ key: '/' }] },
  {
    id: 'move',
    group: 'composing',
    scope: 'outside-fields',
    keys: [
      { code: 'ArrowUp', alt: true },
      { code: 'ArrowDown', alt: true },
    ],
  },
  {
    id: 'carry',
    group: 'composing',
    scope: 'list',
    keys: [{ code: 'Space' }, { code: 'ArrowUp' }, { code: 'ArrowDown' }],
  },
  {
    id: 'edit',
    group: 'composing',
    scope: 'outside-fields',
    keys: [mod('KeyD'), mod('Backspace')],
  },
  {
    id: 'undo',
    group: 'composing',
    scope: 'anywhere',
    keys: [mod('KeyZ'), { code: 'KeyZ', mod: true, shift: true }],
  },
  {
    id: 'cycle',
    group: 'options',
    scope: 'control',
    keys: [{ code: 'ArrowLeft' }, { code: 'ArrowRight' }],
  },
  {
    id: 'reset',
    group: 'options',
    scope: 'outside-fields',
    keys: [{ code: 'Backspace', alt: true }],
  },
  {
    id: 'device',
    group: 'preview',
    scope: 'outside-fields',
    keys: [1, 2, 3].map((n) => ({ code: `Digit${n}`, mod: true, shift: true })),
  },
  {
    id: 'static',
    group: 'preview',
    scope: 'outside-fields',
    keys: [{ code: 'KeyS', mod: true, shift: true }],
  },
  {
    id: 'open',
    group: 'preview',
    scope: 'outside-fields',
    keys: [{ code: 'KeyO', mod: true, shift: true }],
  },
  { id: 'save', group: 'page', scope: 'anywhere', keys: [mod('KeyS')] },
  { id: 'review', group: 'page', scope: 'outside-fields', keys: [mod('Enter')] },
  { id: 'settings', group: 'page', scope: 'outside-fields', keys: [mod('Comma')] },
  {
    id: 'back',
    group: 'page',
    scope: 'outside-fields',
    keys: [{ code: 'ArrowLeft', mod: true, shift: true }],
  },
  { id: 'sheet', group: 'page', scope: 'outside-fields', keys: [{ key: '?' }] },
] as const satisfies readonly Shortcut[]

/** The id of an action of the table. */
export type ShortcutId = (typeof SHORTCUTS)[number]['id']

/** The keys of a keyboard event the matcher reads. */
export interface KeyPress {
  code: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Where focus is when a key is pressed. */
export interface Where {
  /** A text input, a text area, a select or editable text. */
  isField: boolean
  /** Inside the preview region: its frame and the controls over it. */
  isInPreview: boolean
  /** On a row of the block list. */
  isOnList: boolean
  /** On a choice of an option. */
  isOnControl: boolean
  /** On a control that acts on Enter itself: a button, a link, a checkbox. */
  isInteractive: boolean
  /** A block was picked up with Space and waits for its gap. */
  isCarrying: boolean
}

function matches(chord: Chord, press: KeyPress): boolean {
  if (chord.code !== undefined ? press.code !== chord.code : press.key !== chord.key) return false
  // ⌘ or Ctrl, one of the two: both at once is another chord.
  if ((press.ctrlKey !== press.metaKey) !== (chord.mod === true)) return false
  if (press.ctrlKey && press.metaKey) return false
  if (press.altKey !== (chord.alt === true)) return false
  // A printed character names its own shift: `?` is Shift+/ on some layouts and not on others.
  return chord.key !== undefined || press.shiftKey === (chord.shift === true)
}

/**
 * The action a key press runs and the position of the key among those of the action, or
 * `undefined` when none does at `where`.
 */
export function matchShortcut(
  press: KeyPress,
  where: Where
): { id: ShortcutId; index: number } | undefined {
  const isPlain = !press.ctrlKey && !press.metaKey && !press.altKey
  for (const shortcut of SHORTCUTS as readonly (Shortcut & { id: ShortcutId })[]) {
    const index = shortcut.keys.findIndex((chord) => matches(chord, press))
    if (index < 0) continue
    if (where.isField && shortcut.scope !== 'anywhere') continue
    if (where.isInPreview && isPlain && press.code !== 'Escape') continue
    if (shortcut.scope === 'list' && !where.isOnList) continue
    // Space picks up and drops; the arrows choose the gap only while a block is picked up.
    if (shortcut.id === 'carry' && index > 0 && !where.isCarrying) continue
    if (shortcut.scope === 'control' && !where.isOnControl) continue
    if (shortcut.scope === 'idle' && where.isInteractive && !where.isOnList) continue
    // On a choice the arrows cycle it; with a block picked up they are the carry's.
    if (isPlain && press.code.startsWith('Arrow')) {
      if (where.isOnControl && shortcut.scope !== 'control') continue
      if (where.isCarrying && shortcut.id !== 'carry') continue
    }
    return { id: shortcut.id, index }
  }
  return undefined
}

/** The symbol or word on the key cap for one key of a chord. */
const CAPS: Record<string, [mac: string, other: string]> = {
  ArrowUp: ['↑', '↑'],
  ArrowDown: ['↓', '↓'],
  ArrowLeft: ['←', '←'],
  ArrowRight: ['→', '→'],
  Escape: ['Esc', 'Esc'],
  Enter: ['↵', 'Enter'],
  Backspace: ['⌫', 'Backspace'],
  Space: ['Space', 'Space'],
  Comma: [',', ','],
}

/** The names of the keys of a chord, modifiers first, with the symbols of the platform. */
export function keyCaps(chord: Chord, isMac: boolean): string[] {
  const side = isMac ? 0 : 1
  const main =
    chord.key ?? CAPS[chord.code ?? '']?.[side] ?? (chord.code ?? '').replace(/^(Key|Digit)/, '')
  return [
    ...(chord.mod ? [isMac ? '⌘' : 'Ctrl'] : []),
    ...(chord.shift ? [isMac ? '⇧' : 'Shift'] : []),
    ...(chord.alt ? [isMac ? '⌥' : 'Alt'] : []),
    main,
  ]
}

/**
 * The gap `step` away from `gap` for the block at `from`, among `length` blocks: the gaps before and
 * after the block itself are the place it already holds, so a step skips one of them.
 */
export function nextGap(gap: number, step: -1 | 1, from: number, length: number): number {
  let next = gap + step
  if (next === from + 1) next += step
  return Math.min(length, Math.max(0, next))
}
