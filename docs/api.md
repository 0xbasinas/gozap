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

## Devices

`GET /api/devices` lists the signed-in person's sessions, one per place they are signed in: a readable label worked out from the
user agent (`describeDevice` in `packages/shared/src/devices.ts`), an optional nickname, when it was created and last seen, and
which one is the caller's. `PATCH /api/devices/:id` sets or clears the nickname (up to 40 characters, stored in `session_nickname`,
which goes with the session or the account), and `DELETE /api/devices/:id` signs that device out. The id is the session's row id,
never its token, every query is limited to the caller's own sessions, and the caller's own session cannot be deleted this way
(sign out instead). These routes check the database on every call, so a device you signed out stops working at once; routes that
use the session cookie cache (preferences, feedback) still check the session and suspension in the database, so they stop at once too.

The web app shows this on `/account` ("Your devices") and the desktop app in Settings. A nickname belongs to a session, so signing
in again on the same device starts without one. Nicknames are listed in the data export.

## Feature flags and the kill switch

`GET /api/flags?channel=stable|beta&id=<install id>` is public and needs no sign-in. It answers `{ "flags": { "key": true } }` for that
install. A flag is on when it is not killed, the channel matches (no channels means all), and the install falls inside `percent`
(a stable hash of the key and the install id, so raising the percentage only adds installs). Unknown flags are off, so code
must treat "absent" as off. The install id is random, made by the app or browser, and not stored by the server.

Change them with `pnpm flags list`, `pnpm flags set new-editor --percent 25 --channels beta`, `pnpm flags kill new-editor`,
`pnpm flags revive new-editor` and `pnpm flags delete new-editor` (local database; add `--remote` for the real one).
The kill switch beats everything and reaches running apps within about five minutes (the API caches for 60 seconds,
clients refresh every five). Use `useFlag('key')` in the desktop renderer or the web app.

## Consent ledger

`consent` is an append-only list of what a person agreed to or withdrew: purpose, granted, the policy version (`POLICY_VERSION` in
`packages/shared/src/consents.ts`) and the time. `GET /api/account/consents` returns the latest answer per purpose and the
history; `POST` with `{ purpose, granted }` adds an entry (repeating the current answer adds nothing; withdrawing something never
agreed to is ignored). Entries are never edited, go when the account is deleted, and are in the account export. To ask for a new
thing, add it to `CONSENT_PURPOSES` and `CONSENT_LABELS`; bump `POLICY_VERSION` when the policy text changes. The privacy page
shows "Your agreements". Nothing here is needed to sign in.

## Bot check on sign-in (Cloudflare Turnstile, optional)

The email-link request (`POST /sign-in/magic-link`) is the one endpoint that sends email, so it can be protected with Cloudflare Turnstile, which is free and runs on your own Cloudflare account.

- Create a Turnstile widget in the Cloudflare dashboard (hostname: your site). Put the **site key** in `TURNSTILE_SITE_KEY` (a public variable in `apps/api/wrangler.jsonc`) and the **secret key** with `wrangler secret put TURNSTILE_SECRET_KEY`.
- The check turns on only when **both** are set. `/api/app-config` then returns `turnstileSiteKey`; the sign-in page shows the widget and sends the token in the `x-captcha-response` header. Without a token the API answers 400 and sends no email; a failed check is 403. A token works once, so the page asks for a new one after every try.
- Only `/sign-in/magic-link` is checked (not the link itself, and not passkeys). A request without a valid token still counts against the sign-in rate limit.
- The tests fake Cloudflare's answer (a stubbed `siteverify`): a token Cloudflare accepts sends the email with our secret, a rejected one is 403, a missing one never reaches Cloudflare, and an unreachable Cloudflare fails closed (5xx, no email). To try it locally use Cloudflare's test keys: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
- The page's security headers (`apps/web/public/_headers`) allow `https://challenges.cloudflare.com` for scripts, frames and connections.

## Security activity (audit trail)

Table `audit_event` (`apps/api/src/audit.ts`) records what happened to an account: sign-ins (from the session hook), failed magic-link and passkey sign-ins, sessions revoked, profile and passkey changes, and admin actions. Better Auth `hooks.after` decides what to record (`eventForCall`, tested); a bad magic link is a redirect with `error=`, not an error object. Writes run after the response and never fail a request.

- `GET /api/account/security-activity` lists the person's own latest 50 events; the same list is in the data export, and the privacy summary counts them.
- `detail` holds a code only, never what a stranger typed. Failed sign-ins have no person attached and are removed after 30 days; everything else after a year (daily job). Events about a person are deleted with the account.

