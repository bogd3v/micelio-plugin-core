import { AsyncLocalStorage } from 'node:async_hooks'
import type { Core, Modules, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import { EXPECTED_VERSION_HEADER } from '../constants/document-version'
import { VersionConflictError } from './error'

type Params = Record<string, unknown> & { documentId?: string; locale?: string }

// The documents whose lock the current call chain holds: an `update` that nests another `update` of
// the same document (a middleware writing back) must not wait for itself.
const held = new AsyncLocalStorage<Set<string>>()
const queues = new Map<string, Promise<unknown>>()

/** Runs `task` after the earlier tasks of `key` finished, one at a time. */
async function inTurn<T>(key: string, task: () => Promise<T>): Promise<T> {
  const mine = held.getStore() ?? new Set<string>()
  if (mine.has(key)) return task()
  const previous = queues.get(key) ?? Promise.resolve()
  let release = (): void => undefined
  const turn = new Promise<void>((resolve) => {
    release = resolve
  })
  queues.set(key, turn)
  // A turn is only ever resolved, never rejected, so waiting for the one before cannot throw.
  await previous
  try {
    return await held.run(new Set(mine).add(key), task)
  } finally {
    release()
    if (queues.get(key) === turn) queues.delete(key)
  }
}

/**
 * The document service middleware that makes a save over a stale draft impossible to lose
 * silently: a request that names the version it read (`X-Micelio-Expected-Version`) is refused with
 * {@link VersionConflictError} when the draft's `updatedAt` is another instant.
 *
 * @remarks
 * Every `update` of a document runs one at a time, and the check and the write are inside the same
 * turn, so two saves that cross are decided here: the second reads what the first wrote and is
 * refused. The turns are kept in the process: with several Strapi instances on one database the
 * window shrinks to a database round trip but does not close. A request without the header saves as
 * before (the Content Manager's own form sends none).
 */
export function documentVersionDocuments(
  strapi: Core.Strapi
): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    const { documentId, locale } = context.params as Params
    if (context.action !== 'update' || !documentId) return next()
    return inTurn(`${context.uid}|${documentId}`, async () => {
      const header = strapi.requestContext.get()?.request.headers[EXPECTED_VERSION_HEADER]
      if (typeof header === 'string') {
        const expected = new Date(header).getTime()
        if (Number.isNaN(expected)) {
          throw new errors.ValidationError(`${EXPECTED_VERSION_HEADER} is not a date`)
        }
        const stored = (await strapi.documents(context.uid as UID.ContentType).findOne({
          documentId,
          locale,
          status: 'draft',
          fields: ['updatedAt'],
        } as never)) as { updatedAt?: string } | null
        if (stored?.updatedAt && new Date(stored.updatedAt).getTime() !== expected) {
          throw new VersionConflictError()
        }
      }
      return next()
    })
  }
}
