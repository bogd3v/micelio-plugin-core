// The messages between the admin page and the preview frame (ADR-0019, section 4). Phase 1 has
// two: `ready` (frame → admin) and `load-draft` (admin → frame). Phase 2 adds the block messages of
// the amendment of 2026-11-02 (bogd3v/micelio#732), namespaced `micelio:`: `select`, `hover`,
// `insertGap` and `patch` towards the frame, `blocks`, `selected` and `hovered` towards the admin.
// The amendment of 2026-11-04 (bogd3v/micelio#837) adds `micelio:renderMode`, the render mode of
// one block, towards the frame. The amendment of 2026-11-06 (bogd3v/micelio#851) adds `micelio:run`
// towards the frame and its answer, `micelio:runResult`, towards the admin.
// The JSON Schema generated from these schemas is `preview.schema.json`; the frontend validates
// against it.
import { z } from 'zod'

/** The envelope version this release speaks. A breaking change to a message raises it. */
export const PREVIEW_PROTOCOL_VERSION = 1

/** The envelope every message travels in; `type` is any string so a newer peer can add messages. */
const envelope = z.object({
  v: z.literal(PREVIEW_PROTOCOL_VERSION),
  type: z.string().min(1),
  payload: z.unknown(),
})

/**
 * Frame → admin: the frame has loaded a draft.
 *
 * `version` is the `updatedAt` of the draft the frame shows; the admin drops a message that names
 * another version (ADR-0019, section 4).
 */
export const readyMessage = envelope
  .extend({
    type: z.literal('ready'),
    payload: z.object({
      /** The envelope versions the frame speaks. */
      v: z.array(z.int().positive()).min(1),
      documentId: z.string().min(1),
      /** `null` for a draft that is not localised. */
      locale: z.string().min(1).nullable(),
      version: z.string().min(1),
    }),
  })
  .meta({
    id: 'ready',
    title: 'ready',
    description: 'Frame → admin: the frame has loaded a draft.',
  })

/** Admin → frame: reload the draft after a save. */
export const loadDraftMessage = envelope
  .extend({
    type: z.literal('load-draft'),
    payload: z.object({
      documentId: z.string().min(1),
      /** `null` for a draft that is not localised. */
      locale: z.string().min(1).nullable(),
    }),
  })
  .meta({
    id: 'load-draft',
    title: 'load-draft',
    description: 'Admin → frame: reload the draft after a save.',
  })

/** The dynamic zone whose blocks the frame reports; `blocks` (articles) is not spoken yet. */
const zone = z.literal('sections')

/**
 * Where a block is: by position and catalogue id, never by Strapi's component id.
 *
 * `version` is the `updatedAt` of the draft the frame shows; the frame drops a message that names
 * another one, so a reorder that crosses a reload cannot move the wrong block.
 */
export const blockAddress = z.object({
  zone,
  /** The position among the blocks the frontend renders (`data-myc-index`). */
  index: z.int().nonnegative(),
  /** The block's catalogue id (ADR-0018), such as `hero`. */
  block: z.string().min(1),
  version: z.string().min(1),
})

/** A rectangle in CSS pixels from the top left corner of the document, scroll included. */
export const previewBox = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

/** New plain-text values by field name; `null` clears an optional field. */
const patchContent = z.record(z.string(), z.string().nullable())

/** Admin → frame: outline a block, or an item of it, or nothing (`address: null`). */
export const selectMessage = envelope
  .extend({
    type: z.literal('micelio:select'),
    payload: z.object({
      address: blockAddress.nullable(),
      /** A position among the block's items. */
      item: z.int().nonnegative().nullable().optional(),
      /** Bring the block into view without animation. */
      reveal: z.boolean().optional(),
    }),
  })
  .meta({
    id: 'micelio:select',
    title: 'micelio:select',
    description: 'Admin → frame: outline a block or an item.',
  })

