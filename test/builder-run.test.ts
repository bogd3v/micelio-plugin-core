import { describe, expect, it } from 'vitest'
import {
  RUN_ANSWER_MS,
  nextRunStep,
  runOfAnswer,
  type OpenRun,
} from '../admin/src/utils/builder/run'
import { runMessage } from '../admin/src/utils/builder/messages'
import { parsePreviewMessage } from '../contract/preview'

const address = {
  zone: 'sections' as const,
  index: 2,
  block: 'playground',
  version: '2026-11-11T10:00:00.000Z',
}
const open: OpenRun[] = [{ requestId: 'run-a', key: 'block-1', address }]

describe('the run of a Playground block in the admin', () => {
  it('waits 70 seconds for an answer: the 60 of the runtime, the 5 of the code and a margin', () => {
    expect(RUN_ANSWER_MS).toBe(70_000)
  })

  it('sends the address and the id, and nothing the contract refuses', () => {
    const message = runMessage('run-a', address)
    expect(message).toEqual({ v: 1, type: 'micelio:run', payload: { requestId: 'run-a', address } })
    expect(parsePreviewMessage(message)).toEqual(message)
  })

  it('matches an answer to the open run with its id and address, and drops any other', () => {
    expect(runOfAnswer(open, { requestId: 'run-a', address })).toBe(open[0])
    // A late or repeated answer: its id is not open.
    expect(runOfAnswer(open, { requestId: 'run-b', address })).toBeUndefined()
    expect(runOfAnswer([], { requestId: 'run-a', address })).toBeUndefined()
    // The right id for another block, or another version of the draft.
    expect(runOfAnswer(open, { requestId: 'run-a', address: { ...address, index: 1 } })).toBe(
      undefined
    )
    expect(
      runOfAnswer(open, { requestId: 'run-a', address: { ...address, block: 'scene' } })
    ).toBeUndefined()
    expect(
      runOfAnswer(open, { requestId: 'run-a', address: { ...address, version: 'other' } })
    ).toBeUndefined()
  })

  it('asks the frame only once the page is saved and the frame shows what was saved', () => {
    const page = { isDirty: false, status: 'saved', version: address.version }
    const frame = { version: address.version, isBusy: false }
    const wait = { kind: 'wait' }
    expect(nextRunStep(page, frame, address)).toEqual({ kind: 'send', address })
    // An unsaved edit, or a save in flight: the run waits.
    expect(nextRunStep({ ...page, isDirty: true, status: 'idle' }, frame, address)).toEqual(wait)
    expect(nextRunStep({ ...page, status: 'saving' }, frame, address)).toEqual(wait)
    expect(
      nextRunStep({ ...page, version: undefined }, { ...frame, version: undefined }, undefined)
    ).toEqual(wait)
    // The frame still shows the version before the save, or is loading the new one.
    expect(nextRunStep(page, { ...frame, version: '2026-11-11T09:00:00.000Z' }, address)).toEqual(
      wait
    )
    expect(nextRunStep(page, { ...frame, isBusy: true }, address)).toEqual(wait)
    // The saved page does not hold the block.
    expect(nextRunStep(page, frame, undefined)).toEqual({ kind: 'fail', reason: 'notRunnable' })
  })

  it('gives up the wait for a save that will not happen without the editor', () => {
    const frame = { version: undefined, isBusy: false }
    const dirty = { isDirty: true, version: address.version }
    for (const status of ['conflict', 'incomplete', 'failed']) {
      expect(nextRunStep({ ...dirty, status }, frame, address)).toEqual({
        kind: 'fail',
        reason: 'notStarted',
      })
    }
    // A page with nothing left to save is not held by an old status.
    expect(nextRunStep({ ...dirty, isDirty: false, status: 'failed' }, frame, address)).toEqual({
      kind: 'wait',
    })
  })
})
