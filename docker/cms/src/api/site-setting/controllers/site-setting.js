// Fixture of compose.dev.yml: answers `GET /api/site-setting` as the 0.7 alias of micelio-cms will,
// from the core's default site (`plugin::micelio.site`, `isDefault: true`), with the shape and the
// response fields of micelio-cms v0.6.0 (`src/constants/response-fields/site.ts`, route
// `site-setting.find`). It is not the distribution's alias and the package does not ship it.
// A field the core's site does not hold answers `null`, so the frontend keeps its own default:
// `homePage` always, and `modules` and `theme` when the site has none. The two components have the
// fields of micelio-cms v0.6.0's, so the Customize page's saves show on the frontend (#60).
// `fediverse` is not in the response of v0.6.0.

const SITE = 'plugin::micelio.site'

const IMAGE = ['url', 'alternativeText', 'width', 'height', 'id', 'documentId']
// The scalar fields of micelio-cms v0.6.0's `site-setting`, the ones its response lists and the
// ones the frontend does not read yet (`surplus` there).
const FIELDS = [
  'name',
  'description',
  'url',
  'defaultLocale',
  'contactEmail',
  'privacyContactEmail',
  'privacyUpdatedAt',
  'supportHandle',
  'id',
  'documentId',
  'tagline',
  'securityContact',
  'privacyJurisdiction',
  'timezone',
  'addressLocality',
  'locale',
  'createdAt',
  'updatedAt',
  'publishedAt',
]

// The fields of `micelio-site.modules` and `micelio-site.theme`, as v0.6.0's response lists them.
const MODULES = ['newsletter', 'comments', 'accounts', 'drafts', 'fediverse', 'search', 'support']
const THEME = ['themeId', 'themeVersion', 'themeDigest', 'defaultMode', 'displayFont']

const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source?.[key] ?? null]))
const image = (value) => (value ? pick(value, IMAGE) : null)

/** The body of v0.6.0's `site-setting.find`, from a row of the default site. */
function shape(site) {
  return {
    ...pick(site, FIELDS),
    author: site.author ? pick(site.author, ['name', 'url', 'id']) : null,
    logo: image(site.logo),
    favicon: image(site.favicon),
    defaultOgImage: image(site.defaultOgImage),
    socialLinks: (site.socialLinks ?? []).map((link) => pick(link, ['network', 'url', 'id'])),
    modules: site.modules ? pick(site.modules, MODULES) : null,
    theme: site.theme
      ? {
          ...pick(site.theme, THEME),
          accentOverrides: (site.theme.accentOverrides ?? []).map((override) =>
            pick(override, ['mode', 'color'])
          ),
        }
      : null,
    homePage: null,
  }
}

module.exports = ({ strapi }) => ({
  async find(ctx) {
    const documents = strapi.documents(SITE)
    const query = {
      filters: { isDefault: true },
      populate: {
        author: true,
        logo: true,
        favicon: true,
        defaultOgImage: true,
        socialLinks: true,
        modules: true,
        theme: { populate: { accentOverrides: true } },
      },
    }
    const locale = typeof ctx.query?.locale === 'string' ? ctx.query.locale : undefined
    // A locale the site has no row in answers the default one, as a single type does.
    const site =
      (locale && (await documents.findFirst({ ...query, locale }))) ||
      (await documents.findFirst(query))
    if (!site) return ctx.notFound('No default site')
    return { data: shape(site), meta: {} }
  },
})
