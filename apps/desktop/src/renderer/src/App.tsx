import { useCallback, useEffect, useState } from 'react'
import type { WhatsNew } from '../../shared/ipc'
import logo from './assets/logo.png'
import { TitleBar } from '@renderer/components/TitleBar'
import { TitleBarButton } from '@renderer/components/TitleBarButton'
import { UpdateBanner } from '@renderer/components/UpdateBanner'
import { WhatsNewDialog } from '@renderer/components/WhatsNewDialog'
import { useSettings } from '@renderer/hooks/useSettings'
import { InfoIcon, RefreshIcon, SettingsIcon } from '@renderer/components/icons'
import { useUpdater } from '@renderer/hooks/useUpdater'

function App(): React.JSX.Element {
  const { electron, chrome, node } = window.api.versions
  const updater = useUpdater()
  const { settings } = useSettings()
  const [whatsNew, setWhatsNew] = useState<WhatsNew>()
  const [opened, setOpened] = useState<string>()

  useEffect(() => {
    // First run, or the version changed since last time: show the welcome / release notes.
    void window.api.getWhatsNew().then(setWhatsNew)
    const offMenu = window.api.onMenuCheckUpdates(updater.check)
    const offNews = window.api.onMenuWhatsNew(() => {
      void window.api.getWhatsNew(true).then(setWhatsNew)
    })
    const offLink = window.api.onDeepLink((url) => setOpened(`Deep link: ${url}`))
    const offFile = window.api.onOpenFile((path) => setOpened(`Opened file: ${path}`))
    return () => {
      offMenu()
      offNews()
      offLink()
      offFile()
    }
  }, [updater.check])

  const closeWhatsNew = useCallback(() => {
    setWhatsNew(undefined)
    void window.api.markWhatsNewSeen()
  }, [])

  return (
    <>
      <TitleBar>
        <TitleBarButton
          label={updater.checking ? 'Checking for updates...' : 'Check for updates'}
          disabled={updater.checking}
          onClick={updater.check}
        >
          <RefreshIcon className={updater.checking ? 'animate-spin' : undefined} />
        </TitleBarButton>
        <TitleBarButton
          label="What's new"
          onClick={() => void window.api.getWhatsNew(true).then(setWhatsNew)}
        >
          <InfoIcon />
        </TitleBarButton>
        <TitleBarButton label="Settings" onClick={() => window.api.openSettings()}>
          <SettingsIcon />
        </TitleBarButton>
      </TitleBar>
      <UpdateBanner updater={updater} />
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 pt-16">
        <img src={logo} alt="" className="size-20 rounded-2xl" />
        <h1 className="text-3xl font-semibold tracking-tight">Electron Desktop Template</h1>
        <p className="max-w-md text-center text-muted-foreground">
          Electron + Vite + React + TypeScript + Tailwind + shadcn/ui, with auto-updates and CI.
        </p>
        <p className="text-sm text-muted-foreground">
          Update channel: {settings?.updateChannel === 'beta' ? 'beta' : 'stable'}
        </p>
        {opened && <p className="max-w-md break-all text-center text-sm">{opened}</p>}
        <p className="text-xs text-muted-foreground">
          Electron {electron} · Chromium {chrome} · Node {node}
        </p>
      </main>
      {whatsNew && <WhatsNewDialog data={whatsNew} onClose={closeWhatsNew} />}
    </>
  )
}

export default App
