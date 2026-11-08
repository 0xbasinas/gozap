#!/usr/bin/env node
// Set the rollout percentage in update manifests, in place.
// Usage: node scripts/set-rollout.mjs <percent 0-100> <manifest.yml> [more.yml ...]
import { readFileSync, writeFileSync } from 'node:fs'
import { readRollout, withRollout } from './lib/rollout.mjs'

const [percentArg, ...files] = process.argv.slice(2)
const percent = Number(percentArg)

if (percentArg === undefined || !files.length) {
  console.error('Usage: node scripts/set-rollout.mjs <percent 0-100> <manifest.yml> [more.yml ...]')
  process.exit(1)
}

for (const file of files) {
  const before = readRollout(readFileSync(file, 'utf8'))
  writeFileSync(file, withRollout(readFileSync(file, 'utf8'), percent))
  console.log(`${file}: rollout ${before}% -> ${percent}%`)
}
