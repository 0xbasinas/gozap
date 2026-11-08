# Setting up the website and API (Cloudflare, Resend, GitHub)

One command does the account setup that would otherwise be about a dozen manual steps:

```bash
pnpm setup:cloud
```

It talks to each service through its own CLI or API, asks for what it cannot find out itself, and is **safe to run again**:
every step looks at what already exists first, so a second run changes nothing that is already right.

## Before you start

You need accounts (free plans are enough) and three small things only you can provide:

| What                                           | Why                                                 | Where to get it                                                                     |
| ---------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A Cloudflare account                           | Hosts the Worker (site + API) and the D1 database   | <https://dash.cloudflare.com/sign-up>                                               |
| A domain you control                           | Resend only sends from a domain you have verified   | Any registrar. If it is on Cloudflare DNS, the script adds the DNS records for you. |
| A Resend account and a **full-access** API key | Lets the script add the domain and create a new key | <https://resend.com/api-keys>                                                       |

Optional, for the GitHub step: the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`), and a Cloudflare API
token for CI (see [Automatic deploys](#automatic-deploys-and-release-builds)).

The full-access Resend key is typed into the prompt (hidden), used for the setup and **never stored**. It can also be
passed as `RESEND_SETUP_KEY` in the environment. The Worker gets a different key that can only send mail from your domain.

## What it does, in order

1. **Cloudflare sign-in.** Runs `wrangler whoami`; if you are not signed in it opens `wrangler login` in your browser.
2. **Site address.** Asks for the public address (`https://app.example.com`). On your own domain the script also writes
   the Worker route (`custom_domain`), and Cloudflare creates the certificate. The domain's zone must be in the same account.
3. **Databases.** `wrangler d1 create` (or finds the existing one) and writes its `database_id` into `apps/api/wrangler.jsonc`.
   It also creates a second, separate staging database (`<name>-preview`) for pull request previews and writes its id into
   `wrangler.jsonc` and `wrangler.preview-migrations.jsonc`.
4. **Email.** Adds your sending domain to Resend through the Resend API, adds the DNS records it asks for through the
   Cloudflare DNS API (needs `CLOUDFLARE_API_TOKEN` with _Zone → DNS → Edit_; otherwise it prints them for you to add),
   asks Resend to verify, and waits until the domain is verified.
5. **Settings.** Writes `BETTER_AUTH_URL`, `EMAIL_FROM` and the route into `wrangler.jsonc` (comments are kept). No secrets
   are written there.
6. **Secrets.** Generates `BETTER_AUTH_SECRET` and creates the sending-only Resend key. They are uploaded with the deploy
   (`wrangler deploy --secrets-file`, from a temporary file that is deleted right after) and never printed.
   An existing `BETTER_AUTH_SECRET` is kept, because changing it signs everybody out (`--rotate-secret` does it on purpose).
7. **Deploy.** Builds the site, applies the D1 migrations to the remote database, then deploys the Worker.
   In the same step it adds a starter DMARC record, creates the Resend webhook for bounces and complaints, and (if `SENTRY_DSN`
   is in the environment) stores the Sentry DSN. See "Email deliverability" and "Error reporting" in [api.md](api.md).
8. **GitHub.** Sets the repository variable `API_URL` (so release builds of the desktop app know where to sign in) and,
   when `CLOUDFLARE_API_TOKEN` is set, the secrets and variable that switch on automatic deploys, per-pull-request previews and
   the daily database backup. It also creates `BACKUP_PASSPHRASE` (the key that encrypts the backups) and **shows it once**:
   save it in your password manager, because without it a backup cannot be opened.

## Options

```bash
pnpm setup:cloud --url https://app.example.com --email-domain example.com --from-name "My App"
pnpm setup:cloud --yes              # no questions: take the recommended answer everywhere
pnpm setup:cloud --skip-resend      # no email yet: sign-in links are printed in the Worker logs
pnpm setup:cloud --skip-deploy      # only prepare the settings and secrets
pnpm setup:cloud --skip-github      # leave the repository settings alone
pnpm setup:cloud --rotate-secret    # new BETTER_AUTH_SECRET (everyone is signed out)
```

