import { app, screen, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

const defaults: WindowState = { width: 900, height: 670, isMaximized: false }
const statePath = (): string => join(app.getPath('userData'), 'window-state.json')

/** True if the saved position is still on a connected display (monitors get unplugged). */
function isVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false
  const { x, y, width, height } = state
  return screen.getAllDisplays().some(({ bounds: b }) => {
    return x < b.x + b.width && x + width > b.x && y < b.y + b.height && y + height > b.y
  })
}

export function loadWindowState(): WindowState {
  try {
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<WindowState>
    const state: WindowState = {
      width: Math.max(Number(saved.width) || defaults.width, 480),
      height: Math.max(Number(saved.height) || defaults.height, 360),
      x: saved.x,
      y: saved.y,
      isMaximized: saved.isMaximized === true
    }
    return isVisible(state) ? state : { ...state, x: undefined, y: undefined }
  } catch {
    return { ...defaults }
  }
}

/** Save size, position and maximized state as the user changes them, and once more on close. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    // getNormalBounds ignores maximize, so we keep the "restored" size to return to.
    const { x, y, width, height } = win.getNormalBounds()
    const state: WindowState = { x, y, width, height, isMaximized: win.isMaximized() }
    try {
      writeFileSync(statePath(), JSON.stringify(state, null, 2))
    } catch (error) {
      console.error('[window-state]', error)
    }
  }
  const saveSoon = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  }

  win.on('resize', saveSoon)
  win.on('move', saveSoon)
  win.on('maximize', saveSoon)
  win.on('unmaximize', saveSoon)
  win.on('close', () => {
    clearTimeout(timer)
    save()
  })
}
