#!/usr/bin/env node
// Rename this template for a new app.
// Usage: pnpm rename <app-name> [--owner <github-user>] [--title "Display Name"]
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const name = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))

if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error('Usage: pnpm rename <app-name> [--owner <github-user>] [--title "Display Name"]')
  console.error('<app-name> must be lowercase kebab-case, e.g. my-cool-app')
  process.exit(1)
}

const read = (f) => readFileSync(f, 'utf8')
const builder = read('apps/desktop/electron-builder.yml')
const pkg = JSON.parse(read('apps/desktop/package.json'))

const oldName = pkg.name
const oldTitle = builder.match(/^productName: (.*)$/m)[1].trim()
const oldOwner = builder.match(/^ {2}owner: (.*)$/m)[1].trim()
const oldId = `com.${oldOwner}.${oldName}`

const owner = flag('owner') ?? oldOwner
const title =
  flag('title') ??
  name
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
const newId = `com.${owner}.${name}`

const edits = {
  'apps/desktop/package.json': (s) =>
    s
      .replace(`"name": "${oldName}"`, `"name": "${name}"`)
      .replace(/"author": ".*"/, `"author": "${owner}"`),
  'apps/desktop/electron-builder.yml': (s) =>
    s
      .replace(/^appId: .*$/m, `appId: ${newId}`)
      .replace(/^productName: .*$/m, `productName: ${title}`)
      .replace(/^ {2}executableName: .*$/gm, `  executableName: ${name}`)
      .replace(/^ {2}owner: .*$/m, `  owner: ${owner}`)
      .replace(/^ {2}repo: .*$/m, `  repo: ${name}`)
      .replace(/^ {2}maintainer: .*$/m, `  maintainer: ${owner}`)
      .replace(new RegExp(`^( {6}- )${oldName}$`, 'm'), `$1${name}`),
  'apps/desktop/src/main/menu.ts': (s) =>
    s.replaceAll(`${oldOwner}/${oldName}`, `${owner}/${name}`),
  'apps/desktop/src/main/deeplink.ts': (s) =>
    s.replace(`PROTOCOL = '${oldName}'`, `PROTOCOL = '${name}'`),
  'apps/desktop/src/main/index.ts': (s) => s.replace(oldId, newId),
  'apps/desktop/src/renderer/index.html': (s) =>
    s.replace(/<title>.*<\/title>/, `<title>${title}</title>`),
  'apps/desktop/src/renderer/src/App.tsx': (s) => s.replaceAll(oldTitle, title),
  'apps/web/src/config.ts': (s) =>
    s
      .replaceAll(`${oldOwner}/${oldName}`, `${owner}/${name}`)
      .replace(`DESKTOP_SCHEME = '${oldName}'`, `DESKTOP_SCHEME = '${name}'`)
      .replaceAll(oldTitle, title),
  // The Worker, database and deep-link names, and the product name in emails and on passkey prompts.
  'apps/api/wrangler.jsonc': (s) => s.replaceAll(oldName, name).replaceAll(oldTitle, title),
  'apps/api/wrangler.preview-migrations.jsonc': (s) => s.replaceAll(oldName, name),
  'apps/web/public/.well-known/security.txt': (s) =>
    s.replaceAll(`${oldOwner}/${oldName}`, `${owner}/${name}`),
  'apps/web/index.html': (s) => s.replace(/<title>.*<[/]title>/, `<title>${title}</title>`),
  'README.md': (s) =>
    s.replace(/^# .*$/m, `# ${title}`).replaceAll(`${oldOwner}/${oldName}`, `${owner}/${name}`),
  'docs/releasing.md': (s) => s.replaceAll(`${oldOwner}/${oldName}`, `${owner}/${name}`),
  LICENSE: (s) => s.replace(/Copyright \(c\) (\d{4}) .*/, `Copyright (c) $1 ${owner}`)
}

for (const [file, fn] of Object.entries(edits)) {
  const before = read(file)
  const after = fn(before)
  if (after !== before) writeFileSync(file, after)
  console.log(`${after !== before ? 'updated  ' : 'unchanged'} ${file}`)
}

console.log(`\nRenamed to "${title}" (${name}, ${newId}, owner ${owner}).`)
console.log(
  'Tip: run `pnpm template:update --adopt` once to track the template, so later template improvements can be pulled in (docs/template-updates.md).'
)
console.log(
  'Next: review `git diff`, then commit. Remember to point the git remote at the new repo.'
)
