import { AsyncLocalStorage } from 'node:async_hooks'

const insideTransition = new AsyncLocalStorage<true>()

/** Runs `work` as part of a transition: the guard lets it publish and change the component. */
export function runAsTransition<T>(work: () => Promise<T>): Promise<T> {
  return insideTransition.run(true, work)
}

/** Whether the current call comes from a transition. */
export function isInsideTransition(): boolean {
  return insideTransition.getStore() === true
}
