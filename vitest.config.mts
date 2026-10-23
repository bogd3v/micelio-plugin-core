import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // A browser and an admin build: `npm run test:admin` (vitest.admin.config.mts).
    exclude: [...configDefaults.exclude, 'test/admin/**'],
    globalSetup: ['test/global-setup.ts'],
    // In the forks pool the worker exits once Strapi is destroyed and Vitest reports a crash.
    pool: 'threads',
    // Booting Strapi takes a few seconds, more on a cold CI runner.
    hookTimeout: 120_000,
  },
})
