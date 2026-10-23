module.exports = ({ env }) => ({
  host: '127.0.0.1',
  port: env.int('PORT', 0),
  app: { keys: env.array('APP_KEYS') },
  // No update check against the npm registry (Strapi still creates .strapi-updater.json).
  logger: { updates: { enabled: false } },
})
