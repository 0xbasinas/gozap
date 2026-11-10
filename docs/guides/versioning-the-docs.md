# Versioning the docs

The Markdown in `docs/` is always the **latest** docs. When you release something that changes how the app works, you can keep a copy of the old docs so people on the old version can still read them.

## Saving a version

```bash
pnpm --filter @repo/docs version:create 1-0 --label "1.0"
```

This copies `docs/` to `docs-versions/1-0/` and adds the version to `apps/docs/versions.json`. Commit both. Then keep editing `docs/` for the next version.

- The slug (`1-0`) becomes the address (`/1-0/api/overview/`), so use lowercase letters, numbers and dashes, and not the name of a docs folder.
- The label (`1.0`) is what people see in the picker. It defaults to the slug.

## What people see

- A **version picker** next to the site name, with Latest and each saved version. It only appears once a version exists.
- A **notice** above every page of an old version, with a link to the latest version of the same page.
- The **sidebar** and the previous/next links of an old version only list pages of that version. A page the old version did not have is simply not listed.
- **Search** only covers the latest docs.

## Where the picker goes

Each entry in `versions.json` has a `redirect` that says what the picker does when you choose it:

- `same-page` (the default) opens the same page in the other version, and falls back to that version's first page when the page does not exist there.
- `root` always opens the other version's first page.

## Fixing an old version

Edit the files in `docs-versions/<slug>/`. They are plain Markdown, so a fix is a normal change. Do not edit `apps/docs/src/content/docs`: it is generated.

## Removing a version

Delete `docs-versions/<slug>/` and its entry in `apps/docs/versions.json`.

## Where the versions live

The docs are served under `/docs`, so the latest version is at `/docs/` and an old one at `/docs/<slug>/`. Locally, `pnpm --filter @repo/docs dev` serves them at `http://localhost:4321/docs/`.
