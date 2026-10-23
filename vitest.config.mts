import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // In the forks pool the worker exits once Strapi is destroyed and Vitest reports a crash.
    pool: 'threads',
    // Booting Strapi takes a few seconds, more on a cold CI runner.
    hookTimeout: 120_000,
  },
})