## Staff roles and the admin page

The Better Auth `admin` plugin is on, with two roles (`apps/api/src/permissions.ts`): **admin** (list, create, update, set role or password, suspend, impersonate, revoke sessions; not delete, not impersonate other admins) and **support** (list and look up people and sessions only). Everyone else is `user` and can do nothing there.

- Nobody is staff by default and sign-up never grants a role. Give or take one with `pnpm admin:grant <email> [admin|support]` and `pnpm admin:revoke <email>` (local database; add `--remote` for the real one). The person must have signed in once.
- A role change shows up on their next sign-in, or within 1 minute (the session cookie cache).
- `/admin` in the website lists people (search by email, pages of 25) and lets an admin suspend or restore them. Suspending ends their sessions and blocks new ones; the server enforces permissions, the page only hides buttons.
- Suspending ends the person's sessions at once. Our own routes (account, preferences, feedback, API keys) refuse a suspended person immediately. Only Better Auth's own endpoints (for example the admin and team routes) read the session cookie cache, so a demoted or suspended staff member could still act there for up to 1 minute.
- `GET /api/admin/audit/:userId` (admin and support) returns one person's security activity; the "Activity" button on `/admin` shows it.
- Admin actions are written to the audit trail with `actor_id` set to the staff member.
- Deleting an account stays on the person's own cooling-off flow; the plugin's delete is not granted to anyone.

## API keys

People make keys on their account page for scripts that act as them (`@better-auth/api-key`, table `apikey`). A key is shown once, is stored as a hash, expires after 90 days by default (at most 365), is limited to 60 requests a minute, needs a name, and a person may hold ten. Send it in the `x-api-key` header; `GET /api/v1/me` is the example call and shows how to check a key on the server (`auth.api.verifyApiKey`, which rejects suspended people). Usage counters are written after the response (`deferUpdates`).

- `apikey.reference_id` has no foreign key, so the daily deletion job removes a person's keys itself (`deletion.ts`). The data export lists name, first characters and dates, never the key.
- A key is made with the single permission `account: read`. Every route that accepts a key must name the permission it needs when it checks it (`/api/v1/me` passes `permissions: { account: ['read'] }` to `verifyApiKey`); add a new permission for new kinds of access, never reuse `account`. Do not enable `enableSessionForAPIKeys`.

## Teams

The Better Auth `organization` plugin is on (tables `organization`, `member`, `invitation`; `session.active_organization_id`). Anyone signed in can start up to 5 teams; a team holds up to 50 people; the starter is the `owner`. No sub-teams and no custom roles yet.

- `/teams` in the website: create a team, see members, invite by email, cancel an invitation, remove a member, leave (or, for the owner, delete).
- The invitation email (`teams.ts`) links to `/accept-invitation/<id>`, which asks the person to sign in with the invited address (`/sign-in?next=...`, a path on this site only) and then accept. Someone else's account cannot accept it. Invitations last 7 days, a re-invite cancels the old one, and an address that bounced gets nothing.
- All foreign keys cascade. Deleting an account also deletes teams nobody else belongs to (`soloTeamsDeletion`, same batch as the deletion); teams with other members stay. The data export lists a person's teams and their role.
- The audit trail records team created/deleted/left, invitations sent and accepted, and members removed.

## Single sign-on for companies (OpenID Connect)

`@better-auth/sso` is on, **OpenID Connect only**. Table `sso_provider` (cascades with the admin who added it, so deleting that admin removes the provider).

- **Who sets it up:** only an `admin` can register a provider (`providersLimit` is 25 for admins and 0 for everyone else), from the "Company sign-in" section of `/admin`: provider name, issuer URL, email domain, client id and secret. The secret is stored in the database row; treat the database as secret-bearing and use `defaultSSO` in code instead if you prefer to keep it out.
- **Proof of domain:** domain verification is on. A provider cannot sign anyone in until its domain has a DNS TXT record `_better-auth-token-<provider>.<domain>` with the token shown after registering; "Check the record" confirms it (a lookup that uses `node:dns/promises`, which works on Workers with `nodejs_compat`).
- **Signing in:** "Sign in with your company" on the sign-in page takes the work email, finds the provider by its domain and redirects to the company's login. An unverified domain answers 401. A new person is created on first sign-in; an existing person is linked only when the domain is verified.
- **A company can only create accounts at its own domain.** A `user.create.before` hook rejects a new account from `/sso/callback/<provider>` when the address is not at the provider's domain (or a subdomain). Without it a provider with a proven domain could create accounts, and keep a session, for any address. Tested.
- **SAML is refused** (`/sso/register` with a `samlConfig` answers 400). Checking a SAML response took about 10 to 15 ms in a local test, above the 10 ms CPU limit of the free Workers plan. Enable it only on the paid plan, after measuring in production.
- Tested here with a fake provider that signs real RS256 id tokens: a whole login (register, domain proof, authorize, callback, session), a person at another domain, and an unproven domain. A real login against Google Workspace, Okta or Entra has not been tried: test each in gozap before promising it to a customer. Deleting a provider does not end sessions already created through it.

