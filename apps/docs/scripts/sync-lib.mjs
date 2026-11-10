// Pure helpers for turning a Markdown file from /docs into a Starlight page. Tested in sync-lib.test.mjs.

/** The text of the first "# Title" line, or null. */
export function findTitle(markdown) {
  const match = /^#\s+(.+?)\s*$/m.exec(markdown)
  return match ? match[1] : null
}

/** Remove the first "# Title" line (Starlight draws the title from the front matter). */
export function stripTitle(markdown) {
  return markdown.replace(/^#\s+.+\r?\n+/m, '')
}

/** One plain sentence for the page description: the first paragraph, without Markdown, cut at 160 characters. */
export function findDescription(markdown) {
  for (const block of stripTitle(markdown).split(/\n\s*\n/)) {
    const text = block.trim()
    if (!text || /^(```|\||[-*>#]|\d+\.)/.test(text)) continue
    const plain = text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
    return plain.length <= 160 ? plain : plain.slice(0, 157).replace(/\s+\S*$/, '') + '...'
  }
  return null
}

/**
 * Links to another file in /docs (api.md, ../api/overview.md#section) become links between the generated pages.
 * A page is served as /folder/name/, so a relative link needs one more "../" than the Markdown file path.
 */
export function rewriteLinks(markdown) {
  return markdown.replace(
    /\]\(((?:\.{1,2}\/)*)([a-z0-9][a-z0-9/-]*)\.md(#[^)]*)?\)/gi,
    (_all, up, slug, hash = '') => `](../${up.replace(/^\.\//, '')}${slug}/${hash})`
  )
}

const yaml = (text) => JSON.stringify(text)

/**
 * The finished page: front matter plus the body without its title. For a saved version, `options` says where the file
 * lives (editPath), when it last changed (lastUpdated, an ISO date), the notice shown above the page (banner, HTML) and that search should skip it (search: false).
 */
export function toPage(name, markdown, options = {}) {
  const source = markdown.replaceAll('\r\n', '\n')
  const title = findTitle(source) ?? name
  const description = findDescription(source)
  const front = [
    '---',
    `title: ${yaml(title)}`,
    ...(description ? [`description: ${yaml(description)}`] : []),
    `editUrl: ${yaml(`https://github.com/0xbasinas/electron-desktop-template/edit/main/${options.editPath ?? `docs/${name}.md`}`)}`,
    ...(options.lastUpdated ? [`lastUpdated: ${options.lastUpdated}`] : []),
    ...(options.banner ? [`banner:`, `  content: ${yaml(options.banner)}`] : []),
    ...(options.search === false ? [`pagefind: false`] : []),
    '---',
    ''
  ].join('\n')
  return `${front}\n${rewriteLinks(stripTitle(source))}`
}