## Automatic deploys and release builds

After the first deploy, `.github/workflows/deploy-web.yml` deploys on every merge to `main` that changes `apps/web`,
`apps/api` or `packages/`. It needs a token that can edit Workers and D1, which Cloudflare only lets you create yourself:

1. Open <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → template **Edit Cloudflare Workers**, then add
   the permission **Account → D1 → Edit**. Limit it to your account.
2. Run `CLOUDFLARE_API_TOKEN=<the token> pnpm setup:cloud --skip-resend --skip-deploy` (PowerShell:
   `$env:CLOUDFLARE_API_TOKEN="<the token>"; pnpm setup:cloud --skip-resend --skip-deploy`). The script stores it as a GitHub
   secret together with `CLOUDFLARE_ACCOUNT_ID` and turns on the variable `CLOUDFLARE_DEPLOY=true`.

The same token (with _Zone → DNS → Edit_ added) lets step 4 create the Resend DNS records in Cloudflare.

## Doing it by hand

Everything the script does can be done manually; this is also how to fix one step if it fails.

| Step            | Manual equivalent                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database        | `pnpm --filter @repo/api exec wrangler d1 create <name>`, then paste the id into `database_id`                                                             |
| Settings        | Edit `BETTER_AUTH_URL`, `EMAIL_FROM` and `routes` in `apps/api/wrangler.jsonc`                                                                             |
| Resend domain   | Resend dashboard → Domains → Add domain, add the DNS records, **Verify**                                                                                   |
| Secrets         | `pnpm --filter @repo/api exec wrangler secret put BETTER_AUTH_SECRET` and `... RESEND_API_KEY` (after the first deploy)                                    |
| Migrations      | `pnpm --filter @repo/api db:migrate:remote`                                                                                                                |
| Deploy          | `pnpm exec turbo run build --filter=@repo/web && pnpm --filter @repo/api exec wrangler deploy`                                                             |
| GitHub settings | Settings → Secrets and variables → Actions: variable `API_URL`, variable `CLOUDFLARE_DEPLOY=true`, secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

## Checking your setup

```bash
pnpm cloud:doctor
```

Reads your configuration, Cloudflare login and Worker secrets, the DNS records for email (SPF/DKIM/DMARC), the GitHub
variables and secrets, and calls `/api/health` on the deployed site. It prints what is wrong and the command that fixes it.
It never changes anything and never prints a secret value (only whether it exists). It exits with 1 only when something
that breaks sign-in is wrong; warnings (for example "no DMARC record yet") do not fail it.

## Previews and backups

With deploys on, every pull request that touches the website or API gets its own live copy, and the production database is
exported, restore-tested and encrypted every day. Both are explained in [api.md](api.md) ("Previews" and "Backups").

## Troubleshooting

- **"Resend rejected the key (401/403)"**: the key must have _Full access_. Sending-only keys cannot add domains.
- **Domain stays "pending"**: DNS can take minutes to hours. Fix the records the script printed, then run it again; it
  resumes at the verification step.
- **`wrangler login` cannot open a browser** (SSH, containers): create an API token as above and set
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` before running the script.
- **Custom domain error on deploy**: the domain's zone is not in the Cloudflare account you are signed in to. Add the zone
  first, or use the `*.workers.dev` address for now.
- **Start over**: delete the Worker and database in the Cloudflare dashboard, set `database_id` back to the all-zero
  placeholder, and run the script again.

## Skipping what you already did

The script asks before each optional part, so you can say no to anything you have done yourself: "Have you already added
Resend's DNS records yourself?" (it then goes straight to verification), the DMARC record, the Resend webhook, and the
staging database for previews. Without a terminal, or with `--yes`, it takes the recommended answer without asking.
