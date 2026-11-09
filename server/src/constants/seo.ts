/** Name of the attribute that holds a page's SEO component. */
export const SEO_ATTRIBUTE = 'seo'

/** UID of the SEO component the host defines (`micelio-cms`): its `metaTitle`, `metaDescription` and `metaImage` are what the plugin derives and checks. */
export const SEO_COMPONENT_UID = 'shared.seo'

/** The refusal of a move out of `draft` for a page whose SEO fields are over a limit or lack the image. */
export const SEO_INVALID = 'seoInvalid'

/** The refusal of a save whose hand-written structured data is not valid JSON-LD. */
export const STRUCTURED_DATA_INVALID = 'structuredDataInvalid'

/** The warning of a transition whose description only says again the title. */
export const DESCRIPTION_REPEATS_TITLE = 'descriptionRepeatsTitle'

/** The attributes of `shared.seo` whose own limit (`maxLength`) the plugin lifts: the counters warn and the check at review decides. */
export const SEO_LIFTED_LIMITS: readonly string[] = ['metaTitle', 'metaDescription']
