import { defineConfig } from '@playwright/test'

// End-to-end smoke tests run against the packaged app: `pnpm build:unpack && pnpm test:e2e`.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list'
})
