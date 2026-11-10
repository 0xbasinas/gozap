# Contributing

Thanks for helping out! This project uses **pnpm** and Node 24.

## Setup

```bash
pnpm install
pnpm dev
```

## Before opening a PR

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:scripts   # if you touched scripts/
```

CI runs the same checks, plus a full installer build on all three systems. Please keep PRs focused, add or update tests for behavior changes, and describe what changed and why.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, with a lowercase subject, for example `feat(updater): add beta channel` or `fix: window opens off-screen`. Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`. Add `!` (`feat!:`) or a `BREAKING CHANGE:` footer for breaking changes.

A git hook checks your message when you commit, and CI checks every commit in a pull request. The release notes are built from these messages.

## Pull requests and releases

`main` is protected: no direct pushes (admins included). Open a pull request from a branch; the PR **title** must be a
Conventional Commit, because squash merging uses it as the commit message. Turn on auto-merge (`gh pr merge --auto --squash`)
and it merges when every required check passes.

A merge that changes the app (`apps/desktop/src/`, `apps/desktop/build/`, `apps/desktop/resources/`, `apps/desktop/package.json`, the lockfile or build config) publishes a
release (`<major>.<minor>.<commit count>`), first to 10% of users and then more as it proves healthy. So only merge
changes that are ready to ship. Docs, tests, scripts and CI changes don't release.

Changes under `apps/web`, `apps/api` and `packages/` deploy the website and API (after setup, see [docs/guides/setup-cloud.md](docs/guides/setup-cloud.md));
packages are also bundled into the desktop app, so a change there can publish a desktop release too.

Using an AI coding agent? Point it at [AGENTS.md](AGENTS.md).

## Reporting bugs and ideas

Use the issue templates. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
