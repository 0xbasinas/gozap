// Reads and checks the update manifests electron-builder writes (latest.yml, latest-mac.yml, latest-linux.yml).
// They have a fixed, simple shape, so a small parser is enough and avoids a YAML dependency.

const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2')

/** @returns {{version?: string, path?: string, sha512?: string, stagingPercentage?: number, files: {url: string, sha512?: string, size?: number}[]}} */
export function parseManifest(text) {
  const manifest = { files: [] }
  let inFiles = false
  let item = null

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const top = raw.match(/^([A-Za-z]\w*):\s*(.*)$/)
    if (top) {
      inFiles = top[1] === 'files'
      if (!inFiles) {
        const value = unquote(top[2])
        if (top[1] === 'stagingPercentage') manifest.stagingPercentage = Number(value)
        else manifest[top[1]] = value
      }
      continue
    }
    if (!inFiles) continue

    const start = raw.match(/^\s*-\s+(\w+):\s*(.*)$/)
    const field = raw.match(/^\s+(\w+):\s*(.*)$/)
    if (start) {
      item = { [start[1]]: unquote(start[2]) }
      manifest.files.push(item)
    } else if (field && item) {
      item[field[1]] = unquote(field[2])
    }
  }

  for (const file of manifest.files) if (file.size !== undefined) file.size = Number(file.size)
  return manifest
}

/**
 * Compare a manifest with what is really in the build folder.
 * @param {ReturnType<typeof parseManifest>} manifest
 * @param {{version: string, files: Map<string, {size: number, sha512: string}>}} build
 *   `files` maps a file name in the build folder to its size and base64 sha512
 * @returns {string[]} problems, empty when everything agrees
 */
export function checkManifest(manifest, build) {
  const problems = []

  if (manifest.version !== build.version) {
    problems.push(`manifest version is ${manifest.version}, the app is ${build.version}`)
  }
  if (manifest.stagingPercentage !== undefined) {
    problems.push('a fresh build must not have stagingPercentage (the publish step adds it)')
  }
  if (!manifest.files.length) problems.push('manifest lists no files')

  for (const entry of manifest.files) {
    const name = decodeURIComponent(entry.url)
    const actual = build.files.get(name)
    if (!actual) {
      problems.push(`${name} is in the manifest but not in the build folder`)
      continue
    }
    if (entry.size !== undefined && entry.size !== actual.size) {
      problems.push(`${name}: manifest size ${entry.size}, file size ${actual.size}`)
    }
    if (entry.sha512 && entry.sha512 !== actual.sha512) {
      problems.push(`${name}: sha512 in the manifest does not match the file`)
    }
    if (!name.includes(build.version)) {
      problems.push(`${name} does not contain the version ${build.version}`)
    }
    if (/\.(exe|zip|dmg)$/.test(name) && !build.files.has(`${name}.blockmap`)) {
      problems.push(`${name} has no .blockmap, so updates cannot be differential`)
    }
  }

  if (manifest.path && !manifest.files.some((f) => decodeURIComponent(f.url) === manifest.path)) {
    problems.push(`manifest path ${manifest.path} is not one of its files`)
  }
  return problems
}
