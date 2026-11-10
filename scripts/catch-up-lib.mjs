// Pure helpers for scripts/catch-up.mjs (the "Catch up" workflow). No git, no network, so they are unit tested.
// See docs/releasing/rollouts.md ("When a merge does not start a release").

/** Turn a workflow `paths:` glob into a RegExp: `*` stays inside a folder, `**` crosses folders. */
function globToRegExp(glob) {
  const escaped = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    )
    .join('.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * The `paths:` list under `on: push:` of a workflow file (what decides whether a push runs it).
 * Reads only the simple shape we use (`paths:` followed by `- 'pattern'` lines); returns [] when there is none.
 */
export function readPushPaths(yaml) {
  const lines = yaml.replaceAll('\r\n', '\n').split('\n')
  const start = lines.findIndex((l) => /^\s+paths:\s*$/.test(l))
  if (start === -1) return []
  const paths = []
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^\s+-\s+['"]?([^'"#]+?)['"]?\s*(#.*)?$/)
    if (!item) break
    paths.push(item[1])
  }
  return paths
}

/** Would a push that changed `files` start a workflow with these `paths:`? Later patterns win, `!` excludes (as on GitHub). */
export function pathsMatch(files, paths) {
  if (paths.length === 0) return true
  return files.some((file) => {
    let matched = false
    for (const pattern of paths) {
      const negated = pattern.startsWith('!')
      if (globToRegExp(negated ? pattern.slice(1) : pattern).test(file)) matched = !negated
    }
    return matched
  })
}

/**
 * The newest commit that should have started the workflow, or null.
 * `commits` are { sha, time (seconds), files } newest first.
 */
export function newestTrigger(commits, paths) {
  return commits.find((c) => pathsMatch(c.files, paths)) ?? null
}

/**
 * Does this commit still need someone to start the workflow by hand?
 * `runsCover` is whether any run of the workflow already covers it (a run on this commit or a later one, any outcome:
 * a failed run is for a person to look at, not for us to retry forever). A commit younger than `graceSeconds` is left
 * alone, so the normal push trigger has time to fire first.
 */
export function needsStart({ commit, now, runsCover, graceSeconds = 600 }) {
  if (!commit) return false
  if (runsCover) return false
  return now - commit.time >= graceSeconds
}

/**
 * Merged pull request branches that can be deleted: in this repository, still there, never the default branch, and
 * unchanged since the merge (the tip is still the commit the pull request was merged with), so no later work is lost.
 */
export function branchesToDelete({ pulls, branches, defaultBranch }) {
  return pulls
    .filter((pr) => !pr.isCrossRepository)
    .filter((pr) => pr.headRefName !== defaultBranch)
    .filter((pr) => branches.get(pr.headRefName) === pr.headRefOid)
    .map((pr) => pr.headRefName)
}
