// Runs before the first paint (a separate file, because the page's CSP does not allow inline scripts).
// It puts the saved theme and accent on <html> so a dark page never starts out white and then flips.
// Keep the storage key and shape in step with src/lib/theme.ts.
;(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('preferences') || 'null')
    var prefs = (saved && saved.preferences) || {}
    var root = document.documentElement
    var dark =
      prefs.theme === 'dark' ||
      ((prefs.theme === undefined || prefs.theme === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) root.classList.add('dark')
    if (typeof prefs.accent === 'string' && /^[a-z]+$/.test(prefs.accent)) {
      root.dataset.accent = prefs.accent
    }
  } catch {
    // Storage unavailable: the app sets the theme itself once it loads.
  }
})()
