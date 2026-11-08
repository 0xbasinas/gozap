# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Copilot, Cursor, and similar) working in this repo.
Humans: see [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Keep this file short and true; if
you change how something works, change the matching line here.

## What this is

A template for Electron desktop apps: Electron + Vite (electron-vite) + React 19 + TypeScript, Tailwind v4 +
shadcn/ui, `electron-updater`, Vitest, Playwright, and GitHub Actions that test, package, sign off and publish releases.
Package manager is **pnpm** (never npm or yarn). Node 24. Run commands from the repo root.

## Commands

| Task                                     | Command                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Install                                  | `pnpm install`                                                                         |
| Run in development                       | `pnpm dev`                                                                             |
| Format / lint / typecheck                | `pnpm format` / `pnpm lint` / `pnpm typecheck`                                         |
| Unit tests (src, scripts)                | `pnpm test` (and `pnpm test:scripts` for the root `scripts/` folder)                   |
| Fill the local database with fake people | `pnpm seed:dev [--users N]` (local D1 only; never touches the real database)           |
| Set up website + API accounts            | `pnpm setup:cloud` (interactive; needs the user's own Cloudflare/Resend accounts)      |
| Update an app from the template          | `pnpm template:update` (apps made from the template only; opens a PR; `--adopt` first) |
| Check the cloud setup                    | `pnpm cloud:doctor` (read-only; safe to run, never prints secret values)               |
| Build the app                            | `pnpm build` (typechecks first)                                                        |
| Bundle size budget                       | `pnpm check:bundle` (after `pnpm build`)                                               |
| Package unpacked app                     | `pnpm build:unpack`                                                                    |
| End-to-end tests (packaged app)          | `pnpm build:unpack && pnpm test:e2e`                                                   |
| Update test (old build updates new)      | `pnpm test:update` (builds installers; needs a working NSIS/AppImage toolchain)        |
| Check installers vs update manifest      | `pnpm build:win` (or `:mac`, `:linux`) `--publish never` then `pnpm check:release`     |

Before saying a change is done, run at least: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`. For
anything touching main, preload, the window or IPC, also `pnpm build:unpack && pnpm test:e2e`.

## Workflow rules (important)

- **`main` is protected and admins are included.** You cannot push to `main`. Work on a branch, push it, open a pull
  request, and turn on auto-merge: `gh pr merge --auto --squash`. Squash is the only merge method.
- **The PR title becomes the commit message** and must be a Conventional Commit: `feat: ...`, `fix(ui): ...`,
  `chore: ...`, `ci: ...`, `docs: ...`. A check enforces it. Release notes are built from these.
- Required checks must pass: lint/types/tests/bundle, smoke test (3 OSes), update test (Ubuntu, Windows), package dry
  run (3 OSes), dependency audit, CodeQL. Do not weaken, skip or delete a check to get green; fix the cause.
- Merging a change under `apps/desktop/src/`, `apps/desktop/build/`, `apps/desktop/resources/`, `apps/desktop/package.json`, the lockfile or the build config **publishes a
  release** (10% rollout at first). Docs, tests, scripts and CI-only changes do not. So only merge what is ready to ship.
- Commit trailers: end commits with the `Co-Authored-By` line your environment gives you. Never skip hooks.
- Do not commit generated folders: `dist/`, `dist-update/`, `out/`, `test-results/`.
- Dependabot opens grouped PRs; patch and minor ones merge themselves. Do not hand-edit `pnpm-lock.yaml`.

## Where things live

This is a **pnpm + Turborepo monorepo**. Apps are in `apps/`, shared code in `packages/`. Add UI that more than one app needs to `packages/ui` and export it from `src/index.ts`.

```
apps/desktop/             The Electron app (its own package.json, electron-builder.yml, tests, scripts).
  src/main/               Electron main process (Node). index.ts is the entry.
  src/preload/            api.ts = everything the page may call (contextBridge). Sandboxed: import only `electron` + shared code.
  src/renderer/           React app. main.tsx routes `#settings` to the Settings window, anything else to App.
  src/shared/             ipc.ts (channels + types), validate.ts (payload checks). Imported by all three processes.
  scripts/                Node scripts (release notes, rollout, manifest checks). scripts/lib/*.mjs are pure and unit tested.
  tests/e2e/              Playwright against the packaged app.   tests/update/  old-to-new update test.
apps/web/                 Vite + React SPA: marketing site (/), download page (/download, reads the latest GitHub release), web app (/app/*).
                          public/_headers sets the CSP and security headers (served by the Worker, see apps/api/wrangler.jsonc).
apps/api/                 Hono API on Cloudflare Workers + D1 (Drizzle) + Better Auth magic links (Resend). Also serves apps/web/dist. See docs/api.md.
packages/shared/          zod schemas shared by API, web and desktop.
packages/ui/               @repo/ui: shared React components (Button, cn) and the Tailwind theme (theme.css). Source-only; apps bundle it.
turbo.json                Task graph (build, typecheck, test). pnpm-workspace.yaml holds the workspace globs and the version catalog.
.github/                  Workflows. publish-stable / publish-beta call _publish.yml after ci.yml passes.
scripts/                  template-update.mjs (+ template-update-lib.mjs, pure and tested): `pnpm template:update`. setup-cloud.mjs (+ setup-cloud-lib.mjs, pure and tested with `node --test`): one-command Cloudflare/Resend/GitHub setup.
docs/                     template-updates.md (keeping an app in sync with the template), setup-cloud.md (that setup), api.md (API, database, sign-in), architecture.md (how the app works), releasing.md (releases, rollouts, rollbacks),
                          monorepo-and-web.md (how the repo is organised and the plan for web + API).
```

Monorepo rules: shared dependency versions live in the `catalog:` of `pnpm-workspace.yaml` (use `catalog:` in a package, not a
version). Root scripts (`pnpm dev`, `pnpm build:unpack`, `pnpm test:e2e` ...) forward to `apps/desktop`. Lint, format and
commit hooks run once at the root. Workspace packages used by the desktop app must be **devDependencies** so Vite bundles them;
only third-party runtime modules go in `dependencies` (electron-builder packages those).

## Rules for code

- **The renderer is untrusted.** Windows use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Never
  loosen these, never expose `ipcRenderer` or Node APIs to the page.
- **Adding an IPC call** (also in docs/architecture.md): add the channel and types to `apps/desktop/src/shared/ipc.ts`; handle it in
  main with `handle()` from `apps/desktop/src/main/secureIpc.ts` (never raw `ipcMain.handle`) and validate every argument with a
  function in `apps/desktop/src/shared/validate.ts` (with a test); expose one narrow function in `apps/desktop/src/preload/api.ts`; call
  `window.api.thing()` from React.
- **Adding a setting:** add it to `Settings` in `ipc.ts`, `readStored`/`getSettings` in `settings.ts`, the
  allow-list in `validate.ts`, a test, the e2e `getSettings` expectation, and the Settings window.
- The packaged UI is served from `app://renderer/` (`apps/desktop/src/main/appProtocol.ts`), not `file://`. Never load remote or `file://`
  content into a window, and keep `isTrustedUrl` strict.
- `apps/desktop/src/preload` must not import third-party packages (a sandboxed preload can only `require('electron')`).
- Keep the renderer small: `apps/desktop/bundle-budget.json` fails CI if JS/CSS grows past it. Raise it deliberately, not by accident.
- Prefer small pure functions with tests (see `apps/desktop/scripts/lib/` and `apps/desktop/src/shared/validate.ts`) over logic buried in workflows.
- Strings that show the app name come from `document.title`, `app.getName()` or `apps/desktop/electron-builder.yml`; do not hard-code
  "Electron Desktop Template" in new code. `pnpm rename` replaces the known occurrences for new apps.
- TypeScript is strict. No `any` without a reason. Explicit return types on exported functions (ESLint enforces it).
- Style is Prettier (no semicolons, single quotes). Run `pnpm format`; do not fight it.

## Website, API and sign-in

- Never put secrets in `apps/api/wrangler.jsonc` (it only holds `database_id`, `BETTER_AUTH_URL`, `EMAIL_FROM`, `TRUSTED_ORIGINS`, `routes` and the daily cron `triggers`).
  Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) are set in Cloudflare by `pnpm setup:cloud` or `wrangler secret put`.
  Do not run `pnpm setup:cloud` for the user: it needs their accounts and keys, so tell them to run it.
  `pnpm cloud:doctor` only reads, so run it when something about sign-in or deploys looks wrong. Pull request previews
  (`.github/workflows/preview.yml`) set `PREVIEW=true`, and the Worker then takes its address from the request: do not read
  `BETTER_AUTH_URL` directly in new code, use the value on `env` that the app already receives.
- Stay inside the free tiers (see docs/api.md): no password hashing, no work per request that reads many D1 rows, rate limit only
  sign-in, send email with `waitUntil`.
- Desktop sign-in is main-process only (`apps/desktop/src/main/auth.ts`). Do not use `@better-auth/electron`'s `setupMain`, do not give the
  renderer tokens, and check deep links with `authLink.ts` before using them. The Account section shows only when `API_URL` is set at build time.
- Change the database by editing `apps/api/src/db/schema.ts` then `pnpm --filter @repo/api db:generate`; auth tables come from
  `pnpm --filter @repo/api auth:schema`. Migrations run before the new code deploys, so keep them backward compatible.
- Per-person data that must follow them between devices goes through `/api/preferences` (last write wins, local copy first, best-effort sync):
  see `packages/shared/src/preferences.ts` and the theme in `apps/web/src/lib/theme.ts` and `apps/desktop/src/main/preferencesSync.ts`.
- Anything you store per person needs `ON DELETE CASCADE` on the user and a place in the account export (`apps/api/src/app.ts`).
- `apps/web/public/.well-known/security.txt` must be renewed before its `Expires` date (it is valid for at most a year, RFC 9116); the list on `/sub-processors` is `SUBPROCESSORS` in `apps/web/src/config.ts`: edit both to match the accounts you really use.
- Web and API deploy from `.github/workflows/deploy-web.yml` (off until `CLOUDFLARE_DEPLOY=true`); it never releases the desktop app.

## Release system in one paragraph

Version is `<major.minor from package.json>.<git commit count>`; beta adds `-beta`. Merge to `main` runs CI, then
`_publish.yml` builds Windows/macOS/Linux, publishes to GitHub Releases at 10%, attests provenance, adds
`SHA256SUMS.txt` and embeds release notes in the app. `rollout-guard.yml` (hourly) pauses a crashing release at 0% and
otherwise promotes it 25% -> 50% -> 100% over three days. `rollback-release.yml` and `set-rollout.yml` are manual.
Details: [docs/releasing.md](docs/releasing.md).

## Gotchas learned the hard way

- On Windows, files may have CRLF line endings: normalise before regex or string replacement (`.replaceAll('\r\n','\n')`).
- Compare file paths with `path.resolve`, never with `startsWith` on a path built with `/`.
- `pnpm run script -c.x=y` mangles `-c` flags. Set the version with `npm pkg set version=...`, or write a temp config file.
- The Vite/Rolldown renderer is only minified because `apps/desktop/electron.vite.config.ts` sets `minify: true`; keep it.
- `electron-vite` main/preload leave dependencies external, so main-process dependencies must be in `dependencies`.
- Releases switch Electron fuses and ASAR integrity on. Playwright needs `enableNodeCliInspectArguments`, so only test builds
  (`pnpm build:unpack`, the update test) turn it on. Never weaken `electronFuses` in `apps/desktop/electron-builder.yml` for a release, and
  update `apps/desktop/scripts/lib/fuses.mjs` when you change it. If a Playwright launch times out, suspect that fuse.
- macOS auto-update needs code signing, which is not set up; the update test therefore skips macOS.
- GitHub takes a minute to recompute mergeability after a push or a branch-protection change; "blocked" can be stale.
- `makensis` can fail to spawn on some local Node versions (`ENOTCONN`); CI is the reference for installer builds.
- A merge made with `GITHUB_TOKEN` (the "Turn on auto-merge" job does this) starts no workflows by itself. `.github/workflows/catch-up.yml`
  runs every 15 minutes and covers for it: it starts "Publish stable release" / "Deploy web and API" when a commit should have
  started them and nothing did, and deletes merged branches. So a bot-merged release can be up to ~25 minutes late; start it sooner
  with Actions > Catch up > Run workflow. Logic: `scripts/catch-up.mjs` (+ `catch-up-lib.mjs`, tested). `pnpm`-free: `node scripts/catch-up.mjs --dry-run`.
- Do not run long waits as foreground `sleep`; use the background-task or watch mechanisms your tool provides.

## Do not

- Push to `main`, force-push, or bypass branch protection.
- Add secrets, tokens or personal data to the repo, workflow logs or PR text. Crash reporting is opt-in and off without a DSN.
- Enable auto-merge on a PR that has failing checks, or merge major dependency updates (Electron especially) without testing.
- Add a dependency for something small. Check bundle size and `pnpm audit` first.
- Edit generated files by hand: `pnpm-lock.yaml`, `apps/desktop/build/icon.*` (run `pnpm icons`), `out/`, `dist/`.
