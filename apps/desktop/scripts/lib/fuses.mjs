// Electron fuses are switches baked into the executable. This file says which ones a build of this app must have,
// and compares them with what is really in a packaged executable. The same list is in electron-builder.yml
// (`electronFuses`); this check is what stops the two drifting apart or a build silently shipping without them.

// Names and order follow @electron/fuses' FuseV1Options.
export const FUSE_NAMES = [
  'runAsNode',
  'enableCookieEncryption',
  'enableNodeOptionsEnvironmentVariable',
  'enableNodeCliInspectArguments',
  'enableEmbeddedAsarIntegrityValidation',
  'onlyLoadAppFromAsar',
  'loadBrowserProcessSpecificV8Snapshot',
  'grantFileProtocolExtraPrivileges'
]

/**
 * The state every fuse must have (true = enabled).
 * A test build keeps the Node inspector flags on, because Playwright needs them to drive the app.
 */
export function expectedFuses({ testBuild = false } = {}) {
  return {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: testBuild,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    // The renderer is served from app://, so file:// pages need no extra privileges.
    grantFileProtocolExtraPrivileges: false
  }
}

// FuseState values from @electron/fuses: 48 = disabled, 49 = enabled.
const ENABLED = 49
const DISABLED = 48

/**
 * @param {Record<number, number>} wire  what getCurrentFuseWire() returned: fuse index -> state
 * @returns {string[]} problems, empty when the executable matches
 */
export function compareFuses(wire, options) {
  const expected = expectedFuses(options)
  const problems = []
  FUSE_NAMES.forEach((name, index) => {
    const state = wire[index]
    const want = expected[name]
    if (state !== ENABLED && state !== DISABLED) {
      problems.push(`${name}: unknown state ${state} (wanted ${want ? 'enabled' : 'disabled'})`)
    } else if ((state === ENABLED) !== want) {
      problems.push(
        `${name}: is ${state === ENABLED ? 'enabled' : 'disabled'}, should be ${want ? 'enabled' : 'disabled'}`
      )
    }
  })
  return problems
}
