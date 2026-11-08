# Electron Desktop Template

[![CI](https://github.com/0xbasinas/electron-desktop-template/actions/workflows/ci.yml/badge.svg)](https://github.com/0xbasinas/electron-desktop-template/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/0xbasinas/electron-desktop-template)](https://github.com/0xbasinas/electron-desktop-template/releases/latest)
[![CodeQL](https://github.com/0xbasinas/electron-desktop-template/actions/workflows/codeql.yml/badge.svg)](https://github.com/0xbasinas/electron-desktop-template/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/0xbasinas/electron-desktop-template/badge)](https://scorecard.dev/viewer/?uri=github.com/0xbasinas/electron-desktop-template)
[![License: MIT](https://img.shields.io/github/license/0xbasinas/electron-desktop-template)](LICENSE)

Electron + Vite + React + TypeScript, with Tailwind CSS v4, shadcn/ui, auto-updates, tests and CI/release workflows. Uses **pnpm**.

It is a **monorepo** (pnpm workspaces + Turborepo):

| Folder            | What it is                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/desktop`    | The Electron app. Released to GitHub Releases with staged rollouts.                                        |
| `apps/web`        | Vite + React site: landing page, download page, sign-in and the app at `/app`.                             |
| `apps/api`        | Hono API on Cloudflare Workers with D1 (Drizzle) and Better Auth magic-link sign-in; also serves the site. |
| `packages/ui`     | Shared components and the Tailwind theme.                                                                  |
| `packages/shared` | zod schemas and the typed API client shared by web, desktop and API.                                       |
| `scripts/`        | `setup-cloud.mjs`, the one-command Cloudflare + Resend + GitHub setup.                                     |

Start with the desktop app (`pnpm dev`). The website, API and account sign-in are optional: see [Website and API](#website-and-api).

## Scripts

| Command                                        | What it does                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Run the app with HMR                                                                                      |
| `pnpm build`                                   | Typecheck and build                                                                                       |
| `pnpm build:win` / `build:mac` / `build:linux` | Package installers                                                                                        |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | Code quality                                                                                              |
| `pnpm test:e2e`                                | Playwright smoke test against the packaged app (run `pnpm build:unpack` first)                            |
| `pnpm test`                                    | Vitest (jsdom)                                                                                            |
| `pnpm check:release`                           | After `pnpm build:<os> --publish never`: check the installers against the update manifest                 |
| `pnpm check:fuses`                             | Check the Electron fuses of the packaged app (`--test-build` for the Playwright build)                    |
| `pnpm test:update`                             | Build 0.0.1 and 0.0.2, check the old one updates to the new one                                           |
| `pnpm icons`                                   | Regenerate app icons from `apps/desktop/build/icon-source.svg`                                            |
| `pnpm check:bundle`                            | Fail if the renderer bundle exceeds `apps/desktop/bundle-budget.json` (run after `pnpm build`)            |
| `pnpm rename`                                  | Rename the template for a new app                                                                         |
| `pnpm dev:all`                                 | Run every app that has a dev server (desktop, web, API) through Turborepo                                 |
| `pnpm setup:cloud`                             | Set up Cloudflare, Resend and GitHub for the website and API in one go (docs/setup-cloud.md)              |
| `pnpm template:update`                         | Bring the template's newer changes into an app made from it, as a pull request (docs/template-updates.md) |
| `pnpm template:status`                         | How far behind the template this app is                                                                   |
| `pnpm cloud:doctor`                            | Check the whole cloud setup and say what is wrong and how to fix it                                       |
| `pnpm test:scripts`                            | Unit tests for the setup script (`node --test`)                                                           |

## Website and API

`apps/web` and `apps/api` deploy as **one Cloudflare Worker**: the API under `/api/*`, the built site as static assets, one origin
(so the session cookie is first-party and there is no CORS). Sign-in is by emailed magic link (Better Auth + Resend), on the web and in
the desktop app, which signs in through the system browser and returns through its deep link. It is built to stay inside the free tiers
(no passwords, cached sessions, rate limits only on sign-in).

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars   # local secret
pnpm --filter @repo/web build && pnpm --filter @repo/api db:migrate:local
pnpm --filter @repo/api dev                         # http://localhost:8787 (sign-in links print in the terminal)
pnpm setup:cloud                                    # when you are ready to deploy: Cloudflare + Resend + GitHub
```

Guides: [docs/setup-cloud.md](docs/setup-cloud.md) (one-command setup, options, manual steps), [docs/api.md](docs/api.md) (API, database,
sign-in, free-tier notes, security), [docs/monorepo-and-web.md](docs/monorepo-and-web.md) (how the parts connect).

## Auto-update

`apps/desktop/src/main/updater.ts` uses `electron-updater` against GitHub Releases (`publish` in `apps/desktop/electron-builder.yml`). Only packaged builds check for updates.

- **Publish stable release** (`publish-stable.yml`): a push to `main` that changes the app runs CI, then builds Windows, macOS and Linux and publishes `v0.0.7 (a1b2c3d)`.
- **Publish beta pre-release** (`publish-beta.yml`): the same for the `beta` branch, published as a pre-release for people on the beta channel. Users switch channels in the app.
- Only changes to `apps/desktop/src/` (not tests), `apps/desktop/build/`, `apps/desktop/resources/`, `apps/desktop/package.json`, the lockfile and the build config publish. CI, docs and test changes don't. A failing CI blocks the publish.
- The version is `<major>.<minor>.<commit count>`: `major.minor` come from `apps/desktop/package.json`, so it grows on its own. Edit `apps/desktop/package.json` to move to `0.1.x` or `1.0.x`.
- New stable releases go to 10% of users first, then 25%, 50% and 100% over three days while the rollout guard sees healthy crash data. Pause, raise or roll back by hand from the Actions tab (see [docs/releasing.md](docs/releasing.md)).
- Every pull request builds the real installers on all three systems and checks them against the update manifest, so packaging problems fail before the merge.
- Release notes are generated from Conventional Commit messages (`feat:`, `fix:`, ...), grouped by type.
- Updates are differential (blockmaps), and every release has `SHA256SUMS.txt` plus GitHub build-provenance attestations.
- The repo is public, so installed apps can read releases without a token. If you make it private again, add `private: true` to `publish` in `apps/desktop/electron-builder.yml` and give installed apps a `GH_TOKEN`.
- macOS auto-update requires code signing and notarization (not configured here).

Details: [docs/releasing.md](docs/releasing.md). How the app is put together: [docs/architecture.md](docs/architecture.md). How the monorepo and the web/API plan fit together: [docs/monorepo-and-web.md](docs/monorepo-and-web.md). Website and API setup: [docs/setup-cloud.md](docs/setup-cloud.md).

## Security, settings and logs

Renderers are sandboxed, Electron fuses and ASAR integrity are on in releases (the app refuses to start if its code was tampered with), IPC calls are checked for who sent them and what they contain, and logs go to a file (Help > Show Log File). A Settings window (`Ctrl/Cmd+,`) holds the update channel, tray and launch-at-login options. After an update the app shows the release notes once, and a welcome screen on first run. Dependabot keeps dependencies current.

## Menu, tray and shortcuts

A native application menu, a system tray icon (click to show or hide) and a global shortcut, `Ctrl/Cmd+Shift+Space`, to show or hide the window from anywhere. The tray menu can keep the app running when you close the window (off by default). See [docs/architecture.md](docs/architecture.md).

## Icons and logo

Edit or replace `apps/desktop/build/icon-source.svg` (square, ideally 1024x1024), then run `pnpm icons` to regenerate `apps/desktop/build/icon.png`, `.ico`, `.icns` and `apps/desktop/resources/icon.png`. The in-app logo is `apps/desktop/src/renderer/src/assets/logo.png`.

## Deep links and file types

The app registers the `electron-desktop-template://` URL scheme and the `.tpl` file type (see `apps/desktop/src/main/deeplink.ts` and `apps/desktop/electron-builder.yml`). Change the extension in both places for your app.

## shadcn/ui

`components.json` is set up with the `@renderer` alias. Add components with `pnpm dlx shadcn@latest add <component>`.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(ui): add banner`, `fix: crash on start`). A git hook (husky + commitlint) checks them locally and CI checks pull requests. This is what drives the grouped release notes.

## Working with AI agents

[AGENTS.md](AGENTS.md) tells coding agents the commands, the pull-request rules (`main` is protected, PR titles are Conventional Commits, auto-merge), where code lives, the security rules for IPC, and the gotchas we hit. `CLAUDE.md` and `.github/copilot-instructions.md` point to it.

## Using this template

Click **Use this template** on GitHub, clone your new repo, then rename everything in one go:

```bash
pnpm rename my-cool-app --owner your-github-user --title "My Cool App"
```

This updates `apps/desktop/package.json`, `apps/desktop/electron-builder.yml` (app id, product name, publish target), the app user model id, the deep-link scheme (also in the web app and the Worker's trusted origin), the window title, the README title and the license holder. `--owner` and `--title` are optional. Review `git diff` afterwards.
