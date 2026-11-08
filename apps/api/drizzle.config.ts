import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` writes SQL migrations to ./drizzle. Wrangler applies them to D1 (see migrations_dir in wrangler.jsonc).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle'
})
