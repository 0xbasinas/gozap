import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '../../../shared/ipc'

/** Current settings, kept in sync across windows. `update` saves a change through main. */
export function useSettings(): {
  settings: Settings | undefined
  update: (patch: Partial<Settings>) => Promise<void>
} {
  const [settings, setSettings] = useState<Settings>()

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    return window.api.onSettingsChanged(setSettings)
  }, [])

  const update = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    setSettings(await window.api.updateSettings(patch))
  }, [])

  return { settings, update }
}
