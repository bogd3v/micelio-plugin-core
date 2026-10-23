import { defineConfig } from 'vitest/config'

// `npm run test:admin`: the plugin's admin pages in a browser, in the admin of the test app.
export default defineConfig({
  test: {
    include: ['test/admin/**/*.test.ts'],
    // The plugin first: the admin bundle takes its admin from `dist/admin`.
    globalSetup: ['test/global-setup.ts', 'test/admin/global-setup.ts'],
    pool: 'threads',
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
})
