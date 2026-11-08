import { useEffect, useState } from 'react'

/** True while the site says this version is too old to use (see MIN_APP_VERSION on the API). */
export function useUpdateRequired(): boolean {
  const [required, setRequired] = useState(false)
  useEffect(() => {
    void window.api.getUpdateRequired().then(setRequired)
    return window.api.onUpdateRequiredChanged(setRequired)
  }, [])
  return required
}
