import { describe, expect, it } from 'vitest'
import { compareFuses, expectedFuses, FUSE_NAMES } from './fuses.mjs'

// Build a "wire" (index -> state) the way @electron/fuses reports it.
const wireFor = (values) =>
  Object.fromEntries(FUSE_NAMES.map((name, index) => [index, values[name] ? 49 : 48]))

describe('compareFuses', () => {
  it('accepts a hardened build', () => {
    expect(compareFuses(wireFor(expectedFuses()), {})).toEqual([])
  })

  it('accepts a test build that keeps the inspector flags', () => {
    expect(compareFuses(wireFor(expectedFuses({ testBuild: true })), { testBuild: true })).toEqual(
      []
    )
  })

  it('rejects a release build that still has the inspector on', () => {
    const wire = wireFor(expectedFuses({ testBuild: true }))
    expect(compareFuses(wire, {}).join()).toMatch(/enableNodeCliInspectArguments: is enabled/)
  })

  it('rejects a build that left runAsNode on', () => {
    const wire = wireFor({ ...expectedFuses(), runAsNode: true })
    expect(compareFuses(wire, {}).join()).toMatch(/runAsNode/)
  })

  it('reports fuses that are missing or removed', () => {
    expect(compareFuses({}, {})).toHaveLength(FUSE_NAMES.length)
  })
})
