import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { BlockAddress, PreviewMessage } from '../../../contract/preview'
import type { FrameState, PreviewFrameHandle } from '../components/PreviewFrame'
import { runMessage } from '../utils/builder/messages'
import {
  RUN_ANSWER_MS,
  nextRunStep,
  runOfAnswer,
  type OpenRun,
  type RunPhase,
} from '../utils/builder/run'
import type { BuilderState } from './useBuilderDocument'

interface RunContext {
  frame: RefObject<PreviewFrameHandle>
  frameState: FrameState
  state: Pick<BuilderState, 'isDirty' | 'status' | 'version'>
  /** The address of a block in the frame in view; `undefined` when the frame has not rendered it. */
  addressOf: (key: string) => BlockAddress | undefined
  /** Puts a run's output in the block's expected output, as an edit the editor can undo. */
  fill: (key: string, output: string) => void
}

/** What the page gets from {@link usePlaygroundRun}. */
export interface PlaygroundRun {
  /** Where the last run of a block stands; `undefined` before its first. */
  phaseOf: (key: string) => RunPhase | undefined
  /** The frame in view speaks the protocol, so it can be asked to run a block. */
  canRun: boolean
  /** Runs a Playground block in the frame and fills its expected output with the answer. */
  run: (key: string) => void
  /** Takes the frame's `ready` and `micelio:runResult`. */
  onFrameMessage: (message: PreviewMessage) => void
}

/**
 * Runs a Playground block in the preview frame and fills its expected output with what the code
 * printed (ADR-0019, amendment of 2026-11-06).
 *
 * @remarks
 * The admin never runs the code and never sends it: it sends the block's address, and the frame
 * runs the block as the saved draft holds it. A run that unsaved edits would change waits for the
 * save first, until the frame shows the version the CMS holds. A run still open when the frame says
 * `ready` again fails as `runtimeUnavailable`, one with no answer within {@link RUN_ANSWER_MS} fails
 * as `noAnswer`, and an answer whose `requestId` is not open is dropped. The output becomes an edit
 * of the page: the autosave saves it and Undo takes it back.
 */
export function usePlaygroundRun(ctx: RunContext): PlaygroundRun {
  const { frame, frameState, state, addressOf } = ctx
  const [phases, setPhases] = useState<Record<string, RunPhase>>({})
  const open = useRef<OpenRun[]>([])
  // The keys of the blocks whose run waits for the autosave.
  const waiting = useRef<string[]>([])
  const timers = useRef(new Map<string, number>())
  const nextId = useRef(0)
  const fill = useRef(ctx.fill)
  fill.current = ctx.fill

  const setPhase = useCallback((key: string, phase: RunPhase) => {
    setPhases((current) => ({ ...current, [key]: phase }))
  }, [])

  const clearTimer = (id: string) => {
    window.clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer)
    },
    []
  )

  const run = (key: string) => {
    waiting.current.push(key)
    setPhase(key, { kind: 'saving' })
    // The wait for the save has the limit of an answer: a save the frame never shows ends it.
    timers.current.set(
      `save:${key}`,
      window.setTimeout(() => {
        timers.current.delete(`save:${key}`)
        waiting.current = waiting.current.filter((other) => other !== key)
        setPhase(key, { kind: 'failed', reason: 'notStarted' })
      }, RUN_ANSWER_MS)
    )
  }

  // Ask the frame once the page is saved and the frame shows what was saved.
  useEffect(() => {
    for (const key of [...waiting.current]) {
      const step = nextRunStep(state, frameState, addressOf(key))
      if (step.kind === 'wait') continue
      waiting.current = waiting.current.filter((other) => other !== key)
      clearTimer(`save:${key}`)
      if (step.kind === 'fail') {
        setPhase(key, { kind: 'failed', reason: step.reason })
        continue
      }
      const { address } = step
      nextId.current += 1
      const requestId = `run-${Date.now().toString(36)}-${nextId.current}`
      // A frame that cannot take the message gives no answer either: the limit below ends the run.
      frame.current?.post(runMessage(requestId, address))
      open.current.push({ requestId, key, address })
      setPhase(key, { kind: 'running' })
      timers.current.set(
        requestId,
        window.setTimeout(() => {
          timers.current.delete(requestId)
          open.current = open.current.filter((other) => other.requestId !== requestId)
          setPhase(key, { kind: 'failed', reason: 'noAnswer' })
        }, RUN_ANSWER_MS)
      )
    }
    // `phases` changes when a run starts: the effect looks at the new one at once.
  }, [state.isDirty, state.status, state.version, frameState, phases, addressOf])

  const onFrameMessage = useCallback(
    (message: PreviewMessage) => {
      if (message.type === 'ready') {
        // The frame loaded again: the runs it had are gone, and none is sent again by itself.
        for (const gone of open.current.splice(0)) {
          clearTimer(gone.requestId)
          setPhase(gone.key, { kind: 'failed', reason: 'runtimeUnavailable' })
        }
      } else if (message.type === 'micelio:runResult') {
        const answer = message.payload
        const found = runOfAnswer(open.current, answer)
        if (!found) return
        open.current = open.current.filter((other) => other !== found)
        clearTimer(found.requestId)
        if (answer.ok) {
          fill.current(found.key, answer.output)
          setPhase(found.key, { kind: 'filled', truncated: answer.truncated })
        } else {
          setPhase(found.key, { kind: 'failed', reason: answer.reason, output: answer.output })
        }
      }
    },
    [setPhase]
  )

  return {
    phaseOf: (key) => phases[key],
    canRun: frameState.protocol === 'ok',
    run,
    onFrameMessage,
  }
}
