# Releasing

Releases are automatic. You never create a tag or edit a version by hand.

| Workflow                 | File                 | When it runs                                                             |
| ------------------------ | -------------------- | ------------------------------------------------------------------------ |
| Publish stable release   | `publish-stable.yml` | Push to `main` that changes the app                                      |
| Publish beta pre-release | `publish-beta.yml`   | Push to `beta` that changes the app                                      |
| CI                       | `ci.yml`             | Pull requests, other pushes, and as a gate inside both publish workflows |

Both publish workflows run the same steps (`_publish.yml`): CI gate, version, build on Windows, macOS and Linux, attest, release notes and checksums.

**The CI gate.** Each publish workflow calls CI first and only publishes if it passes: lint, types, unit tests, bundle size, and a smoke test that launches the packaged app on all three operating systems.

**Path filter.** A push only publishes if it changes `apps/desktop/src/` (not `*.test.ts(x)`), `apps/desktop/build/`, `apps/desktop/resources/`, `apps/desktop/package.json`, `pnpm-lock.yaml`, `apps/desktop/electron-builder.yml` or `apps/desktop/electron.vite.config.ts`. Anything else (docs, tests, CI) is checked by CI but does not ship a build.

**Release notes.** `apps/desktop/scripts/release-notes.mjs` groups the commits since the previous release by Conventional Commit type (Breaking changes, Features, Bug fixes, Performance, ...). Preview them locally with `pnpm release-notes v0.0.7 stable`.

## Channels

| Branch | Channel           | Release type   | Version example |
| ------ | ----------------- | -------------- | --------------- |
| `main` | stable (`latest`) | normal release | `0.0.12`        |
| `beta` | `beta`            | pre-release    | `0.0.15-beta`   |

- Version = `<major>.<minor>.<commit count>`. `major.minor` come from `apps/desktop/package.json` (start: `0.0.0`),
  and the patch is the commit count of the pushed branch. Edit `apps/desktop/package.json` to move to `0.1.x` or `1.0.x`.
- Pushing to `beta` publishes a GitHub pre-release. Pushing to `main` publishes a stable release.

To start a beta line, create the branch once and push work to it:

```bash
git push origin main:beta
```

Promote a beta by merging `beta` into `main`.

## What users get

Each install follows one channel, stored in its settings file (`updateChannel`) and switchable from the app
(Settings window, "Update channel").

- **Stable users** only ever see normal releases.
- **Beta users** see pre-releases too, and move to the next stable release once its version is higher.
  Switching a beta install back to stable does not downgrade it; it waits for the next stable build.

## Staged rollouts

A stable release is first offered to a share of users (`rollout` in `publish-stable.yml`, 10% by default).
This works through `stagingPercentage` in the update manifests (`latest*.yml`): each install has a stable
random number and only takes the update if that number falls inside the percentage.

1. Publish. About 10% of installs are offered the new version.
2. **Automatic promotion:** `rollout-guard.yml` runs hourly and raises the newest stable release on a schedule while it
   looks healthy: 25% after 1 day, 50% after 2, 100% after 3 (`apps/desktop/scripts/lib/promote.mjs`). "Healthy" means the guard
   (below) saw enough crash data and found nothing wrong. With no crash data nothing is promoted on its own; set the
   repository variable `AUTO_PROMOTE_WITHOUT_CRASH_DATA` to `true` to let age alone decide.
3. **By hand:** run **Actions > Set release rollout** with the tag (for example `v0.1.42`) and a percentage, up to
   `100` for everyone. Raising it never takes the update away from anyone.
4. Looks bad: the guard sets it to `0`, or you do. Automatic promotion never touches a release at 0%, so a paused
   release stays paused until you raise it. Then ship a fix, or run **Rollback release**.

Beta releases are always offered to everyone on the beta channel. Set `rollout: 100` in `publish-stable.yml`
if you don't want staged rollouts. The logic lives in `apps/desktop/scripts/lib/rollout.mjs` and is unit tested.

## Release dry run

Every pull request builds the real installers on Windows, macOS and Linux (`electron-builder --publish never`) and runs
`pnpm check:release` (`apps/desktop/scripts/check-release-artifacts.mjs`). It fails when:

- the update manifest (`latest.yml`, `latest-mac.yml` or `latest-linux.yml`) is missing or has a different version than the app;
- a file the manifest lists is missing, or its size or sha512 differs;
- a Windows installer or macOS zip/dmg has no `.blockmap` (updates would not be differential; AppImages have none);
- the packaged app lacks `app-update.yml`, `release-notes.md` or `app.asar`;
- the fresh manifest already carries a rollout percentage (only the publish step adds that).

