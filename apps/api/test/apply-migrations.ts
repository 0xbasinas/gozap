import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Runs before the tests of each file; only applies migrations that are not applied yet.
await applyD1Migrations(
  env.DB,
  (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS
)
