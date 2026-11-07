import { useEffect, useRef, useState } from 'react'

import { matchShortcut, nextGap, type ShortcutId, type Where } from '../shortcuts'
import { itemsOf } from '../utils/builder/fields'
import type { BuilderBlock } from '../utils/builder/model'
import { DEVICES, isTypingTarget, type DeviceId, type PreviewMode } from '../utils/previewPane'
import type { BuilderEdits, Selection } from './useBuilderEdits'

/** What the keyboard acts on: the page's state and the actions its controls already run. */
export interface ShortcutContext {
  blocks: BuilderBlock[]
  selection: Selection | undefined
  select: (next: Selection | undefined) => void
  /** The fields that hold items, by name, for the block `→` goes into. */
  itemFieldsOf: (block: BuilderBlock) => string[]
  edits: BuilderEdits
  isReadOnly: boolean
  canDuplicate: boolean
  save: () => void
  undo: () => boolean
  redo: () => boolean
  setDevice: (device: DeviceId) => void
  setMode: (update: (mode: PreviewMode) => PreviewMode) => void
  /** `undefined` for a page that has no settings. */
  openSettings: (() => void) | undefined
  openSheet: () => void
  /** `undefined` for a page that cannot be sent to review now. */
  requestReview: (() => void) | undefined
  openPage: () => void
  backToEntry: () => void
  focusSearch: () => void
}

/** The block being carried to a gap with the keyboard, and the position it started at. */
export interface Carry {
  key: string
  from: number
}

function whereOf(target: EventTarget | null, isCarrying: boolean): Where {
  const element = target instanceof Element ? target : null
  return {
    isField: isTypingTarget(target),
    isInPreview: element?.closest('[data-shortcut-region="preview"]') != null,
    isOnList: element?.closest('[data-block-key]') != null,
    isOnControl: element?.closest('[data-option-control]') != null,
    isInteractive:
      element?.closest('button, a[href], summary, input, [role="button"], [role="tab"]') != null,
    isCarrying,
  }
}

/** Moves focus to a region of the page: `panel`, or the frame of `preview`. */
function focusRegion(region: 'panel' | 'preview'): void {
  const root = document.querySelector<HTMLElement>(`[data-shortcut-region="${region}"]`)
  const target = region === 'preview' ? (root?.querySelector('iframe') ?? root) : root
  target?.focus()
}

/**
 * The keyboard of the builder (issue #50): one listener that reads the table of `shortcuts.ts` and
 * runs the action a key press names, with the rules of that file.
 *
 * @returns The block being carried with Space, for the list to say so.
 *
 * @remarks
 * Nothing runs inside a dialog (the page settings, the sheet, the review dialogs keep their own
 * keys). A handler that finds nothing to do leaves the key to the browser.
 */
