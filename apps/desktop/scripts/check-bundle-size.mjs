#!/usr/bin/env node
// Fail if the renderer bundle grows past the limits in bundle-budget.json.
// Run after `pnpm build`. Sizes are gzip, which is what actually matters for load cost.
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const budget = JSON.parse(readFileSync('bundle-budget.json', 'utf8'))
const kb = (bytes) => bytes / 1024

let files
try {
  files = readdirSync(budget.dir)
} catch {
  console.error(`No build output in ${budget.dir}. Run "pnpm build" first.`)
  process.exit(1)
}

const sizes = files
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => ({ file: f, gzip: kb(gzipSync(readFileSync(join(budget.dir, f))).length) }))

const js = sizes.filter((s) => s.file.endsWith('.js'))
const css = sizes.filter((s) => s.file.endsWith('.css'))
const sum = (list) => list.reduce((total, s) => total + s.gzip, 0)

const checks = [
  ['total JS (gzip)', sum(js), budget.maxTotalJsGzipKB],
  ['largest JS chunk (gzip)', Math.max(0, ...js.map((s) => s.gzip)), budget.maxChunkGzipKB],
  ['total CSS (gzip)', sum(css), budget.maxTotalCssGzipKB]
]

console.log('Renderer bundle sizes (gzip):')
sizes.forEach((s) => console.log(`  ${s.gzip.toFixed(1).padStart(7)} kB  ${s.file}`))
console.log()

let failed = false
for (const [label, actual, limit] of checks) {
  const ok = actual <= limit
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual.toFixed(1)} kB / ${limit} kB`)
}

if (failed) {
  console.error(
    '\nBundle budget exceeded. Trim imports or code-split, or raise bundle-budget.json on purpose.'
  )
  process.exit(1)
}
