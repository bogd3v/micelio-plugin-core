const path = require('node:path')

// SQLite, one file per test worker (test/strapi/harness.ts sets DATABASE_FILENAME).
module.exports = ({ env }) => ({
  connection: {
    client: 'sqlite',
    connection: { filename: path.resolve(__dirname, '..', env('DATABASE_FILENAME')) },
    useNullAsDefault: true,
  },
})
