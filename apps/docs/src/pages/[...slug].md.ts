// The Markdown behind every docs page, at the page's own name plus ".md" (for example /releasing.md). The page
// actions menu copies it, opens it, or hands its address to an AI assistant. Plain text with no layout, so people
// and tools can read a page without the site around it.
import type { APIRoute, GetStaticPaths } from 'astro'
import { getCollection } from 'astro:content'

// The home page is layout components, not prose, so it has no Markdown copy.
const SKIP = new Set(['index', '404'])

export const getStaticPaths: GetStaticPaths = async () => {
  const pages = await getCollection('docs')
  return pages
    .filter((page) => !SKIP.has(page.id))
    .map((page) => ({
      params: { slug: page.id },
      props: { title: page.data.title, body: page.body ?? '' }
    }))
}

export const GET: APIRoute = ({ props }) =>
  new Response(`# ${props['title']}\n\n${props['body']}`, {
    headers: { 'content-type': 'text/markdown; charset=utf-8' }
  })
