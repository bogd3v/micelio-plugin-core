const MAX_DEPTH = 6

type Attributes = Record<string, unknown>

/**
 * The `populate` that reads every component and dynamic zone of a content type, however deep, so
 * that a catalogue block nested in a component is found.
 *
 * @remarks
 * Built from the schema because `populate: '*'` goes one level only. Media and relations are left
 * out: a block's place in a page is all the check and the usage count read.
 *
 * @param attributes - The attributes of a content type or a component.
 * @param componentAttributes - The attributes of a component by UID.
 */
export function populateOf(
  attributes: Attributes,
  componentAttributes: (uid: string) => Attributes | undefined,
  depth = 0
): Record<string, unknown> {
  const populate: Record<string, unknown> = {}
  if (depth >= MAX_DEPTH) return populate
  const into = (uid: string): unknown => {
    const nested = populateOf(componentAttributes(uid) ?? {}, componentAttributes, depth + 1)
    return Object.keys(nested).length > 0 ? { populate: nested } : true
  }
  for (const [name, attribute] of Object.entries(attributes)) {
    const { type, component, components } = (attribute ?? {}) as {
      type?: string
      component?: string
      components?: string[]
    }
    if (type === 'component' && typeof component === 'string') {
      populate[name] = into(component)
    } else if (type === 'dynamiczone' && Array.isArray(components)) {
      populate[name] = { on: Object.fromEntries(components.map((uid) => [uid, into(uid)])) }
    }
  }
  return populate
}
