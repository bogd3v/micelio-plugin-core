import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePreviewMessage, previewJsonSchema } from '../contract/preview'

const ready = {
  v: 1,
  type: 'ready',
  payload: { v: [1], documentId: 'doc-1', locale: 'en', version: '2026-10-25T12:00:00.000Z' },
}
const loadDraft = { v: 1, type: 'load-draft', payload: { documentId: 'doc-1', locale: null } }

const address = { zone: 'sections', index: 2, block: 'hero', version: '2026-11-03T10:00:00.000Z' }
const box = { x: 0, y: 10.5, width: 760, height: 240 }
const phase2 = [
  { v: 1, type: 'micelio:select', payload: { address, item: 1, reveal: true } },
  { v: 1, type: 'micelio:select', payload: { address: null } },
  { v: 1, type: 'micelio:hover', payload: { address, item: null } },
  {
    v: 1,
    type: 'micelio:insertGap',
    payload: { version: address.version, zone: 'sections', after: null, height: 120 },
  },
  {
    v: 1,
    type: 'micelio:patch',
    payload: {
      address,
      content: { title: 'New', text: null },
      items: [{ index: 0, content: { title: 'One' } }],
    },
  },
  {
    v: 1,
    type: 'micelio:blocks',
    payload: {
      version: address.version,
      scroll: { x: 0, y: 40 },
      viewport: { width: 1280, height: 980 },
      blocks: [{ address, box, items: [{ index: 0, box }] }],
    },
  },
  { v: 1, type: 'micelio:selected', payload: { address, item: null, box } },
  { v: 1, type: 'micelio:hovered', payload: { address: null, item: null, box: null } },
  { v: 1, type: 'micelio:renderMode', payload: { address, mode: 'static' } },
]

describe('the phase 2 preview messages (ADR-0019, amendment of 2026-11-02)', () => {
  it('accepts each message of the amendment, in both directions', () => {
    for (const message of phase2) expect(parsePreviewMessage(message)).toEqual(message)
  })

  it('rejects a payload that fails its schema', () => {
    const [select, , , gap, patch, blocks] = phase2 as {
      type: string
      payload: Record<string, unknown>
    }[]
    const bad = [
      { ...select!, payload: { address: { ...address, zone: 'footer' } } },
      { ...select!, payload: { address: { ...address, index: -1 } } },
      { ...gap!, payload: { ...gap!.payload, height: 2001 } },
      { ...gap!, payload: { ...gap!.payload, height: -1 } },
      { ...patch!, payload: { ...patch!.payload, content: { title: 4 } } },
      {
        ...blocks!,
        payload: { ...blocks!.payload, blocks: [{ address, box: { x: 1 }, items: [] }] },
      },
    ]
    for (const message of bad) expect(parsePreviewMessage({ v: 1, ...message })).toBeUndefined()
  })

  it('rejects a render mode that is neither dynamic nor static, and one with no address', () => {
    const renderMode = phase2.at(-1)!
    for (const payload of [
      { address, mode: 'inline' },
      { address, mode: null },
      { address: null, mode: 'static' },
      { mode: 'dynamic' },
    ]) {
      expect(parsePreviewMessage({ ...renderMode, payload })).toBeUndefined()
    }
    expect(parsePreviewMessage({ ...renderMode, payload: { address, mode: 'dynamic' } })).toEqual({
      ...renderMode,
      payload: { address, mode: 'dynamic' },
    })
  })

  it('carries no mode on a patch: a mode sent with one is dropped', () => {
    const patch = phase2[4]!
    const payload = { ...(patch.payload as object), mode: 'static' }
    // `mode` is not a field of a patch, and a field the contract does not list is ignored, not carried.
    expect(parsePreviewMessage({ ...patch, payload })).toEqual(patch)
  })

  it('has the phase 2 messages in the generated schema, by their namespaced type', () => {
    const text = JSON.stringify(previewJsonSchema())
    for (const type of [
      'micelio:select',
      'micelio:hover',
      'micelio:insertGap',
      'micelio:patch',
      'micelio:blocks',
      'micelio:selected',
      'micelio:hovered',
      'micelio:renderMode',
    ]) {
      expect(text).toContain(type)
    }
  })
})

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

  it('ignores an unknown namespaced type too', () => {
    expect(
      parsePreviewMessage({ v: 1, type: 'micelio:scroll-to-block', payload: null })
    ).toBeUndefined()
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
