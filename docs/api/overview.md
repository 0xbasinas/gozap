# API, database and sign-in

`apps/api` is a [Hono](https://hono.dev) app on Cloudflare Workers. It uses D1 (SQLite) through Drizzle, and
[Better Auth](https://www.better-auth.com) for sign-in with **magic links** sent by [Resend](https://resend.com).
The same Worker also serves the built web app (`apps/web/dist`), so the site and the API share one origin: the session
cookie is first-party and there is no CORS to configure.

| File                     | What it does                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| `apps/api/src/index.ts`  | The Worker (default export) and the `AppType` used for the typed client        |
| `apps/api/src/app.ts`    | Routes: /api/health, /api/auth/* (Better Auth), /api/account, /api/preferences |
| `apps/api/src/auth.ts`   | Better Auth configuration (magic link, sessions, rate limits)                  |
| `apps/api/src/email.ts`  | EmailSender: Resend in production, the log in development, a fake in tests     |
| `apps/api/src/origin.ts` | Blocks cross-site writes                                                       |
| `apps/api/src/db/`       | Drizzle schema (auth-schema.ts is generated) and the D1 client                 |
| `apps/api/drizzle/`      | SQL migrations, applied to D1 by wrangler                                      |
| `apps/api/test/`         | Tests that run inside the real Workers runtime with a real D1                  |
| `packages/shared/`       | zod schemas shared by API, web and desktop                                     |

## Run it locally

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars     # then edit the secret
pnpm --filter @repo/web build                        # the Worker serves apps/web/dist
pnpm --filter @repo/api db:migrate:local
pnpm --filter @repo/api dev                          # http://localhost:8787
```

Without `RESEND_API_KEY`, the sign-in link is printed in the terminal.

## Deploy

The docs site is served by the same Worker under `/docs` (`pnpm build:site` builds the web app and the docs and copies the docs into `apps/web/dist/docs`). The deploy workflow fetches the full git history so each page's "Last updated" date comes from git, not from the checkout.

Run `pnpm setup:cloud` once. It creates the D1 database, verifies your sending domain in Resend, generates the secrets,
applies the migrations, deploys the Worker and sets the GitHub variables. Every step, the options and the manual
equivalents are in [the setup guide](../guides/setup-cloud.md).

After that, `.github/workflows/deploy-web.yml` deploys on every merge to `main` that changes `apps/web`, `apps/api`, `apps/docs`, `docs/` or
`packages/` (it applies pending D1 migrations first, then deploys; it stays off until the repository variable
`CLOUDFLARE_DEPLOY` is `true`). The Worker's own secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) live in Cloudflare and
CI never sees them. Migrations run before the new code, so write each one to work with the previous version too.

## Changing the database

Edit `src/db/schema.ts`, run `pnpm --filter @repo/api db:generate --name what-changed`, commit the new SQL file in
`apps/api/drizzle/`. If you add a Better Auth plugin that needs tables, add it to `src/auth.cli.ts` too and run
`pnpm --filter @repo/api auth:schema` to regenerate `auth-schema.ts`. Never edit applied migrations.

## Staying on the free tier

Cloudflare Workers Free allows 100,000 requests/day and 10 ms CPU per request; D1 Free allows 5 million rows read and
100,000 rows written per day (limits as published by Cloudflare when this was written; check them before relying on this).
The design keeps well inside that:

- **No passwords**: password hashing is CPU heavy and would not fit in 10 ms. Magic links need no hashing.
- **Session cookie cache** (1 minute): most Better Auth requests do not read the database. Our own routes still check, by primary key, that the session exists and the person is not suspended, so a suspension or sign-out stops them at once.
- **Rate limits only on sign-in**: each counted request is a D1 write, so `/get-session` is not counted.
- **Static files are free**: only `/api/*` runs Worker code.
- Resend's free plan is 100 emails/day, 3,000/month, so sign-in emails are the real ceiling.

## Security notes

- Magic-link tokens are stored hashed, expire after 5 minutes and work once.
- Sign-in requests are rate limited per IP (`cf-connecting-ip`, which Cloudflare sets itself).
- Writes with a cross-site `Origin` are rejected (`src/origin.ts`); Better Auth checks origins on its own routes.
- Every query for private data filters by the signed-in user. The tests check that one user cannot read another's data.
- The email sender is not awaited, so the response time does not reveal whether an address already has an account.
