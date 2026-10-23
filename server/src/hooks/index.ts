import type { Core } from '@strapi/strapi'
import type { HookHandler, HookName, HookPayloads, MicelioHooks } from '../types/hooks'

/** The hooks API with what only the core calls: running a hook. */
export interface HookRegistry extends MicelioHooks {
  /**
   * Runs the handlers of a `before` hook in order; the first that throws stops the rest.
   *
   * @throws Whatever that handler threw.
   */
  runBefore<K extends HookName>(name: K, payload: HookPayloads[K]): Promise<void>
  /** Runs the handlers of an `after` hook in order; one that throws is logged and the rest run. */
  runAfter<K extends HookName>(name: K, payload: HookPayloads[K]): Promise<void>
}

type AnyHandler = (payload: unknown) => unknown

const HOOK_NAMES: ReadonlySet<string> = new Set<HookName>([
  'beforeTransition',
  'afterTransition',
  'afterPublish',
  'afterUnpublish',
  'siteCreated',
  'blockCatalogueChanged',
])

/**
 * A new, empty hooks registry; the `hooks` service holds the one of a Strapi instance.
 *
 * @param log - Where an `after` handler's failure is reported.
 */
export function createHookRegistry(log: Pick<Core.Strapi['log'], 'error'>): HookRegistry {
  const handlers = new Map<string, AnyHandler[]>()
  const handlersOf = (name: string): AnyHandler[] => [...(handlers.get(name) ?? [])]

  return {
    on<K extends HookName>(name: K, handler: HookHandler<K>): () => void {
      if (!HOOK_NAMES.has(name)) throw new TypeError(`micelio: "${String(name)}" is not a hook`)
      if (typeof handler !== 'function') {
        throw new TypeError(`micelio: the handler of ${name} must be a function`)
      }
      const entry = handler as AnyHandler
      handlers.set(name, [...(handlers.get(name) ?? []), entry])
      return () => {
        handlers.set(
          name,
          (handlers.get(name) ?? []).filter((registered) => registered !== entry)
        )
      }
    },
    async runBefore(name, payload) {
      const frozen = deepFreeze(structuredClone(payload))
      for (const handler of handlersOf(name)) await handler(frozen)
    },
    async runAfter(name, payload) {
      const frozen = deepFreeze(structuredClone(payload))
      for (const handler of handlersOf(name)) {
        try {
          await handler(frozen)
        } catch (error) {
          log.error(`micelio: a ${name} handler failed: ${String(error)}`)
        }
      }
    },
  }
}

/** The hooks registry of a Strapi instance with this plugin. */
export function hooksOf(strapi: Core.Strapi): HookRegistry {
  return strapi.plugin('micelio').service('hooks') as HookRegistry
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
