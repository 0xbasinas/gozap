import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside the real Workers runtime (workerd) with a real, empty D1 database per test file.
const migrations = await readD1Migrations(path.join(import.meta.dirname, 'drizzle'))

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
          // The format Resend/Svix use (whsec_ + base64), built here so the file holds no key-shaped string.
          RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from('test-webhook-secret123456').toString('base64')}`
        }
      }
    })
  ],
  test: {
    // Reuse one workerd worker for all files. With a fresh worker per file, a worker that has to be started after
    // another one finished crashes on start ("WebSocket protocol error 1009: Message is too large"), which showed up on
    // CI as soon as there were more test files than CPU cores. The tests make their own users, so sharing is safe.
    isolate: false,
    setupFiles: ['./test/apply-migrations.ts'],
    include: ['test/**/*.test.ts', 'src/**/*.test.ts']
  }
})
