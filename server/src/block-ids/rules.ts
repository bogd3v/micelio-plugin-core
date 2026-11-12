import { randomUUID } from 'node:crypto'

/** The id of a block in its zone (ADR-0018, section 1). */
export const BLOCK_ID = 'blockId'
/** The id of a repeatable item in its parent block. */
export const ITEM_ID = 'itemId'

/** Whether an attribute is an instance id: stored content of a page, never content a template copies. */
export function isInstanceId(name: string): boolean {
  return name === BLOCK_ID || name === ITEM_ID
}

/** A block or an item as a save carries it, and as it is stored: only the fields the rules read. */
export type Entry = Record<string, unknown>

/**
 * Settles the id of every entry of a list that a save writes (ADR-0018, section 1: the instance
 * fields `blockId` and `itemId`).
 *
 * @remarks
 * Pure: it writes `field` on the entries of `incoming` and reads nothing else. For each entry:
 *
 * 1. an id that is stored on an entry of the same component is kept, wherever the entry now is (a
 *    reorder moves the id with its block);
 * 2. otherwise the id stored at the same position, on an entry of the same component that no
 *    incoming entry claims, wins over whatever the save wrote there (an id is never changed by an
 *    edit, and a save that omits the id does not mint a new one);
 * 3. otherwise an id the save brings that no one else in the list uses is kept (an import or a
 *    duplicate restores the ids it carries);
 * 4. otherwise a fresh UUID.
 *
 * Every id in the result is unique in the list.
 *
 * @param incoming - The entries being written, in order; each is changed in place.
 * @param stored - The entries now stored in the same place, in order; empty on `create` and `clone`.
 * @param field - `blockId` or `itemId`.
 * @param newId - Where a fresh id comes from. @defaultValue `randomUUID`
 */
export function assignIds(
  incoming: readonly unknown[],
  stored: readonly Entry[],
  field: string,
  newId: () => string = randomUUID
): void {
  const entries = incoming.map((entry) => (isEntry(entry) ? entry : undefined))
  const component = (entry: Entry | undefined) => entry?.__component
  const storedBy = new Map<string, Entry>()
  for (const entry of stored) {
    const id = idOf(entry, field)
    if (id) storedBy.set(id, entry)
  }
  const used = new Set<string>()
  const decided = new Array<string | undefined>(entries.length)

  // Pass 1: an id that is stored, on the same kind of entry, stays with its entry.
  entries.forEach((entry, index) => {
    const id = entry && idOf(entry, field)
    if (!id || used.has(id)) return
    const was = storedBy.get(id)
    if (was && component(was) === component(entry)) {
      decided[index] = id
      used.add(id)
    }
  })
  // Pass 2 and 3: the others.
  entries.forEach((entry, index) => {
    if (!entry || decided[index]) return
    const before = stored[index]
    const keptId = before && idOf(before, field)
    if (
      keptId &&
      !used.has(keptId) &&
      component(before) === component(entry) &&
      !entries.some((other) => other && idOf(other, field) === keptId)
    ) {
      decided[index] = keptId
    } else {
      const brought = idOf(entry, field)
      decided[index] = brought && !used.has(brought) && !storedBy.has(brought) ? brought : undefined
    }
    if (decided[index]) used.add(decided[index])
  })
  // Pass 4: a fresh id for what is left.
  entries.forEach((entry, index) => {
    if (!entry) return
    let id = decided[index]
    if (!id) {
      do id = newId()
      while (used.has(id))
      used.add(id)
    }
    entry[field] = id
  })
}

function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function idOf(entry: Entry, field: string): string | undefined {
  const id = entry[field]
  return typeof id === 'string' && id !== '' ? id : undefined
}
