import { dialog, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/ipc'
import { revealLogs } from './logger'
import { openSettingsWindow } from './settingsWindow'
import { requestUpdateCheck, requestWhatsNew, showWindow } from './windowUtils'

// Where the Help menu points. `pnpm rename` updates this for your own repo.
const REPO_URL = 'https://github.com/0xbasinas/electron-desktop-template'

const isMac = process.platform === 'darwin'

async function openFileDialog(win: BrowserWindow): Promise<void> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Template file', extensions: ['tpl'] }]
  })
  if (canceled || !filePaths[0]) return
  showWindow(win)
  win.webContents.send(IPC.openFile, filePaths[0])
}

/**
 * The application menu. On Windows and Linux the bar is hidden by the custom title bar, but the
 * accelerators below still work. On macOS it is the standard menu bar.
 */
export function setupMenu(getWindow: () => BrowserWindow | undefined): void {
  const withWindow = (fn: (win: BrowserWindow) => void | Promise<void>) => (): void => {
    const win = getWindow()
    if (win) void fn(win)
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CommandOrControl+O',
          click: withWindow(openFileDialog)
        },
        {
          label: 'Settings...',
          accelerator: 'CommandOrControl+,',
          click: () => openSettingsWindow(getWindow())
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        // Reload and DevTools are development-only so end users can't break the app with them.
        ...(is.dev
          ? ([
              { role: 'reload' },
              { role: 'toggleDevTools' },
              { type: 'separator' }
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: "What's New", click: withWindow(requestWhatsNew) },
        { label: 'Check for Updates...', click: withWindow(requestUpdateCheck) },
        { type: 'separator' },
        { label: 'Show Log File', click: () => revealLogs() },
        { label: 'Documentation', click: () => shell.openExternal(`${REPO_URL}#readme`) },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal(`${REPO_URL}/issues/new/choose`)
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
