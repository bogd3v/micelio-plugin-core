import type { BlockAddress, RunFailure } from '../../../../contract/preview'

/**
 * How long the admin waits for the answer to a run, in milliseconds: the frame's 60 seconds to load
 * a runtime, its 5 seconds to run the code, and a margin (ADR-0019, amendment of 2026-11-06).
 */
export const RUN_ANSWER_MS = 70_000

/**
 * Why a run filled nothing: a reason of the frame, or one of the admin's own. `noAnswer` is the
 * limit of {@link RUN_ANSWER_MS} on an answer, and `notStarted` the same limit on the wait for the
 * save, or a save that will not happen without the editor.
 */
export type RunProblem = RunFailure | 'noAnswer' | 'notStarted'

/** Where the run of one block stands, as the panel shows it. */
export type RunPhase =
  | { kind: 'saving' }
  | { kind: 'running' }
  | { kind: 'filled'; truncated: boolean }
  | {
      kind: 'failed'
      reason: RunProblem
      /** The error message a reader would see, for `codeError`. */
      output?: string
    }

/** A run the admin asked the frame for and has not heard back from. */
export interface OpenRun {
  requestId: string
  /** The block's key in the page, which the output fills. */
  key: string
  address: BlockAddress
}

/** Whether two addresses name the same block of the same version. */
export function isSameAddress(a: BlockAddress, b: BlockAddress): boolean {
  return a.zone === b.zone && a.index === b.index && a.block === b.block && a.version === b.version
}

/**
 * The open run an answer of the frame is for.
 *
 * @returns `undefined` for an answer whose `requestId` the admin does not hold open (a late or a
 * repeated answer) or whose address is not the one the run named: the answer is dropped.
 */
export function runOfAnswer(
  open: readonly OpenRun[],
  answer: { requestId: string; address: BlockAddress }
): OpenRun | undefined {
  const run = open.find(({ requestId }) => requestId === answer.requestId)
  return run && isSameAddress(run.address, answer.address) ? run : undefined
}

/** What a run that waits for the save does now. */
export type RunStep =
  { kind: 'wait' } | { kind: 'send'; address: BlockAddress } | { kind: 'fail'; reason: RunProblem }

/**
 * What a run that waits does: it is asked for once the page holds no unsaved edit and the frame
 * shows the version the CMS holds, so the frame runs what the editor sees in the panel.
 *
 * @param page - `status` is the page's `SaveStatus` (`useBuilderDocument`).
 * @param address - The block's address in the frame in view; `undefined` when the version it
 * shows does not hold the block.
 * @returns `fail` with `notStarted` when the autosave will not save the edits without the editor
 * (another session saved, a required field is empty, or the server refused them), and with
 * `notRunnable` when the saved page does not hold the block.
 */
export function nextRunStep(
  page: { isDirty: boolean; status: string; version: string | undefined },
  frame: { version: string | undefined; isBusy: boolean },
  address: BlockAddress | undefined
): RunStep {
  const isStuck = ['conflict', 'incomplete', 'failed'].includes(page.status)
  if (page.isDirty && isStuck) return { kind: 'fail', reason: 'notStarted' }
  const isShown =
    !page.isDirty &&
    page.status !== 'saving' &&
    page.version !== undefined &&
    frame.version === page.version &&
    !frame.isBusy
  if (!isShown) return { kind: 'wait' }
  return address ? { kind: 'send', address } : { kind: 'fail', reason: 'notRunnable' }
}
