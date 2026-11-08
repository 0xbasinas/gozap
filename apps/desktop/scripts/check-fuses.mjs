#!/usr/bin/env node
// Check the Electron fuses of a packaged app.
// Usage: node scripts/check-fuses.mjs [--test-build] [unpacked-folder]
//   default folder: dist. A release build must be hardened; --test-build allows the Node inspector flags,
//   which `pnpm build:unpack` leaves on for Playwright.
import { getCurrentFuseWire } from '@electron/fuses'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareFuses } from './lib/fuses.mjs'

const args = process.argv.slice(2)
const testBuild = args.includes('--test-build')
const dist = args.find((a) => !a.startsWith('--')) ?? 'dist'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const productName = readFileSync('electron-builder.yml', 'utf8').match(/^productName: (.*)$/m)[1]

/** The executable inside the unpacked app for this OS. */
function executable() {
  if (process.platform === 'win32') return join(dist, 'win-unpacked', `${pkg.name}.exe`)
  if (process.platform === 'linux') return join(dist, 'linux-unpacked', pkg.name)
  const macDir = readdirSync(dist).find((d) => d.startsWith('mac'))
  return join(dist, macDir ?? 'mac', `${productName}.app`, 'Contents', 'MacOS', productName)
}

const exe = executable()
if (!existsSync(exe)) {
  console.error(`No packaged app found at ${exe}. Build it first.`)
  process.exit(1)
}

const problems = compareFuses(await getCurrentFuseWire(exe), { testBuild })
if (problems.length) {
  console.error(`Fuse check failed for ${exe}:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`Fuses OK (${testBuild ? 'test build' : 'hardened'}): ${exe}`)
