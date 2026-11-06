/** Category of the components the page settings add. */
export const PAGE_COMPONENT_CATEGORY = 'micelio-page'

/** UID of the visibility component of a page (`withPageSettings`). */
export const VISIBILITY_COMPONENT_UID = `${PAGE_COMPONENT_CATEGORY}.visibility`

/** Name of the attribute that holds a page's type. */
export const PAGE_TYPE_ATTRIBUTE = 'pageType'

/** Name of the attribute that holds a page's visibility component. */
export const VISIBILITY_ATTRIBUTE = 'visibility'

/** Name of the attribute a page's address is made of: the redirect's path is `/<slug>`. */
export const SLUG_ATTRIBUTE = 'slug'

/** UID of the `redirect` content type: the old address of a page whose published slug changed. */
export const REDIRECT_UID = 'plugin::micelio.redirect'

/** The rule that wrote a redirect: the published slug of a page changed. */
export const SLUG_CHANGE_RULE = 'slug-change'

/** Seconds a client or a shared cache may keep the answer of `GET /micelio/redirects`. */
export const REDIRECTS_MAX_AGE_SECONDS = 60
