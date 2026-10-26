// The seed of compose.dev.yml: one neutral site with the frontend's url, the frontend's API token, a
// custom token for trying the preview by hand and a draft landing page with an island. All are
// idempotent. A new database (`down -v`, then `up`) is seeded again.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SITE_SLUG = 'default'
const SITE_NAME = 'Example Site'
const SITE_HOSTS = ['localhost']
const TOKEN_NAME = 'Frontend (compose.dev.yml)'
const PREVIEW_TOKEN_NAME = 'Preview by hand (compose.dev.yml)'
const LANDING_SLUG = 'landing'
// A 320x180 PNG, the poster of the scene: the static alternative of the island.
const POSTER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAABk0lEQVR42u3TQQkAAAwDsZrbY/4FbToKgSg4uOwcUCoSgIEBAwMGBgMDBgYMDBgYDAwYGDAwGBgwMGBgwMBgYMDAgIEBA4OBAQMDBgYDAwYGDAwYGAwMGBgwMGBgMDBgYMDAYGDAwICBAQODgQEDAwYGA6sABgYMDBgYDAwYGDAwYGAwMGBgwMBgYMDAgIEBA4OBAQMDBgYMDAYGDAwYGAwMGBgwMGBgMDBgYMDAgIHBwICBAQODgQEDAwYGDAwGBgwMGBgMDBgYMDBgYDAwYGDAwICBwcCAgQEDg4EBAwMGBgwMBgYMDBgYMDAYGDAwYGAwMGBgwMCAgcHAgIEBAwMGBgMDBgYMDAYGDAwYGDAwGBgwMGBgMDBgYMDAgIHBwICBAQMDBgYDAwYGDAwGBgwMGBgwMBgYMDBgYMDAYGDAwICBwcCAgQEDAwYGAwMGBgwMBlYBDAwYGDAwGBgwMGBgwMBgYMDAgIHBwICBAQMDBgYDAwYGDAwYGAwMGBgwMBgYMDBgYMDAYGDAwICBAQNDtwdgFgF0mOcBewAAAABJRU5ErkJggg==',
  'base64'
)
const PREVIEW_ACTIONS = ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft']

async function seedSite(strapi) {
  // The plugin's bootstrap has created the default site on an empty instance, without host names.
  const site = await strapi.db.query('plugin::micelio.site').findOne({ where: { slug: SITE_SLUG } })
  // Once seeded the admin panel owns the site: a site with host names is left alone.
  if (!site || (Array.isArray(site.hosts) && site.hosts.length > 0)) return
  await strapi.documents('plugin::micelio.site').update({
    documentId: site.documentId,
    locale: site.locale,
    // `url` is the frontend's origin, so the preview has somewhere to go (docs/operate/manual-testing.md).
    data: { name: SITE_NAME, hosts: SITE_HOSTS, url: process.env.FRONTEND_ORIGIN || undefined },
  })
}

// Every `find` and `findOne` of the content API: what a read-only token may do.
function readActions(strapi) {
  return Object.entries(strapi.contentAPI.permissions.getActionsMap()).flatMap(
    ([api, { controllers }]) =>
      Object.entries(controllers).flatMap(([controller, actions]) =>
        actions
          .filter((action) => action === 'find' || action === 'findOne')
          .map((action) => `${api}.${controller}.${action}`)
      )
  )
}

async function seedFrontendToken(strapi) {
  const accessKey = process.env.FRONTEND_API_TOKEN
  if (!accessKey) return
  const tokens = strapi.service('admin::api-token')
  const existing = await tokens.getByAccessKey(tokens.hash(accessKey))
  if (existing) return
  const created = await strapi.db.query('admin::api-token').create({
    data: {
      name: TOKEN_NAME,
      // The reads of a read-only token plus the two preview routes: nothing else.
      description: 'Token of the frontend container, created by the seed.',
      type: 'custom',
      kind: 'content-api',
      accessKey: tokens.hash(accessKey),
      encryptedKey: strapi.service('admin::encryption').encrypt(accessKey),
      lifespan: null,
      expiresAt: null,
    },
  })
  for (const action of [...readActions(strapi), ...PREVIEW_ACTIONS]) {
    await strapi.db
      .query('admin::api-token-permission')
      .create({ data: { action, token: created.id } })
  }
}

// A token with only the two preview routes, so whoever tests by hand can play the frontend with curl
// (the frontend's own token also reads the content).
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

// A binary glTF with one triangle: the smallest model the scene's loader accepts, so the island
// reaches `ready` when the browser can load the file.
function triangleGlb() {
  const positions = Buffer.alloc(36)
  ;[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: positions.length }],
      bufferViews: [{ buffer: 0, byteLength: positions.length, target: 34962 }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
    })
  )
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
  const chunk = (type, body) => {
    const head = Buffer.alloc(8)
    head.writeUInt32LE(body.length, 0)
    head.writeUInt32LE(type, 4)
    return Buffer.concat([head, body])
  }
  const body = Buffer.concat([chunk(0x4e4f534a, padded), chunk(0x004e4942, positions)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + body.length, 8)
  return Buffer.concat([header, body])
}

async function upload(strapi, name, mimetype, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-seed-'))
  try {
    const filepath = path.join(dir, name)
    fs.writeFileSync(filepath, bytes)
    const [file] = await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        data: { fileInfo: { name, alternativeText: name } },
        files: { filepath, originalFilename: name, mimetype, size: bytes.length },
      })
    // The frontend prefixes a relative media URL with the address it reaches the CMS at (`cms:1337`),
    // which a browser on the host cannot resolve: an absolute URL on the published port is kept as is.
    const origin = process.env.CMS_PUBLIC_URL
    if (origin && file.url.startsWith('/')) {
      await strapi.db
        .query('plugin::upload.file')
        .update({ where: { id: file.id }, data: { url: `${origin}${file.url}` } })
    }
    return file.id
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// The "landing" of the preview pane: a draft page with a text section and a scene, a heavy island
// whose poster is its static alternative. The plugin has no `page` type of its own until the
// cut-over of release line 0.7: this one is the fixture of docker/cms/src/api/page/.
async function seedLanding(strapi) {
  const site = await strapi.db.query('plugin::micelio.site').findOne({ where: { slug: SITE_SLUG } })
  if (!site) return
  if (await strapi.db.query('api::page.page').findOne({ where: { slug: LANDING_SLUG } })) return
  await strapi.documents('api::page.page').create({
    locale: 'en',
    data: {
      title: 'Open source, in plain words',
      slug: LANDING_SLUG,
      site: site.documentId,
      sections: [
        {
          __component: 'section.rich-text',
          body: '## Software you can read, run and change\n\nThis page is a draft: only the preview shows it.',
        },
        {
          __component: 'section.scene',
          variant: 'inline',
          title: 'A scene',
          alt: 'A blue panel standing in for a 3D scene',
          // A triangle, so the island has a model to load; "as static site" shows the poster instead.
          model: await upload(strapi, 'scene.glb', 'model/gltf-binary', triangleGlb()),
          poster: await upload(strapi, 'poster.png', 'image/png', POSTER),
        },
      ],
    },
  })
}

module.exports = {
  register() {},
  async bootstrap({ strapi }) {
    await seedSite(strapi)
    await seedFrontendToken(strapi)
    await seedPreviewToken(strapi)
    await seedLanding(strapi)
  },
}
