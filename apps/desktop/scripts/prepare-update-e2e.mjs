#!/usr/bin/env node
// Builds two versions of the app for the update test (tests/update):
//   dist-update/old  version 0.0.1, packaged to run from a folder, with an update feed on 127.0.0.1
//   dist-update/new  version 0.0.2, with the installer files + manifest that old should download
// Then writes dist-update/build.json for the test. Run through `pnpm test:update`.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 47821
const OLD_VERSION = '0.0.1'
const NEW_VERSION = '0.0.2'

const platform = process.platform
if (platform === 'darwin') {
  console.error(
    'The update test needs signed builds on macOS (Squirrel.Mac), so it is skipped there.'
  )
  process.exit(0)
}

const builder = readFileSync('electron-builder.yml', 'utf8').replaceAll('\r\n', '\n')
const productName = builder.match(/^productName: (.*)$/m)[1]
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${result.status})`)
}

rmSync('dist-update', { recursive: true, force: true })
mkdirSync('dist-update', { recursive: true })

// The app code is the same in both builds; only the version differs.
run('pnpm', ['exec', 'electron-vite', 'build'])

function packageVersion(name, version) {
  const output = `dist-update/${name}`
  // Same config as a real release, except updates come from a local server instead of GitHub.
  const config = builder
    .replace(
      /^publish:[\s\S]*$/m,
      `publish:\n  provider: generic\n  url: http://127.0.0.1:${PORT}\n`
    )
    .replace(/^directories:\n/m, `directories:\n  output: ${output}\n`)
    // Playwright drives the old app, so it needs the Node inspector flags that releases switch off.
    .replace('enableNodeCliInspectArguments: false', 'enableNodeCliInspectArguments: true')
  const configPath = `dist-update/${name}.yml`
  writeFileSync(configPath, config)

  // Version is set per build without touching package.json on disk for good.
  const original = readFileSync('package.json', 'utf8')
  writeFileSync('package.json', original.replace(/"version": "[^"]*"/, `"version": "${version}"`))
  try {
    const target = platform === 'win32' ? ['--win', 'nsis'] : ['--linux', 'AppImage']
    run('node', [
      'node_modules/electron-builder/cli.js',
      ...target,
      '--config',
      configPath,
      '--publish',
      'never'
    ])
  } finally {
    writeFileSync('package.json', original)
  }
}

packageVersion('old', OLD_VERSION)
packageVersion('new', NEW_VERSION)

const exe =
  platform === 'win32'
    ? join('dist-update', 'old', 'win-unpacked', `${pkg.name}.exe`)
    : join('dist-update', 'old', 'linux-unpacked', pkg.name)

const appImage = readdirSync('dist-update/old').find((f) => f.endsWith('.AppImage'))

writeFileSync(
  'dist-update/build.json',
  JSON.stringify(
    {
      port: PORT,
      oldVersion: OLD_VERSION,
      newVersion: NEW_VERSION,
      oldExecutable: exe,
      oldAppImage: appImage ? join('dist-update', 'old', appImage) : null,
      feedDir: 'dist-update/new',
      productName
    },
    null,
    2
  )
)
console.log('Update test builds are ready in dist-update/')
