import { useEffect, useState } from 'react'

/** Every feature flag for this install, kept up to date (a kill switch on the server arrives within minutes). */
export function useFlags(): Record<string, boolean> {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  useEffect(() => {
    void window.api.getFlags().then(setFlags)
    return window.api.onFlagsChanged(setFlags)
  }, [])
  return flags
}

/** Is a feature on? Off until the site says otherwise, so a new feature never shows up by accident. */
export function useFlag(key: string): boolean {
  return useFlags()[key] === true
}
