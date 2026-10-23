/** Category of the editorial component. */
export const EDITORIAL_COMPONENT_CATEGORY = 'micelio-editorial'

/** UID of the component every publishable type carries (ADR-0017, section 5). */
export const EDITORIAL_COMPONENT_UID = `${EDITORIAL_COMPONENT_CATEGORY}.editorial`

/** Name of the attribute that holds the editorial component. */
export const EDITORIAL_ATTRIBUTE = 'editorial'

/** The editorial states. Adding one is a MINOR of the core; renaming or removing one, a MAJOR. */
export const EDITORIAL_STATES = ['draft', 'in_review', 'scheduled', 'published'] as const

/** One of {@link EDITORIAL_STATES}. */
export type EditorialState = (typeof EDITORIAL_STATES)[number]
