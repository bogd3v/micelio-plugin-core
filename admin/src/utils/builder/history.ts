import type { BuilderBlock } from './model'

/** How many steps of undo a session keeps. */
export const HISTORY_LIMIT = 50

/** The undo history of one session: the pages the editor had before each change. */
export interface History {
  past: BuilderBlock[][]
  /** The pages an undo went back from, newest last, for a redo; a new change empties it. */
  future: BuilderBlock[][]
}

/** An empty history. */
export const EMPTY_HISTORY: History = { past: [], future: [] }

/**
 * The history with `before` pushed on it, unless it is the page the last step already holds.
 *
 * @remarks
 * The snapshots keep each block's `key`, so after an undo the selection, the list and the
 * overlays still point at the same block instances.
 */
export function remember(history: History, before: BuilderBlock[]): History {
  const last = history.past[history.past.length - 1]
  if (last === before) return history
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [] }
}

/**
 * The page to go back to and the history without it; `undefined` when there is nothing to undo.
 * Give `current`, the page now, and a {@link redo} brings it back.
 */
export function undo(
  history: History,
  current?: BuilderBlock[]
): { blocks: BuilderBlock[]; history: History } | undefined {
  const blocks = history.past[history.past.length - 1]
  if (!blocks) return undefined
  return {
    blocks,
    history: {
      past: history.past.slice(0, -1),
      future: current ? [...history.future, current] : history.future,
    },
  }
}

/** The page an undo went back from, and the history with `current` back in the past; `undefined` when there is none. */
export function redo(
  history: History,
  current: BuilderBlock[]
): { blocks: BuilderBlock[]; history: History } | undefined {
  const blocks = history.future[history.future.length - 1]
  if (!blocks) return undefined
  return {
    blocks,
    history: {
      past: [...history.past, current].slice(-HISTORY_LIMIT),
      future: history.future.slice(0, -1),
    },
  }
}
