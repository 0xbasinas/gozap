// Pure helpers for versioned docs. Tested in versions-lib.test.mjs.
//
// How versions work: the newest docs are the Markdown in /docs ("Latest"). `pnpm version:create <slug>` copies /docs to
// /docs-versions/<slug> and lists the version in apps/docs/versions.json. The site build turns each copy into pages
// under /<slug>/..., with its own sidebar, a banner that links back to the latest page, and no search entry.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The version a page id (like "1-0/api/overview") belongs to, or null for the latest docs. */
export function versionOf(id, versions) {
  return versions.find((v) => id === v.slug || id.startsWith(`${v.slug}/`)) ?? null
}

/** The page id without its version prefix ("1-0/api/overview" becomes "api/overview"). */
export function stripVersion(id, version) {
  return version ? id.slice(version.slug.length + 1) : id
}

/** The sidebar for the site: the latest docs, then one copy per version with only the pages that snapshot has. */
export function buildSidebar(sections, versions, hasPage) {
  const group = (section, prefix) => {
    const items = section.pages
      .filter((page) => hasPage(prefix + page))
      .map((page) => ({
        slug: prefix + page,
        ...(section.labels?.[page] ? { label: section.labels[page] } : {})
      }))
    return items.length ? [{ label: section.label, items }] : []
  }
  return [
    ...sections.flatMap((section) => group(section, '')),
    ...versions.flatMap((v) => sections.flatMap((section) => group(section, `${v.slug}/`)))
  ]
}

/** The first page of a version (or of the latest docs when version is null). */
export function rootPage(sections, hasPage, version) {
  const prefix = version ? `${version.slug}/` : ''
  for (const section of sections) {
    for (const page of section.pages) if (hasPage(prefix + page)) return prefix + page
  }
  return null
}

/**
 * Where the version picker sends people. "same-page" goes to the same page in the other version when it exists there,
 * otherwise (or with "root") to that version's first page. The latest docs' root is the home page.
 */
export function pickerTarget({ id, from, to, sections, hasPage, redirect }) {
  const rest = stripVersion(id, from)
  const prefix = to ? `${to.slug}/` : ''
  if (redirect !== 'root' && hasPage(prefix + rest)) return `/${prefix}${rest}/`
  const root = rootPage(sections, hasPage, to)
  return to && root ? `/${root}/` : '/'
}

/** Why a slug cannot be used for a version, or null when it is fine. */
export function checkSlug(slug, sections) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return 'Use lowercase letters, numbers and dashes, like "1-0" or "v2".'
  }
  const folders = new Set(sections.flatMap((s) => s.pages.map((p) => p.split('/')[0])))
  if (folders.has(slug) || slug === 'index')
    return `"${slug}" is already a docs folder; pick another slug.`
  return null
}

/**
 * Tells whether the Markdown file of a page id exists: in /docs for the latest docs, in /docs-versions/<slug> for a
 * saved version. A saved version may lack pages added later, and the sidebar lists only the pages that exist.
 */
export function pageChecker(docsFolder, versionsFolder, versions) {
  return (id) => {
    const version = versions.find((v) => id.startsWith(`${v.slug}/`))
    return version
      ? existsSync(join(versionsFolder, version.slug, `${id.slice(version.slug.length + 1)}.md`))
      : existsSync(join(docsFolder, `${id}.md`))
  }
}
