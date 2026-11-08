import { contextBridge } from 'electron'
import { api } from './api'

// The preload script runs in a sandbox, so it can only use Electron's own modules.
// With context isolation on, `window.api` is the only bridge between the page and the main process.
try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
