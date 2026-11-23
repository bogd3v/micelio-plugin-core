/** UID of the `reusable-block` content type: one block of the catalogue that many pages of a site show (ADR-0022, section 1). */
export const REUSABLE_BLOCK_UID = 'plugin::micelio.reusable-block'

/** The dynamic zone of a reusable block, which holds its one block. */
export const REUSABLE_BLOCKS_ATTRIBUTE = 'blocks'

/** The key a block of a page carries when it belongs to a group (ADR-0022, section 2). */
export const GROUP_KEY = 'group'

/** The `code`s of a refused save or delete, in the `details` of the `ValidationError`. */
export const REUSABLE_BLOCK_CODES = {
  /** The reusable block holds more than one block, a reference to another, or a `group` key. */
  invalid: 'reusableBlockInvalid',
  /** A page references a reusable block of another site. */
  otherSite: 'reusableBlockOtherSite',
  /** A delete of a reusable block that pages still reference. */
  inUse: 'reusableBlockInUse',
} as const
