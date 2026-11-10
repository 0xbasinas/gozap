# Accounts, data and preferences

What a person can do with their account: send feedback, export or delete their data, and keep preferences in step across devices. Back to the [API overview](overview.md).

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
- **When you add your own tables**, give them `userId ... references user.id ON DELETE CASCADE`, and add their rows to the export
  in `app.ts`, so deletion and export stay complete. The tests in `apps/api/test/api.test.ts` ("account") show how to check it.

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

## Consent ledger

`consent` is an append-only list of what a person agreed to or withdrew: purpose, granted, the policy version (`POLICY_VERSION` in
`packages/shared/src/consents.ts`) and the time. `GET /api/account/consents` returns the latest answer per purpose and the
history; `POST` with `{ purpose, granted }` adds an entry (repeating the current answer adds nothing; withdrawing something never
agreed to is ignored). Entries are never edited, go when the account is deleted, and are in the account export. To ask for a new
thing, add it to `CONSENT_PURPOSES` and `CONSENT_LABELS`; bump `POLICY_VERSION` when the policy text changes. The privacy page
shows "Your agreements". Nothing here is needed to sign in.
