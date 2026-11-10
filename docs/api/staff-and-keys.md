# Staff, API keys and the audit trail

What the people who run the app can see and do, and how scripts sign in: the security activity list, staff roles and the admin page, and API keys.

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
