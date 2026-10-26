// Strapi's defaults, with the frontend's origin allowed for the browser's requests and in the admin's
// `frame-src`, so the preview pane can frame it. The rest of the distribution's hardening is not
// here (AGENTS.md).
module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'frame-src': ["'self'", env('FRONTEND_ORIGIN', 'http://localhost:3000')] },
      },
    },
  },
  { name: 'strapi::cors', config: { origin: [env('FRONTEND_ORIGIN', 'http://localhost:3000')] } },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
]
