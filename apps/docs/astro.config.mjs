import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BASE } from './base.mjs'
import { monoDark, monoLight } from './mono-themes.mjs'
import { buildSidebar, pageChecker } from './scripts/versions-lib.mjs'

const sections = JSON.parse(readFileSync(new URL('./sidebar.json', import.meta.url), 'utf8'))
const versions = JSON.parse(
  readFileSync(new URL('./versions.json', import.meta.url), 'utf8')
).versions
const hasPage = pageChecker(
  fileURLToPath(new URL('../../docs', import.meta.url)),
  fileURLToPath(new URL('../../docs-versions', import.meta.url)),
  versions
)

const REPO = 'https://github.com/0xbasinas/electron-desktop-template'

// The pages under "Guides" and "Reference" are generated from /docs by scripts/sync-docs.mjs, so the Markdown in
// /docs stays the one source of truth. Only the home page (src/content/docs/index.mdx) is written here.
export default defineConfig({
  // The docs are served under /docs on the site, next to the web app and the API.
  base: BASE,
  // The diagram library is a big chunk on purpose: it is only fetched on pages that have a diagram.
  vite: { plugins: [tailwindcss()], build: { chunkSizeWarningLimit: 1500 } },
  integrations: [
    starlight({
      title: 'Electron Desktop Template',
      description:
        'Build, ship and update an Electron desktop app with a website, an API and sign-in.',
      favicon: '/favicon.svg',
      customCss: ['./src/styles/global.css', './src/styles/theme.css'],
      components: {
        Footer: './src/components/Footer.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
        PageTitle: './src/components/PageTitle.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro'
      },
      // Starlight marks the theme with data-theme; the web app's theme file uses a "dark" class. Keep them in step.
      head: [
        {
          tag: 'script',
          content:
            "(function(){var r=document.documentElement;function s(){r.classList.toggle('dark',r.dataset.theme==='dark')}s();new MutationObserver(s).observe(r,{attributes:true,attributeFilter:['data-theme']})})()"
        }
      ],
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/docs/` },
      lastUpdated: false,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      expressiveCode: {
        themes: [monoDark, monoLight],
        styleOverrides: { borderRadius: '0.625rem', borderColor: 'var(--sl-color-gray-5)' }
      },
      sidebar: buildSidebar(sections, versions, hasPage),
      routeMiddleware: './src/routeData.ts'
    })
  ]
})
