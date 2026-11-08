import { defineConfig } from '@playwright/test'

// Update test: an old build finds, downloads and reports a newer one from a local feed.
// `pnpm test:update` builds both versions first (see scripts/prepare-update-e2e.mjs).
export default defineConfig({
  testDir: 'tests/update',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list'
})
