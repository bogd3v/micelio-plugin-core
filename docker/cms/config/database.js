module.exports = ({ env }) => ({
  connection: {
    client: 'postgres',
    connection: {
      host: env('DATABASE_HOST', 'db'),
      port: env.int('DATABASE_PORT', 5432),
      database: 'strapi',
      user: 'strapi',
      password: env('DATABASE_PASSWORD'),
      ssl: false,
    },
  },
})
