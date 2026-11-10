# Rollouts, pausing and rolling back

How a release reaches people in stages, and how it is paused or taken back. Back to [releasing](overview.md).

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

## Forcing an update (minimum version)

For a security fix you can make older apps stop working until they update. Set `MIN_APP_VERSION` in `apps/api/wrangler.jsonc` (for example
`"0.1.60"`), merge, and let the web and API deploy. The desktop app asks `GET /api/app-config` at start-up and every six hours
(`apps/desktop/src/main/minimumVersion.ts`); a version below the minimum gets a blocking "Update required" screen with an update button.

- It **fails open**: if the site cannot be reached, or the value is not a version, nobody is blocked. A typo cannot lock people out.
- Only packaged apps that were built with an `API_URL` check it; development builds never do.
- Release the fixed version first and wait for the rollout to reach most people, or the people still on the staged 10% will see an update that is not offered to
  them yet. Leave the value empty to turn it off again.
- Pre-release suffixes are ignored (`0.1.60-beta` counts as `0.1.60`).

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

## Rolling back

**Actions > Rollback release** takes the bad tag (and optionally the release to promote instead):

1. the bad release's rollout goes to 0% and the release becomes a draft, so the updater and download page stop showing it;
2. the previous release of the same kind (stable or pre-release) is marked latest and set to 100%;
3. an issue is opened so the follow-up is not forgotten.

Installs that already updated keep the bad version, because updaters never downgrade. To fix them, revert the
change in a pull request and merge it: that publishes a higher version.

## Limits to know about

- macOS and Windows installers are not code-signed yet. macOS auto-update needs signing and notarization.
- The bundle size budget (`apps/desktop/bundle-budget.json`) is checked in CI. Raise it on purpose, not by accident.

## When a merge does not start a release

Pull requests from the repo owner turn on auto-merge with the workflow token (`GITHUB_TOKEN`). GitHub starts **no workflows** for
anything done with that token, so such a merge (shown as merged by `app/github-actions`) gets no CI run on `main`, no release, no
deploy, and its branch is not deleted.

You do not have to do anything: **Catch up** (`.github/workflows/catch-up.yml`) runs every 15 minutes and

1. looks at the last three days of `main`; if a commit changed files that should start **Publish stable release** (or **Deploy web
   and API**, when `CLOUDFLARE_DEPLOY` is `true`) and no run exists for it or for a later commit, it starts that workflow by
   hand (a manual start is allowed with the workflow token). A commit younger than ten minutes is left alone, so the normal trigger
   gets its chance first, and a run that failed counts as "covered" (it is for you to look at, not to retry forever);
2. deletes merged pull request branches that are still there and unchanged since the merge.

To do it right away: Actions > **Catch up** > Run workflow. `node scripts/catch-up.mjs --dry-run` (with `gh` signed in) says what it would do.
A merge you make yourself (not through the auto-merge job) starts the workflows normally, and a personal access token stored as
the secret `AUTO_MERGE_TOKEN` makes the auto-merge job's merges count as yours, so catch-up is then only a safety net.
