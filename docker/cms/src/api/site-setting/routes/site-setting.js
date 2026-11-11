// `GET /api/site-setting`, which the frontend reads for its identity (`server/utils/site.ts` of
// micelio). No site scope: the answer is the default site's, whatever the host. Only an API token with
// `find` reads it, as in micelio-cms v0.6.0 (no role is granted).
module.exports = {
  routes: [{ method: 'GET', path: '/site-setting', handler: 'site-setting.find' }],
}
