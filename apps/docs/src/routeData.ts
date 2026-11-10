// Route middleware (https://starlight.astro.build/guides/route-data/): each page shows only the sidebar of its own
// version (the latest docs, or one saved version), and the previous/next links stay inside that version.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import versionConfig from '../versions.json'
import { versionOf } from '../scripts/versions-lib.mjs'
import { BASE } from '../base.mjs'

type Entry =
  { type: 'link'; href: string; label: string } | { type: 'group'; label: string; entries: Entry[] }

/** The address of the first page inside a sidebar group. */
function firstHref(entry: Entry): string {
  return entry.type === 'link' ? entry.href : (entry.entries.map(firstHref).find(Boolean) ?? '')
}

function links(entries: Entry[]): { href: string; label: string }[] {
  return entries.flatMap((entry) => (entry.type === 'link' ? [entry] : links(entry.entries)))
}

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  const versions: { slug: string; label: string }[] = versionConfig.versions
  const mine = versionOf(route.id, versions)
  const belongsHere = (entry: Entry): boolean => {
    const href = firstHref(entry).slice(BASE.length).replace(/^\//, '')
    return versionOf(href, versions)?.slug === mine?.slug
  }
  // The home page has no sidebar group of its own; it keeps the latest docs' navigation.
  route.sidebar = (route.sidebar as Entry[]).filter(belongsHere) as typeof route.sidebar

  const flat = links(route.sidebar as Entry[])
  const at = flat.findIndex((link) => link.href === `${BASE}/${route.id}/`)
  if (at >= 0) {
    type Link = NonNullable<typeof route.pagination.next>
    const pick = (link?: { href: string; label: string }): Link | undefined =>
      link
        ? {
            type: 'link',
            label: link.label,
            href: link.href,
            isCurrent: false,
            attrs: {},
            badge: undefined
          }
        : undefined
    route.pagination = { prev: pick(flat[at - 1]), next: pick(flat[at + 1]) }
  }
})
