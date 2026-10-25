// The seed of compose.dev.yml: one neutral site and the frontend's read-only API token. Both are
// idempotent. A new database (`down -v`, then `up`) is seeded again.

const SITE_SLUG = 'default'
const SITE_NAME = 'Example Site'
const SITE_HOSTS = ['localhost']
const TOKEN_NAME = 'Frontend (compose.dev.yml)'

async function seedSite(strapi) {
  // The plugin's bootstrap has created the default site on an empty instance, without host names.
  const site = await strapi.db.query('plugin::micelio.site').findOne({ where: { slug: SITE_SLUG } })
  // Once seeded the admin panel owns the site: a site with host names is left alone.
  if (!site || (Array.isArray(site.hosts) && site.hosts.length > 0)) return
  await strapi.documents('plugin::micelio.site').update({
    documentId: site.documentId,
    locale: site.locale,
    data: { name: SITE_NAME, hosts: SITE_HOSTS },
  })
}

async function seedFrontendToken(strapi) {
  const accessKey = process.env.FRONTEND_API_TOKEN
  if (!accessKey) return
  const tokens = strapi.service('admin::api-token')
  const existing = await tokens.getByAccessKey(tokens.hash(accessKey))
  if (existing) return
  await strapi.db.query('admin::api-token').create({
    data: {
      name: TOKEN_NAME,
      description: 'Read-only token of the frontend container, created by the seed.',
      type: 'read-only',
      kind: 'content-api',
      accessKey: tokens.hash(accessKey),
      encryptedKey: strapi.service('admin::encryption').encrypt(accessKey),
      lifespan: null,
      expiresAt: null,
    },
  })
}

module.exports = {
  register() {},
  async bootstrap({ strapi }) {
    await seedSite(strapi)
    await seedFrontendToken(strapi)
  },
}
