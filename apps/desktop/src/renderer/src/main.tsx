import './assets/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isAccent } from '@repo/shared/accents'
import App from './App'
import { SettingsWindow } from './components/SettingsWindow'

// Follow the OS light/dark setting (Electron maps it to prefers-color-scheme).
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  document.documentElement.classList.toggle('dark', darkQuery.matches)
}
applyTheme()
darkQuery.addEventListener('change', applyTheme)

// The accent colour is a setting: put it on <html> now and whenever it changes (from any window, or another device).
// The last value is remembered in localStorage so the first paint already has it; main's answer then corrects it.
const ACCENT_KEY = 'accent'
const applyAccent = (accent: string): void => {
  document.documentElement.dataset.accent = accent
  try {
    localStorage.setItem(ACCENT_KEY, accent)
  } catch {
    // storage unavailable: the accent still applies for this session
  }
}
let remembered: unknown
try {
  remembered = localStorage.getItem(ACCENT_KEY)
} catch {
  // storage unavailable
}
document.documentElement.dataset.accent = isAccent(remembered) ? remembered : 'neutral'
void window.api.getSettings().then((s) => applyAccent(s.accent))
window.api.onSettingsChanged((s) => applyAccent(s.accent))

// One bundle, two windows: the settings window loads index.html#settings.
const isSettingsWindow = window.location.hash === '#settings'
if (isSettingsWindow) document.title = 'Settings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSettingsWindow ? <SettingsWindow /> : <App />}</StrictMode>
)
