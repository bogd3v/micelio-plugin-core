// The seed of compose.dev.yml: one neutral site, the frontend's read-only API token and a custom
// token for trying the preview by hand. All are idempotent. A new database (`down -v`, then `up`) is seeded again.

const SITE_SLUG = 'default'
const SITE_NAME = 'Example Site'
const SITE_HOSTS = ['localhost']
const TOKEN_NAME = 'Frontend (compose.dev.yml)'
const PREVIEW_TOKEN_NAME = 'Preview by hand (compose.dev.yml)'
const PREVIEW_ACTIONS = ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft']

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

// The frontend's read-only token cannot exchange a preview token, and the frontend image does not
// do it yet (bogd3v/micelio#729): this one lets whoever tests by hand play the frontend with curl.
async function seedPreviewToken(strapi) {
  const accessKey = process.env.PREVIEW_API_TOKEN
  if (!accessKey) return
  const tokens = strapi.service('admin::api-token')
  const existing = await tokens.getByAccessKey(tokens.hash(accessKey))
  if (existing) return
  const created = await strapi.db.query('admin::api-token').create({
    data: {
      name: PREVIEW_TOKEN_NAME,
      description: 'Custom token that may only exchange preview tokens and read drafts by grant.',
      type: 'custom',
      kind: 'content-api',
      accessKey: tokens.hash(accessKey),
      encryptedKey: strapi.service('admin::encryption').encrypt(accessKey),
      lifespan: null,
      expiresAt: null,
    },
  })
  for (const action of PREVIEW_ACTIONS) {
    await strapi.db
      .query('admin::api-token-permission')
      .create({ data: { action, token: created.id } })
  }
}

module.exports = {
  register() {},
  async bootstrap({ strapi }) {
    await seedSite(strapi)
    await seedFrontendToken(strapi)
    await seedPreviewToken(strapi)
  },
}
