// Staged rollouts: electron-updater reads `stagingPercentage` from the release manifest
// (latest.yml, latest-mac.yml, latest-linux.yml, beta*.yml). A client only takes the update if its
// stable random id falls inside that percentage, and it takes it later once the percentage is raised.

/** Return the manifest text with `stagingPercentage` set. 100 (or more) removes it: everyone gets the update. */
export function withRollout(manifest, percent) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`Rollout percentage must be between 0 and 100, got ${percent}`)
  }
  const lines = manifest.split(/\r?\n/).filter((line) => !/^stagingPercentage:/.test(line))
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (percent < 100) lines.push(`stagingPercentage: ${percent}`)
  return lines.join('\n') + '\n'
}

/** The rollout percentage in a manifest, or 100 when it is not staged. */
export function readRollout(manifest) {
  const match = manifest.match(/^stagingPercentage:\s*(\d+(?:\.\d+)?)\s*$/m)
  return match ? Number(match[1]) : 100
}
