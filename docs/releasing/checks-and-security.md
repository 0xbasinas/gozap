# Release checks and security

The checks a release goes through before and after it is published, and how to verify a download. Back to [releasing](overview.md).

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

Releases are built with Electron fuses (see "Security model" in [the architecture guide](../desktop/security.md)). CI verifies them twice:

- the release dry run builds the real installers and runs `pnpm check:fuses`, which fails unless the packaged app has the
  hardened settings (inspector flags off, ASAR integrity on, `runAsNode` off, ...);
- the smoke test job runs `node apps/desktop/scripts/check-fuses.mjs --test-build` on the unpacked build used for Playwright.

Playwright needs the Node inspector flags, so `pnpm build:unpack` and the update test turn that one fuse on (and only for those
test builds). Never publish those builds. If Playwright cannot launch the app and times out, check that fuse first.

## Security checks

- **CodeQL** scans the app code and the workflows on every pull request, on `main` and weekly.
- **Dependency audit** (`pnpm audit`, high severity and above) is a required check on pull requests, and also runs daily; a failure
  opens an issue, because advisories appear without any change to the repo.
- **OpenSSF Scorecard** runs weekly and on `main`; the badge in the README shows the score.

## Verifying a download

Each release includes `SHA256SUMS.txt` and signed build-provenance attestations.

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
gh attestation verify <downloaded-file> --repo 0xbasinas/electron-desktop-template
```

The attestation proves the file was built by this repo's workflow from the tagged commit.

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

## What's new

The release notes (grouped from Conventional Commits) are written to `apps/desktop/build/release-notes.md` during the
release build and shipped inside the app as `apps/desktop/resources/release-notes.md`. After an update, the app shows them
once; on first launch it shows a short welcome instead. Users can reopen them from Help > What's New.

## Account sign-in in release builds

To show **Settings > Account** (sign in through the browser), the build needs the address of your deployed API. Add the
repository **variable** (not a secret; it is a public address) `API_URL`, for example `https://app.example.com`.
`_publish.yml` passes it to the build. `pnpm setup:cloud` sets it for you (see [the setup guide](../guides/setup-cloud.md)). Without
it the Account section is hidden. Desktop releases are separate from website and API deploys.