/** Admin → frame: the block or item the admin's list is pointing at, or nothing. */
export const hoverMessage = envelope
  .extend({
    type: z.literal('micelio:hover'),
    payload: z.object({
      address: blockAddress.nullable(),
      item: z.int().nonnegative().nullable().optional(),
    }),
  })
  .meta({
    id: 'micelio:hover',
    title: 'micelio:hover',
    description: 'Admin → frame: the block the list points at.',
  })

/** Admin → frame: open a gap after a block, to show where an insert will land. */
export const insertGapMessage = envelope
  .extend({
    type: z.literal('micelio:insertGap'),
    payload: z.object({
      version: z.string().min(1),
      zone,
      /** The position of a block, or `null` for the top of the zone. */
      after: z.int().nonnegative().nullable(),
      /** In pixels, at most 2000; 0 closes the gap. */
      height: z.number().min(0).max(2000),
    }),
  })
  .meta({
    id: 'micelio:insertGap',
    title: 'micelio:insertGap',
    description: 'Admin → frame: open a gap after a block.',
  })

/** Admin → frame: new text for a block or its items, shown without a reload and never saved by the frame. */
export const patchMessage = envelope
  .extend({
    type: z.literal('micelio:patch'),
    payload: z.object({
      address: blockAddress,
      content: patchContent,
      items: z.array(z.object({ index: z.int().nonnegative(), content: patchContent })),
    }),
  })
  .meta({
    id: 'micelio:patch',
    title: 'micelio:patch',
    description: 'Admin → frame: new text for a block.',
  })

/** How a block is shown: as the page renders it, or as its static alternative. */
export const renderMode = z.enum(['dynamic', 'static'])

/**
 * Admin → frame: show a block in a render mode.
 *
 * @remarks
 * The mode is state of the frame, never saved: a reload shows every block as it loads, and the admin
 * sends the message again after the next `ready`. The frame answers nothing. `micelio:patch` is for
 * text and carries no mode (ADR-0019, amendment of 2026-11-04).
 */
export const renderModeMessage = envelope
  .extend({
    type: z.literal('micelio:renderMode'),
    payload: z.object({
      address: blockAddress,
      mode: renderMode,
    }),
  })
  .meta({
    id: 'micelio:renderMode',
    title: 'micelio:renderMode',
    description: 'Admin → frame: show a block as its static alternative or as the page renders it.',
  })

/**
 * Admin → frame: run the Playground block at `address`, as the draft the frame shows holds it.
 *
 * @remarks
 * The payload is the address and an id, and nothing else: a run that carries code, a language, a
 * setup or any other field is refused, because the frame never runs code that arrives in a message
 * (ADR-0019, amendment of 2026-11-06). `requestId` is unique among the runs the admin has open for
 * the frame, which answers with `micelio:runResult`.
 */
export const runMessage = envelope
  .extend({
    type: z.literal('micelio:run'),
    payload: z.strictObject({
      requestId: z.string().min(1),
      address: blockAddress.strict(),
    }),
  })
  .meta({
    id: 'micelio:run',
    title: 'micelio:run',
    description: 'Admin → frame: run the Playground block at an address, as the draft holds it.',
  })

/** Why a run gave no output to use: the closed list of the amendment of 2026-11-06. */
const runFailure = z.enum(['codeError', 'timeout', 'runtimeUnavailable', 'notRunnable'])

/**
 * Frame → admin: the answer to a `micelio:run`, with its `requestId` and `address`.
 *
 * @remarks
 * `ok: true` carries the output, cut at 64 KB of UTF-8 (`truncated` says so); `ok: false` carries a
 * `reason`, and `codeError` the message a reader would see as `output`. The output is plain text:
 * the admin shows it as text, never as HTML.
 */
