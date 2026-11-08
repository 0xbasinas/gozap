import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assess,
  daysBetween,
  readCompatDate,
  setCompatDate,
  workerdDate
} from './compat-date-lib.mjs'

test('workerdDate reads the date out of the version', () => {
  assert.equal(workerdDate('1.20261104.1'), '2026-11-04')
  assert.throws(() => workerdDate('latest'))
})

test('read and set keep the rest of the file', () => {
  const cfg = '{\n  // c\n  "compatibility_date": "2026-01-01",\n  "x": 1\n}'
  assert.equal(readCompatDate(cfg), '2026-01-01')
  const out = setCompatDate(cfg, '2026-11-04')
  assert.match(out, /\/\/ c/)
  assert.equal(readCompatDate(out), '2026-11-04')
  assert.throws(() => setCompatDate('{}', '2026-11-04'))
})

test('assess', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30)
  assert.equal(assess({ configDate: '2026-10-01', runtimeDate: '2026-11-04' }).status, 'ok')
  assert.equal(assess({ configDate: '2026-01-01', runtimeDate: '2026-11-04' }).status, 'stale')
  const ahead = assess({ configDate: '2026-11-07', runtimeDate: '2026-11-04' })
  assert.equal(ahead.status, 'ahead')
  assert.equal(ahead.target, '2026-11-04')
})
