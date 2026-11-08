// Pure helpers for `pnpm template:update` (scripts/template-update.mjs): no git, no network, so they are unit tested.
// See docs/template-updates.md.

export const CONFIG_PATH = '.template.json'
export const DEFAULT_UPSTREAM = '0xbasinas/electron-desktop-template'

/** Files that belong to the app, not the template: never touched by an update. Add your own in `.template.json`. */
export const DEFAULT_IGNORE = [
  '.template.json',
  'pnpm-lock.yaml', // regenerated with `pnpm install`, never merged by hand
  'README.md',
  'TODO.md',
  'CHANGELOG.md',
  'LICENSE'
]

/** Changes under these paths publish a release when merged (see AGENTS.md), so the PR says so. */
export const RELEASE_PATHS = [
  'apps/desktop/src/',
  'apps/desktop/build/',
  'apps/desktop/resources/',
  'apps/desktop/package.json',
  'apps/desktop/electron-builder.yml',
  'apps/desktop/electron.vite.config.ts',
  'pnpm-lock.yaml'
]

const SHA = /^[0-9a-f]{40}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export const isSha = (value) => typeof value === 'string' && SHA.test(value)
export const short = (sha) => String(sha).slice(0, 7)

/** Check `.template.json` and fill in defaults. Throws a message that says what is wrong. */
export function parseConfig(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`${CONFIG_PATH} is not valid JSON.`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${CONFIG_PATH} must be an object.`)
  }
  const upstream = raw.upstream ?? DEFAULT_UPSTREAM
  if (typeof upstream !== 'string' || !REPO.test(upstream)) {
    throw new Error(`${CONFIG_PATH}: "upstream" must look like "owner/repo".`)
  }
  if (!isSha(raw.base)) {
    throw new Error(
      `${CONFIG_PATH}: "base" must be the full 40-character commit of the template this app is based on. Run: pnpm template:update --adopt`
    )
  }
  const ignore = raw.ignore ?? []
  if (!Array.isArray(ignore) || ignore.some((p) => typeof p !== 'string' || p.trim() === '')) {
    throw new Error(`${CONFIG_PATH}: "ignore" must be a list of path patterns.`)
  }
  // Never let a pattern climb out of the repo or turn into a git pathspec option.
  for (const p of ignore) {
    if (p.startsWith(':') || p.startsWith('/') || p.split(/[\\/]/).includes('..')) {
      throw new Error(`${CONFIG_PATH}: bad ignore pattern "${p}".`)
    }
  }
  return { upstream, base: raw.base, ignore: [...ignore] }
}

export function serializeConfig({ upstream, base, ignore }) {
  return `${JSON.stringify({ upstream, base, ignore }, null, 2)}\n`
}

/** The git pathspecs that leave out everything the app owns. */
export function excludePathspecs(ignore) {
  return [...new Set([...DEFAULT_IGNORE, ...ignore])].map((p) => `:(exclude,glob)${p}`)
}

/** Is `file` covered by one of `patterns` (the default ignore list plus the app's own)? Supports `*`, `**` and a trailing `/`. */
export function isIgnored(file, patterns) {
  return patterns.some((pattern) => {
    const dir = pattern.endsWith('/')
    const body = dir ? pattern.slice(0, -1) : pattern
    const re = new RegExp(
      `^${body
        .split('**')
        .map((part) =>
          part
            .split('*')
            .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*')
        )
        .join('.*')}${dir ? '(/.*)?' : ''}$`
    )
    return re.test(file)
  })
}

/**
 * Pick the template commit an app was made from: the one whose files differ least from the app's.
 * `candidates` are { sha, changed } (changed = lines that differ), newest first; on a tie the newest wins.
 */
export function pickBase(candidates) {
  let best = null
  for (const c of candidates) {
    if (!isSha(c.sha) || !Number.isFinite(c.changed)) continue
    if (best === null || c.changed < best.changed) best = c
  }
  return best
}

/** Sum the changed lines of `git diff --numstat` output (binary files count as 1). */
export function countChanged(numstat) {
  let total = 0
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [added, removed] = line.split('\t')
    total += (added === '-' ? 1 : Number(added)) + (removed === '-' ? 0 : Number(removed))
  }
  return total
}

/** What `git diff --name-status -z` says changed, as { status, path } with renames split into delete + add. */
export function parseNameStatus(output) {
  const parts = output.split('\0').filter((p) => p !== '')
  const files = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i][0]
    if (status === 'R' || status === 'C') {
      files.push({ status: 'D', path: parts[i + 1] }, { status: 'A', path: parts[i + 2] })
      i += 3
    } else {
      files.push({ status, path: parts[i + 1] })
      i += 2
    }
  }
  return files
}

/**
 * Turn the result of applying one file's patch into an outcome.
 * `git apply --3way` exits 1 and prints "with conflicts" when it left conflict markers, and exits 1 with an "error:"
 * line when it could not apply the patch at all (for example the app deleted that file).
 */
export function classifyApply({ status, output }) {
  if (status === 0) return 'clean'
  if (/with conflicts/i.test(output)) return 'conflict'
  return 'failed'
}

export function touchesRelease(files) {
  return files.some((f) => RELEASE_PATHS.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)))
}

export const branchName = (head) => `template-update/${short(head)}`

export const commitTitle = (base, head) =>
  `chore: update from the template (${short(base)}..${short(head)})`

/** The pull request description: what came in, what needs a human, and what was left alone. */
export function pullRequestBody({
  upstream,
  base,
  head,
  clean,
  conflicts,
  failed,
  ignored,
  release,
  commits
}) {
  const lines = []
  lines.push(
    `Brings in the changes from [${upstream}](https://github.com/${upstream}) between \`${short(base)}\` and \`${short(head)}\` ([compare](https://github.com/${upstream}/compare/${short(base)}...${short(head)})).`
  )
  lines.push('')
  if (commits.length) {
    lines.push(`### Template changes (${commits.length})`, '')
    for (const c of commits.slice(0, 30)) lines.push(`- ${c}`)
    if (commits.length > 30) lines.push(`- ...and ${commits.length - 30} more`)
    lines.push('')
  }
  lines.push(`### Result`, '')
  lines.push(`- Applied cleanly: ${clean.length} file${clean.length === 1 ? '' : 's'}`)
  lines.push(`- Conflicts to resolve: ${conflicts.length}`)
  lines.push(`- Could not apply: ${failed.length}`)
  lines.push('')
  if (conflicts.length) {
    lines.push(
      '### Conflicts',
      '',
      'These files changed in both the template and this app. They contain `<<<<<<<` markers: resolve them on this branch (CI fails until you do).',
      ''
    )
    for (const f of conflicts) lines.push(`- \`${f}\``)
    lines.push('')
  }
  if (failed.length) {
    lines.push(
      '### Could not apply',
      '',
      'The template changed these files but the patch did not fit (for example this app deleted or moved the file). Look at the template version and copy over what you want.',
      ''
    )
    for (const f of failed) lines.push(`- \`${f}\``)
    lines.push('')
  }
  if (ignored.length) {
    lines.push(
      `### Left alone (${ignored.length})`,
      '',
      'These changed in the template but are listed as yours in `.template.json` (or the defaults), so they were not touched:',
      ''
    )
    for (const f of ignored.slice(0, 30)) lines.push(`- \`${f}\``)
    if (ignored.length > 30) lines.push(`- ...and ${ignored.length - 30} more`)
    lines.push('')
  }
  if (release) {
    lines.push(
      '> **Merging this publishes a release**: it changes the desktop app (`apps/desktop/src/`, build config or dependencies). Only merge when it is ready to ship.',
      ''
    )
  }
  lines.push(
    '`.template.json` now points at the new template commit, so the next update starts from here.'
  )
  return lines.join('\n')
}
