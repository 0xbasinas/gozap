// Conventional Commits: "type(scope): subject", e.g. "feat(updater): add beta channel".
// Types: feat, fix, perf, refactor, docs, test, build, ci, chore, style, revert.
// Release notes are grouped by these types (see scripts/release-notes.mjs).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Dependabot titles start with a capital ("Bump x"); squash merges use the PR title anyway.
    'subject-case': [0],
    // Co-Authored-By trailers and pasted links are fine.
    'body-max-line-length': [0],
    'footer-max-line-length': [0]
  }
}