This is the same build the release runs, so packaging problems show up on the pull request instead of after the merge.
It stops short of publishing, signing or installing the result; `pnpm test:update` covers the update flow itself.

## Fuses and ASAR integrity

Releases are built with Electron fuses (see "Security model" in [architecture.md](architecture.md)). CI verifies them twice:

- the release dry run builds the real installers and runs `pnpm check:fuses`, which fails unless the packaged app has the
  hardened settings (inspector flags off, ASAR integrity on, `runAsNode` off, ...);
- the smoke test job runs `node apps/desktop/scripts/check-fuses.mjs --test-build` on the unpacked build used for Playwright.

Playwright needs the Node inspector flags, so `pnpm build:unpack` and the update test turn that one fuse on (and only for those
test builds). Never publish those builds. If Playwright cannot launch the app and times out, check that fuse first.

## Rolling back

**Actions > Rollback release** takes the bad tag (and optionally the release to promote instead):

1. the bad release's rollout goes to 0% and the release becomes a draft, so the updater and download page stop showing it;
2. the previous release of the same kind (stable or pre-release) is marked latest and set to 100%;
3. an issue is opened so the follow-up is not forgotten.

Installs that already updated keep the bad version, because updaters never downgrade. To fix them, revert the
change in a pull request and merge it: that publishes a higher version.

## Automatic pause on crashes (the guard)

`rollout-guard.yml` runs every hour. For the newest stable release (under 7 days old) it asks Sentry for the
crash-free session rate. It sets the rollout to 0% and opens an issue when the rate is below 98%, or more than 2 points
worse than the previous release, once there are at least 20 sessions. Tune this in `apps/desktop/scripts/lib/guard.mjs`.

It needs crash reports, which are opt-in for users and off until you configure them:

1. Create a Sentry project (Electron platform).
2. Add repository secrets: `SENTRY_DSN` (baked into release builds; with no DSN the app has no crash reporting and Settings
   hides the switch), and for the guard `SENTRY_AUTH_TOKEN` (org:read, project:read), `SENTRY_ORG` (slug), `SENTRY_PROJECT` (numeric id).
3. Users turn on **Settings > Send anonymous crash reports**. Reports carry the version and channel, not name or IP.

Without the secrets the guard does nothing. The decision logic is unit tested, but the Sentry request has only been
checked against Sentry's documented response shape, so watch the first run (Actions > Rollout guard > Run workflow).

## Security checks

- **CodeQL** scans the app code and the workflows on every pull request, on `main` and weekly.
- **Dependency audit** (`pnpm audit`, high severity and above) is a required check on pull requests, and also runs daily; a failure
  opens an issue, because advisories appear without any change to the repo.
- **OpenSSF Scorecard** runs weekly and on `main`; the badge in the README shows the score.

## What's new

The release notes (grouped from Conventional Commits) are written to `apps/desktop/build/release-notes.md` during the
release build and shipped inside the app as `apps/desktop/resources/release-notes.md`. After an update, the app shows them
once; on first launch it shows a short welcome instead. Users can reopen them from Help > What's New.

## Testing updates

`pnpm test:update` (also run in CI on Linux and Windows) builds version 0.0.1 and 0.0.2 of the real packaged
app with a local feed, starts the old one and checks that it finds, downloads and reports the new one, and
that a release staged at 0% is not offered. It catches broken packaging, a missing `app-update.yml` and
updater wiring mistakes. It stops after the download: installing and relaunching, and macOS (which needs a
signed build), are not covered.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens weekly PRs: one for Electron and its tooling, one for other minor and
patch updates, one for GitHub Actions. CI runs on every one, and the commit messages follow Conventional Commits.

## Smaller updates

Every build ships `.blockmap` files, and `electron-updater` uses them for differential downloads, so users
only download the parts that changed. macOS ships both `.dmg` (first install) and `.zip` (what updates use).

## Verifying a download

Each release includes `SHA256SUMS.txt` and signed build-provenance attestations.

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
gh attestation verify <downloaded-file> --repo 0xbasinas/electron-desktop-template
```

The attestation proves the file was built by this repo's workflow from the tagged commit.

## Limits to know about

- macOS and Windows installers are not code-signed yet. macOS auto-update needs signing and notarization.
- The bundle size budget (`apps/desktop/bundle-budget.json`) is checked in CI. Raise it on purpose, not by accident.

## Account sign-in in release builds

To show **Settings > Account** (sign in through the browser), the build needs the address of your deployed API. Add the
repository **variable** (not a secret; it is a public address) `API_URL`, for example `https://app.example.com`.
`_publish.yml` passes it to the build. `pnpm setup:cloud` sets it for you (see [setup-cloud.md](setup-cloud.md)). Without
it the Account section is hidden. Desktop releases are separate from website and API deploys.
