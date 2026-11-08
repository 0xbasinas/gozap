# API, database and sign-in

`apps/api` is a [Hono](https://hono.dev) app on Cloudflare Workers. It uses D1 (SQLite) through Drizzle, and
[Better Auth](https://www.better-auth.com) for sign-in with **magic links** sent by [Resend](https://resend.com).
The same Worker also serves the built web app (`apps/web/dist`), so the site and the API share one origin: the session
cookie is first-party and there is no CORS to configure.

```
apps/api/src/index.ts      The Worker (default export) and the `AppType` used for the typed client
apps/api/src/app.ts        Routes: /api/health, /api/auth/* (Better Auth), /api/account, /api/preferences
apps/api/src/auth.ts       Better Auth configuration (magic link, sessions, rate limits)
apps/api/src/email.ts      EmailSender: Resend in production, the log in development, a fake in tests
apps/api/src/origin.ts     Blocks cross-site writes
apps/api/src/db/           Drizzle schema (auth-schema.ts is generated) and the D1 client
apps/api/drizzle/          SQL migrations, applied to D1 by wrangler
apps/api/test/             Tests that run inside the real Workers runtime with a real D1
packages/shared/           zod schemas shared by API, web and desktop
```

## Run it locally

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars     # then edit the secret
pnpm --filter @repo/web build                        # the Worker serves apps/web/dist
pnpm --filter @repo/api db:migrate:local
pnpm --filter @repo/api dev                          # http://localhost:8787
```

Without `RESEND_API_KEY`, the sign-in link is printed in the terminal.

## Deploy

Run `pnpm setup:cloud` once. It creates the D1 database, verifies your sending domain in Resend, generates the secrets,
applies the migrations, deploys the Worker and sets the GitHub variables. Every step, the options and the manual
equivalents are in [setup-cloud.md](setup-cloud.md).

After that, `.github/workflows/deploy-web.yml` deploys on every merge to `main` that changes `apps/web`, `apps/api` or
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
- **Session cookie cache** (5 minutes): most requests do not read the database.
- **Rate limits only on sign-in**: each counted request is a D1 write, so `/get-session` is not counted.
- **Static files are free**: only `/api/*` runs Worker code.
- Resend's free plan is 100 emails/day, 3,000/month, so sign-in emails are the real ceiling.

## Security notes

- Magic-link tokens are stored hashed, expire after 5 minutes and work once.
- Sign-in requests are rate limited per IP (`cf-connecting-ip`, which Cloudflare sets itself).
- Writes with a cross-site `Origin` are rejected (`src/origin.ts`); Better Auth checks origins on its own routes.
- Every query for private data filters by the signed-in user. The tests check that one user cannot read another's data.
- The email sender is not awaited, so the response time does not reveal whether an address already has an account.

## Web sign-in

`apps/web` has a `/sign-in` page (email, then "check your email") and `/app`, which needs a session. `/app` is an
empty starting point for your product; call the API from it through the typed client in `packages/shared/src/client.ts`
(responses are checked with zod). To add your own data, add a table in `apps/api/src/db/schema.ts`, run `pnpm --filter @repo/api db:generate`, and filter every query by the signed-in user's id. In development you
can also run `pnpm --filter @repo/web dev`; Vite proxies `/api` to `wrangler dev` on port 8787.

## Desktop sign-in

The desktop app never shows a password or email form. **Settings → Account → Sign in** opens the system browser on
`<API>/sign-in` (with a PKCE challenge and a random `state`); after the magic link is opened the site sends the browser
back to `<scheme>:/auth/callback#token=<one-time code>`. The app swaps that code and its secret verifier for a session,
which is stored encrypted with the operating system's keychain (Electron `safeStorage`).

- Only the main process talks to the API (`apps/desktop/src/main/auth.ts`); the renderer gets `getAccount`, `signIn` and
  `signOut` through narrow `secureIpc` channels. We do not use `@better-auth/electron`'s `setupMain`, because it would
  replace this app's scheme registration, CSP, single-instance lock and IPC.
- The deep link is checked before use (`authLink.ts`): right scheme, right path, code of the expected characters and length.
- The Account section only shows in builds that know the API address. Set `API_URL` (a repository **variable**, not a
  secret) to your deployed address for release builds; in development it defaults to `http://localhost:8787`.
- The Worker already trusts `<scheme>:/` as an origin (`TRUSTED_ORIGINS` in `wrangler.jsonc`); `pnpm rename` updates it.

## Account page, data export and deletion

`/account` on the site (signed-in only) lets a person sign out everywhere, download their data and delete their account.
The API behind it is `GET /api/account`, `GET /api/account/export` and `DELETE /api/account` (`apps/api/src/app.ts`).

- These routes ask the database for the session instead of trusting the 5-minute cookie cache, so a deleted account or a
  revoked session stops working at once.
- The export lists the account, the settings and the sign-ins (time, IP, browser) and never any token.
- Deleting needs the email typed again. It removes the user; sessions, linked accounts, passkeys and settings go with it (`ON DELETE CASCADE`),
  unused sign-in links are removed, and the response clears the session cookies.
- **When you add your own tables**, give them `userId ... references user.id ON DELETE CASCADE`, and add their rows to the export
  in `app.ts`, so deletion and export stay complete. The tests in `apps/api/test/api.test.ts` ("account") show how to check it.

## Passkeys

Signing in with a passkey (fingerprint, face or security key) works next to the email link. People add passkeys on `/account`
and use them from `/sign-in`. It uses Better Auth's passkey plugin (`@better-auth/passkey`, SimpleWebAuthn underneath):

- A passkey is bound to the site's domain (`rpID` = the host of `BETTER_AUTH_URL`) and cannot be used on a look-alike site. If you
  change the domain, existing passkeys stop working, so decide it before people register.
- Verification uses the Web Crypto API, which is cheap enough for the free Workers CPU limit; a passkey sign-in costs one D1 write
  (the challenge) instead of an email.
- The desktop app signs in through the browser, so a passkey works there too: sign in on the web first, then choose Sign in in
  the app and the site hands the session over.
- The tests cover the endpoints and the rules around them (sessions needed, rpId, deletion cascades); the browser prompt itself
  needs a real authenticator, so try adding a passkey by hand after deploying.

## Synced preferences (the theme and accent colour follow you)

A small, useful example of data that follows a person between the web app and the desktop app: their **theme** (system, light
or dark) and **accent colour** (a fixed set of presets). Change them on `/account` or in the desktop **Settings > General** and the other catches up.

- API: `GET /api/preferences` and `PUT /api/preferences` (one row per person in the `preference` table). **Last write wins**:
  each save carries the time of the edit; the newest edit replaces the older one, and a stale device just gets the newer copy
  back. A stale write costs a read, not a D1 write. Times too far in the future are clamped, so a wrong clock cannot pin a value.
- Both apps keep the setting locally first (the website in `localStorage`, the desktop app in `settings.json` with a
  `preferencesUpdatedAt`, one time for both), so it applies instantly and works offline. Syncing is best effort: it runs at start, after signing in,
  when the theme changes, and every ten minutes in the desktop app (`apps/desktop/src/main/preferencesSync.ts`), and a failed
  attempt is retried by the next one because the local copy stays the newer one until it is sent.
- The logic that decides (`newerWins`, `reconcile`, `clampUpdatedAt`) is plain code in `packages/shared/src/preferences.ts`
  with tests.
- **To sync another preference**, add a field (with a default) to `preferencesSchema` in `packages/shared/src/preferences.ts`,
  read and write it in the website (`apps/web/src/lib/theme.ts` is the pattern) and, for the desktop app, add it as a setting
  (see "Adding a setting" in AGENTS.md) and include it in `preferencesSync.ts`.

## Error reporting (Sentry, optional)

Set the secret `SENTRY_DSN` and unexpected errors in the Worker are reported to [Sentry](https://sentry.io) (free plan is enough to start),
including the one that silently locks people out: a sign-in email that could not be sent. Without it nothing is sent.

- Errors only: no traces, no user identity (`dataCollection.userInfo` is off). Expected failures (401, 403, 404, validation) are
  not reported, only 500s and failed emails.
- Turn it on: create a Sentry project (platform "Cloudflare Workers"), then `SENTRY_DSN=<dsn> pnpm setup:cloud --skip-resend`, or
  `wrangler secret put SENTRY_DSN`. Use Sentry's alert rules to get an email or chat message on a new issue.
- It adds about 250 KiB (gzip) to the Worker, which is far below the 3 MiB limit of the free plan.
- `GET /api/health` is a good URL for an uptime monitor (Cloudflare Health Checks, UptimeRobot, Better Stack).

## Email deliverability: DMARC, bounces and complaints

Sign-in emails only work while mailbox providers trust your domain. Three things protect that, and `pnpm setup:cloud` does them:

- **SPF and DKIM** come from the DNS records Resend asks for (added for you when `CLOUDFLARE_API_TOKEN` is set).
- **DMARC**: a starter record `_dmarc.<domain>  TXT  "v=DMARC1; p=none;"` is added if none exists. `p=none` only asks receivers
  to report, it never rejects mail. Gmail and Yahoo expect one from every sender. Tighten it to `p=quarantine`, later
  `p=reject`, once you are sure all your mail is signed.
- **Bounces and spam complaints**: Resend calls `POST /api/webhooks/resend` (signed with Svix; the endpoint is off until
  `RESEND_WEBHOOK_SECRET` is set). A permanent bounce or a spam complaint puts the address in `email_suppression` and the Worker
  stops emailing it for 30 days (`apps/api/src/suppression.ts`). The person sees the same response as for any address, so this
  cannot be used to find out which addresses have accounts. Temporary bounces (full mailbox) are ignored. A complaint is also
  reported to Sentry if it is on. To let a corrected address through earlier:
  `wrangler d1 execute DB --remote --command "DELETE FROM email_suppression WHERE email = 'a@b.com'"`.

## Backups

D1 has **Time Travel** (restore to any minute of the last 7 days on the free plan, 30 on paid:
`wrangler d1 time-travel restore DB --timestamp=<time>`). That covers "I broke something an hour ago". For anything older, or a copy
you hold yourself, `.github/workflows/backup-d1.yml` exports the whole database every day at 03:23 UTC:

1. `wrangler d1 export` of the production database.
2. **It restores the export into an empty scratch database and counts the users**, so a broken backup fails the run (and GitHub emails
   you) instead of surprising you when you need it.
3. It is **encrypted** (AES-256, key derived from the secret `BACKUP_PASSPHRASE`) before it is uploaded as a workflow artifact,
   because artifacts of a public repository can be downloaded by anyone, and the file contains email addresses. The run refuses to
   export at all without the passphrase. Artifacts are kept for 30 days.

`pnpm setup:cloud` creates the passphrase and prints it **once**: put it in your password manager. A lost passphrase means unreadable
backups (GitHub never shows a secret again; setting it again only protects future backups).

**Restore** (into a new database, then point `database_id` at it, or copy rows over):

```bash
gh run download <run-id> -n d1-backup-<run-id>          # gives backup.sql.enc
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in backup.sql.enc -out backup.sql   # asks for the passphrase
pnpm --filter @repo/api exec wrangler d1 create my-app-restored
pnpm --filter @repo/api exec wrangler d1 execute my-app-restored --remote --file ../../backup.sql
```

The restore of the encrypted file is the one step the workflow cannot test for you: try it once now, with a manual run of the
workflow, so you know it works before you need it.

## Previews (a live copy for every pull request)

With deploys on (`CLOUDFLARE_DEPLOY=true`), a pull request that changes `apps/web`, `apps/api` or `packages` gets its own live copy of the Worker through Cloudflare's [Previews](https://developers.cloudflare.com/workers/previews/). `.github/workflows/preview.yml` builds the site, applies the migrations, runs `wrangler preview --name pr-<number>`, checks `/api/health`, and comments the address on the pull request. Closing the pull request deletes the preview.

- **Database:** all previews share one staging database (`<name>-preview`, created by `pnpm setup:cloud`). It never holds production data. Reset it with `wrangler d1 execute DB --remote --config apps/api/wrangler.preview-migrations.jsonc --command "DELETE FROM user"` (cascades to the rest). A separate database per pull request would need one of your 10 free D1 databases each, so it is shared on purpose.
- **Settings:** a preview does not inherit production variables, bindings or secrets. Its settings are the `previews` block in `apps/api/wrangler.jsonc`. `PREVIEW=true` there makes the Worker take its address from the request (`src/preview.ts`), so cookies, magic links and passkeys belong to that preview's own URL.
- **Email:** without `RESEND_API_KEY` in the preview, sign-in links are printed to the Worker log (`wrangler tail`) instead of emailed. To send real email from previews, run `wrangler preview base-config secret put RESEND_API_KEY` (and `BETTER_AUTH_SECRET`; use a different value from production).
- **Who can trigger it:** only pull requests from this repository (not forks, not Dependabot), because the job uses the Cloudflare token. Anyone who can push a branch here can run code with that token, so keep the token limited to this account and the Workers/D1 permissions, and do not give write access to people you do not trust.
- **Limits:** the free plan keeps up to 100 previews per Worker and deletes the oldest. Preview URLs are public but not indexed (`X-Robots-Tag: noindex`).
- `pnpm setup:cloud` gives previews their own `BETTER_AUTH_SECRET` (`wrangler preview base-config secret put`), never the production one. Without it sign-in fails in a preview.
