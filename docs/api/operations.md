# Running it: errors, email, backups and previews

The parts of the API you look after once it is live. Back to the [API overview](overview.md).

## Feature flags and the kill switch

`GET /api/flags?channel=stable|beta&id=<install id>` is public and needs no sign-in. It answers `{ "flags": { "key": true } }` for that
install. A flag is on when it is not killed, the channel matches (no channels means all), and the install falls inside `percent`
(a stable hash of the key and the install id, so raising the percentage only adds installs). Unknown flags are off, so code
must treat "absent" as off. The install id is random, made by the app or browser, and not stored by the server.

Change them with `pnpm flags list`, `pnpm flags set new-editor --percent 25 --channels beta`, `pnpm flags kill new-editor`,
`pnpm flags revive new-editor` and `pnpm flags delete new-editor` (local database; add `--remote` for the real one).
The kill switch beats everything and reaches running apps within about five minutes (the API caches for 60 seconds,
clients refresh every five). Use `useFlag('key')` in the desktop renderer or the web app.

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

## Security contact file (security.txt)

`apps/web/public/.well-known/security.txt` tells people where to report a vulnerability (RFC 9116). It needs a `Contact` and an `Expires` date, and `Expires` may be at most a year away, so renew it before the date passes: edit the date in that file and merge the change. A test (`apps/web/src/securityTxt.test.ts`) checks that both fields are there and the date is valid (it does not fail when the date has passed, so put a reminder in your calendar). The list on the `/sub-processors` page is `SUBPROCESSORS` in `apps/web/src/config.ts`; keep it in step with the accounts you really use.