export function useBuilderShortcuts(ctx: ShortcutContext): { carrying: Carry | undefined } {
  const [carrying, setCarrying] = useState<Carry>()
  const latest = useRef(ctx)
  latest.current = ctx
  const carryRef = useRef(carrying)
  carryRef.current = carrying
  // The key that ended a carry also ends in a click of the row it was pressed on: it is not wanted.
  const swallowSpace = useRef(false)

  useEffect(() => {
    function run(id: ShortcutId, index: number, event: KeyboardEvent): boolean {
      const c = latest.current
      const { edits } = c
      const { blocks, selection } = c
      const selected = blocks.find((block) => block.key === selection?.key)
      const position = selected ? blocks.indexOf(selected) : -1
      const pick = (block: BuilderBlock | undefined, isFromList: boolean): boolean => {
        if (!block) return false
        c.select({ key: block.key, item: undefined })
        if (isFromList) {
          document.querySelector<HTMLElement>(`[data-block-key="${block.key}"]`)?.focus()
        }
        return true
      }
      const isFromList = whereOf(event.target, false).isOnList
      switch (id) {
        case 'block': {
          if (blocks.length === 0) return false
          // From the row that has focus, else from the selection.
          const focusedKey = (event.target as Element)
            .closest('[data-block-key]')
            ?.getAttribute('data-block-key')
          const from = focusedKey ? blocks.findIndex(({ key }) => key === focusedKey) : position
          const next = index === 0 ? from + 1 : from < 0 ? blocks.length - 1 : from - 1
          return pick(blocks[Math.min(blocks.length - 1, Math.max(0, next))], isFromList)
        }
        case 'items': {
          if (!selected || selection?.item) return false
          const field = c
            .itemFieldsOf(selected)
            .find((name) => itemsOf(selected.fields, name).length > 0)
          if (!field) return false
          c.select({ key: selected.key, item: { field, index: 0 } })
          return true
        }
        case 'parent':
          if (carryRef.current) {
            edits.endDrag()
            setCarrying(undefined)
          } else if (selection?.item) c.select({ key: selection.key, item: undefined })
          else if (selection) c.select(undefined)
          else return false
          return true
        case 'jump':
          return pick(blocks[index], isFromList)
        case 'focus':
          focusRegion(index === 0 ? 'panel' : 'preview')
          return true
        case 'palette':
        case 'search':
          c.focusSearch()
          return true
        case 'move':
          if (c.isReadOnly || !selected) return false
          edits.move(index === 0 ? -1 : 1)
          return true
        case 'carry': {
          const key = (event.target as Element)
            .closest('[data-block-key]')
            ?.getAttribute('data-block-key')
          const carry = carryRef.current
          if (index > 0) {
            if (!carry) return false
            edits.setListGap(
              nextGap(edits.listGap ?? carry.from, index === 1 ? -1 : 1, carry.from, blocks.length)
            )
            return true
          }
          if (carry) {
            const gap = edits.listGap ?? carry.from
            // The gaps beside the block itself are where it already is.
            if (gap === carry.from || gap === carry.from + 1) edits.endDrag()
            else edits.dropAtPosition(gap)
            setCarrying(undefined)
            swallowSpace.current = true
            return true
          }
          const at = blocks.findIndex((block) => block.key === key)
          if (c.isReadOnly || !key || at < 0) return false
          c.select({ key, item: undefined })
          edits.setDrag({ kind: 'move', key })
          edits.setListGap(at)
          setCarrying({ key, from: at })
          swallowSpace.current = true
          return true
        }
        case 'edit':
          if (c.isReadOnly || !selected) return false
          if (index === 0) {
            if (!c.canDuplicate) return false
            edits.copy()
          } else edits.remove()
          return true
        case 'undo':
          return index === 0 ? c.undo() : c.redo()
        case 'cycle':
          return cycleOption(event.target as Element, index === 0 ? -1 : 1, c.isReadOnly)
        case 'reset':
          return !c.isReadOnly && edits.resetOptions()
        case 'device':
          c.setDevice(DEVICES[index]!.id)
          return true
        case 'static':
          c.setMode((mode) => (mode === 'live' ? 'static' : 'live'))
          return true
        case 'open':
          c.openPage()
          return true
        case 'save':
          if (c.isReadOnly) return false
          c.save()
          return true
        case 'review':
          if (!c.requestReview) return false
          c.requestReview()
          return true
        case 'settings':
          if (!c.openSettings) return false
          c.openSettings()
          return true
        case 'back':
          c.backToEntry()
          return true
        case 'sheet':
          c.openSheet()
          return true
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return
      if (event.repeat && !event.code.startsWith('Arrow')) return
      const target = event.target instanceof Element ? event.target : null
      // A dialog keeps its keys, Esc and Tab among them.
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return
      const where = whereOf(event.target, carryRef.current !== undefined)
      // A block picked up belongs to the list: a key from anywhere else puts it down.
      if (carryRef.current && !where.isOnList) {
        latest.current.edits.endDrag()
        setCarrying(undefined)
        carryRef.current = undefined
        where.isCarrying = false
      }
      const found = matchShortcut(event, where)
      if (found && run(found.id, found.index, event)) event.preventDefault()
    }
    function onKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space' && swallowSpace.current) {
        swallowSpace.current = false
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return { carrying }
}

/** Presses the choice `step` away from the one that has focus in its row, going round. */
function cycleOption(from: Element, step: -1 | 1, isReadOnly: boolean): boolean {
  const row = from.closest('[data-option-control]')
  if (isReadOnly || !row) return false
  const choices = [...row.querySelectorAll<HTMLButtonElement>('button')]
  const at = choices.indexOf(from.closest('button')!)
  // The last choice goes on to the first, and the first back to the last.
  const next = choices[(at + step + choices.length) % choices.length]
  if (at < 0 || !next || next === choices[at]) return false
  next.click()
  next.focus()
  return true
}
