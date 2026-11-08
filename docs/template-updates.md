# Keeping an app up to date with the template

An app made with "Use this template" starts as a copy with **no shared git history**, so it normally goes stale the day you
copy it. `pnpm template:update` fixes that: it brings the template's newer changes into your app as a pull request.

## One-time setup

```bash
pnpm template:update --adopt      # works out which template commit your app was made from, writes .template.json
git add .template.json && git commit -m "chore: track the template"
```

`--adopt` fetches the template, compares your files with its last 200 commits (leaving out files you own) and picks the
closest one. If you know the commit, use `--base <sha>`. If your template is a fork or a different repo, add
`--upstream owner/repo`.

`.template.json`:

```json
{
  "upstream": "0xbasinas/electron-desktop-template",
  "base": "<the template commit you last brought in>",
  "ignore": ["apps/web/src/pages/Landing.tsx", "docs/**"]
}
```

`ignore` lists files that are **yours**: the update never touches them. These are always yours: `.template.json`,
`pnpm-lock.yaml` (regenerated with `pnpm install`), `README.md`, `TODO.md`, `CHANGELOG.md`, `LICENSE`. Patterns allow `*`,
`**` and a trailing `/` for a folder.

## Updating

```bash
pnpm template:status     # how far behind are we? exits 1 when behind
pnpm template:update     # make a branch, apply the changes, open a pull request
```

What it does:

1. Fetches the template and finds what changed between `base` and its newest commit.
2. Applies each changed file with a **3-way merge** against your own copy, so your edits and the template's edits to the
   same file are combined. Anything you own (see above) is skipped.
3. Commits on a branch `template-update/<sha>`, moves `base` forward, runs `pnpm install` if `package.json` files changed,
   pushes and opens a pull request that lists **what applied cleanly, what conflicted, what could not be applied and what was
   left alone**.

If any file conflicts or cannot be applied the pull request is a **draft**: conflicting files contain `<<<<<<<` markers on the
branch, so CI fails until you resolve them. "Could not apply" usually means your app deleted or moved a file the template
changed; look at the template's version and copy what you want.

Merging an update that touches `apps/desktop/src/`, the build config or dependencies **publishes a release** (see
[releasing.md](releasing.md)); the pull request says so. Auto-merge is never turned on for you.

Options: `--ref <branch|tag|sha>` to update to something other than the template's default branch, `--no-pr` to stop after the
commit (nothing is pushed), `--no-install` to skip `pnpm install`.

## Making it painless

- **Keep changes to template files small and in your own files.** The fewer template files you edit, the fewer conflicts.
- **Fix bugs in the template first**, then update the app, so the fix is not made twice and lost.
- Run it regularly. Small updates conflict less than a year of changes.
- `pnpm rename` is a set of small edits to files such as `package.json` and `electron-builder.yml`; the 3-way merge keeps them.

## Limits

- It needs `git` and the GitHub CLI (`gh`, signed in). The template must be reachable by `git fetch` (public, or you are logged in).
- If the template's history is rewritten, `base` disappears; run `pnpm template:update --adopt --force`.
- Renames upstream are applied as a delete plus an add.