export const runResultMessage = envelope
  .extend({
    type: z.literal('micelio:runResult'),
    payload: z.discriminatedUnion('ok', [
      z.object({
        requestId: z.string().min(1),
        address: blockAddress,
        ok: z.literal(true),
        output: z.string(),
        truncated: z.boolean(),
      }),
      z.object({
        requestId: z.string().min(1),
        address: blockAddress,
        ok: z.literal(false),
        reason: runFailure,
        /** The error message a reader would see; only with `codeError`. */
        output: z.string().optional(),
      }),
    ]),
  })
  .meta({
    id: 'micelio:runResult',
    title: 'micelio:runResult',
    description: 'Frame → admin: the output of a run, or why it failed.',
  })

/** Frame → admin: every block and item with its box, on each reflow and scroll. */
export const blocksMessage = envelope
  .extend({
    type: z.literal('micelio:blocks'),
    payload: z.object({
      version: z.string().min(1),
      scroll: z.object({ x: z.number(), y: z.number() }),
      viewport: z.object({ width: z.number(), height: z.number() }),
      blocks: z.array(
        z.object({
          address: blockAddress,
          box: previewBox,
          items: z.array(z.object({ index: z.int().nonnegative(), box: previewBox })),
        })
      ),
    }),
  })
  .meta({
    id: 'micelio:blocks',
    title: 'micelio:blocks',
    description: 'Frame → admin: the boxes of the blocks.',
  })

const pointed = z.object({
  address: blockAddress.nullable(),
  item: z.int().nonnegative().nullable(),
  /** `null` with no address. */
  box: previewBox.nullable(),
})

/** Frame → admin: the selection the frame found: the answer to `micelio:select` and a click on a block. */
export const selectedMessage = envelope
  .extend({ type: z.literal('micelio:selected'), payload: pointed })
  .meta({
    id: 'micelio:selected',
    title: 'micelio:selected',
    description: 'Frame → admin: the selected block.',
  })

/** Frame → admin: the block under the pointer, or the answer to `micelio:hover`. */
export const hoveredMessage = envelope
  .extend({ type: z.literal('micelio:hovered'), payload: pointed })
  .meta({
    id: 'micelio:hovered',
    title: 'micelio:hovered',
    description: 'Frame → admin: the hovered block.',
  })

/** The messages of phases 1 and 2, the render mode and the run of a Playground block. */
export const previewMessage = z.union([
  readyMessage,
  loadDraftMessage,
  selectMessage,
  hoverMessage,
  insertGapMessage,
  patchMessage,
  renderModeMessage,
  runMessage,
  blocksMessage,
  selectedMessage,
  hoveredMessage,
  runResultMessage,
])

/** A message of the protocol. */
export type PreviewMessage = z.infer<typeof previewMessage>

/** How a block is shown in the frame. */
export type RenderMode = z.infer<typeof renderMode>

/** Why a run of a Playground block gave no output to use. */
export type RunFailure = z.infer<typeof runFailure>

/** The address of a block, as a message carries it. */
export type BlockAddress = z.infer<typeof blockAddress>

/** A rectangle of the frame's document. */
export type PreviewBox = z.infer<typeof previewBox>

/**
 * Reads a `postMessage` payload as a message of the protocol.
 *
 * @returns The message, or `undefined` when the envelope or the payload fails its schema, the
 * envelope `v` is not one this release speaks, or the `type` is unknown (a receiver ignores it).
 */
export function parsePreviewMessage(data: unknown): PreviewMessage | undefined {
  const result = previewMessage.safeParse(data)
  return result.success ? result.data : undefined
}

/** The JSON Schema of the messages, as `contract/preview.schema.json` holds it. */
export function previewJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(previewMessage, { target: 'draft-2020-12', io: 'input' })
  return {
    ...schema,
    title: 'Micelio preview messages',
    description:
      'The messages between the admin and the preview frame, in the envelope { v, type, payload }. ' +
      'Generated from contract/preview.ts of @micelio/strapi-plugin-core (ADR-0019); do not edit.',
  }
}
