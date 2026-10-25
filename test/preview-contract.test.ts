import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePreviewMessage, previewJsonSchema } from '../contract/preview'

const ready = {
  v: 1,
  type: 'ready',
  payload: { v: [1], documentId: 'doc-1', locale: 'en', version: '2026-10-25T12:00:00.000Z' },
}
const loadDraft = { v: 1, type: 'load-draft', payload: { documentId: 'doc-1', locale: null } }

describe('the preview messages', () => {
  it('accepts ready and load-draft', () => {
    expect(parsePreviewMessage(ready)).toEqual(ready)
    expect(parsePreviewMessage(loadDraft)).toEqual(loadDraft)
  })

  it('rejects an unknown envelope version', () => {
    expect(parsePreviewMessage({ ...ready, v: 2 })).toBeUndefined()
    expect(parsePreviewMessage({ ...loadDraft, v: 0 })).toBeUndefined()
    expect(parsePreviewMessage({ type: 'ready', payload: ready.payload })).toBeUndefined()
  })

  it('ignores an unknown type, so a newer peer can add messages', () => {
    expect(parsePreviewMessage({ v: 1, type: 'block-hover', payload: null })).toBeUndefined()
  })

  it('rejects a payload that fails its schema', () => {
    expect(parsePreviewMessage({ ...ready, payload: { ...ready.payload, v: [] } })).toBeUndefined()
    expect(
      parsePreviewMessage({ ...ready, payload: { ...ready.payload, version: '' } })
    ).toBeUndefined()
    expect(parsePreviewMessage({ ...loadDraft, payload: { documentId: 'doc-1' } })).toBeUndefined()
    expect(parsePreviewMessage('ready')).toBeUndefined()
    expect(parsePreviewMessage(null)).toBeUndefined()
  })

  it('tolerates a field a newer peer adds, and drops it', () => {
    const parsed = parsePreviewMessage({
      ...loadDraft,
      payload: { ...loadDraft.payload, extra: 1 },
    })
    expect(parsed).toEqual(loadDraft)
  })

  it('has the generated JSON Schema checked in (npm run lint:preview fails on drift)', () => {
    const file = JSON.parse(
      readFileSync(new URL('../contract/preview.schema.json', import.meta.url), 'utf8')
    ) as unknown
    expect(file).toEqual(JSON.parse(JSON.stringify(previewJsonSchema())))
  })
})