## Feedback

`POST /api/feedback` stores a message (kind `bug`, `idea` or `other`, up to 4000 characters, plus an optional diagnostics
report up to 24000) in the `feedback` table. It needs a session, so there is no anonymous spam, and each person can send
5 per hour (one indexed count; `FEEDBACK_PER_HOUR` in `packages/shared/src/feedback.ts`).

The web app has `/feedback`. The desktop app has a Settings section; its main process sends the message as the signed-in
person (`apps/desktop/src/main/feedback.ts`) and can attach the diagnostics report. Feedback is deleted with the account
(`ON DELETE CASCADE`) and listed in the data export, without the diagnostics text. Reading it is for the owner: query the
table with `wrangler d1 execute` until the admin dashboard exists.

## Account page, data export and deletion

`/account` on the site (signed-in only) lets a person sign out everywhere, download their data and delete their account.
The API behind it is `GET /api/account`, `GET /api/account/export` and `DELETE /api/account` (`apps/api/src/app.ts`).

- These routes ask the database for the session instead of trusting the 1-minute cookie cache, so a deleted account or a
  revoked session stops working at once.
- The export lists the account, the settings and the sign-ins (time, IP, browser) and never any token.
- Deleting needs the email typed again, and it is a request first: `DELETE /api/account` answers `202 { scheduledFor }` and the account stays for
  14 days (`DELETION_COOLING_OFF_DAYS` in `packages/shared/src/deletion.ts`). The person gets an email (sent with `waitUntil`) with a link to
  `/account/cancel-deletion?token=...`. Asking again keeps the first date and sends no second email. `GET /api/account` shows
  `deletionScheduledFor`, and `POST /api/account/deletion/cancel` (signed in) or `POST /api/account/deletion/cancel-with-token` (no sign-in) keeps the account.
- The emailed link opens a page with a button; the cancel is a POST, so an email scanner that only opens links cannot cancel by accident.
  Only a SHA-256 hash of the token is stored (`account_deletion`), and a token works once.
- A daily cron (`triggers.crons` in `apps/api/wrangler.jsonc`, handled by `scheduled` in `apps/api/src/index.ts`) calls `deleteDueAccounts`,
  which removes up to 50 due users per run. Sessions, linked accounts, passkeys, settings, feedback and device names go with the user
  (`ON DELETE CASCADE`) and unused sign-in links are removed. The cron needs no extra setup on Cloudflare's free plan.
- **Email change.** `POST /api/account/email-change` ({ newEmail }) sends a link to the NEW address (it works for an hour, once; only a hash is stored in
  `email_change`). Nothing changes until the link's page sends the token to `POST /api/account/email-change/confirm` (no sign-in needed; a click is
  required, so link scanners cannot confirm). Then the account uses the new address and the old address gets a notice. The answer is the same for an
  address that is already taken (so addresses cannot be probed), asking again within a minute gives 429, and `pendingEmail` shows on the account and export.

- **Sign-in activity.** Every new session is recorded in `sign_in_event` (time, a readable browser and system label, IP address) by a Better Auth
  database hook in `auth.ts`, after the response. A sign-in from a browser and system the account has not used before (never the first sign-in of an
  account) also sends an alert email. `GET /api/account/sign-ins` lists the last 20, they appear in the export, and the daily cron prunes entries older
  than 90 days. The label is a rough match (`describeDevice`), so a browser update does not trigger alerts but a different browser or system does.

- **Data requests.** Exports and deletions are logged in `data_request` (kind, status `received`/`processing`/`done`/`cancelled`, received and due dates;
  the due date is 30 days after the request, `DATA_REQUEST_DEADLINE_DAYS`). An export is `done` at once; a deletion is `processing` during the cooling-off period, then
  `done` (or `cancelled`). `GET /api/account/requests` lists them, they show on the privacy page and in the export, and when the daily job deletes an account the person gets
  a last "your account was deleted" email. The table has **no link to the user and no email address** on purpose: the entry must outlive the account, so only a random id, the
  kind, the status and the dates remain. The daily job removes entries after a year.

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
