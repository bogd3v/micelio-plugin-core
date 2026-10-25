// Strapi's defaults, with the frontend's origin allowed for the browser's requests. The
// distribution's hardening is not here (AGENTS.md).
module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  { name: 'strapi::cors', config: { origin: [env('FRONTEND_ORIGIN', 'http://localhost:3000')] } },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
]
