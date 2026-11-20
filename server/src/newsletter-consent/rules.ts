/** The block id of the newsletter in the catalogue. */
const NEWSLETTER = 'section.newsletter'

/** A `newsletter` block of a dynamic zone that has no consent text. */
export interface MissingConsent {
  /** The dynamic zone that holds the block. */
  zone: string
  /** Its place in the zone, from 0. */
  position: number
}

/**
 * The `newsletter` blocks of the zones whose `consentText` is absent, `null` or only whitespace.
 *
 * @remarks
 * Pure. The text is a node's own legal wording (standard, principle 2), so there is no default to
 * fall back on and the caller only warns: the block renders without a consent line as before.
 *
 * @param zones - The dynamic zones of a save, by name, each as the data carries it.
 */
export function findMissingConsent(zones: Record<string, unknown[]>): MissingConsent[] {
  return Object.entries(zones).flatMap(([zone, blocks]) =>
    blocks.flatMap((block, position) => {
      if (typeof block !== 'object' || block === null) return []
      const { __component, consentText } = block as Record<string, unknown>
      if (__component !== NEWSLETTER) return []
      const filled = typeof consentText === 'string' && consentText.trim() !== ''
      return filled ? [] : [{ zone, position }]
    })
  )
}
