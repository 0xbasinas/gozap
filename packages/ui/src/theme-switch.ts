/**
 * Run `change` (which switches the theme) with every CSS transition switched off for that moment, so all colours
 * change in the same frame. Without this, buttons and links that animate their colours (`transition-colors`) lag
 * behind the page and the switch looks like a flicker.
 */
export function switchThemeInstantly(change: () => void): void {
  const root = document.documentElement
  root.classList.add('theme-switching')
  change()
  // Make the browser apply the new colours with transitions off, then turn transitions back on.
  void getComputedStyle(root).backgroundColor
  window.setTimeout(() => root.classList.remove('theme-switching'), 50)
}
