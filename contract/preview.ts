// The messages between the admin page and the preview frame (ADR-0019, section 4). Phase 1 has
// two: `ready` (frame → admin) and `load-draft` (admin → frame). Phase 2 adds block messages in a
// later MINOR. The JSON Schema generated from these schemas is `preview.schema.json`; the frontend
// validates against it.
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

/** The phase 1 messages. */
export const previewMessage = z.union([readyMessage, loadDraftMessage])

/** A phase 1 message. */
export type PreviewMessage = z.infer<typeof previewMessage>

/**
 * Reads a `postMessage` payload as a phase 1 message.
 *
 * @returns The message, or `undefined` when the envelope or the payload fails its schema, the
 * envelope `v` is not one this release speaks, or the `type` is unknown (a receiver ignores it).
 */
export function parsePreviewMessage(data: unknown): PreviewMessage | undefined {
  const result = previewMessage.safeParse(data)
  return result.success ? result.data : undefined
}

/** The JSON Schema of the phase 1 messages, as `contract/preview.schema.json` holds it. */
export function previewJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(previewMessage, { target: 'draft-2020-12', io: 'input' })
  return {
    ...schema,
    title: 'Micelio preview messages',
    description:
      'The phase 1 messages between the admin and the preview frame, in the envelope { v, type, payload }. ' +
      'Generated from contract/preview.ts of @micelio/strapi-plugin-core (ADR-0019); do not edit.',
  }
}
