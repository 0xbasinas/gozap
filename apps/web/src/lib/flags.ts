import { useEffect, useState } from 'react'
import { api } from './api'

const KEY = 'install-id'
const REFRESH_MS = 5 * 60 * 1000

/** A random id for this browser, only sent to the flags route (it decides who falls inside a percentage). */
function installId(): string | undefined {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved
    const id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    // Storage blocked: without an id only flags at 0% or 100% can be decided.
    return undefined
  }
}

/** Every feature flag for this browser. Empty (everything off) until the site answers or if it cannot be reached. */
export function useFlags(): Record<string, boolean> {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      api
        .flags('stable', installId())
        .then((answer) => {
          if (!cancelled) setFlags(answer.flags)
        })
        .catch((e: unknown) => console.error(e))
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  return flags
}

/** Is a feature on? Off until the site says otherwise. */
export function useFlag(key: string): boolean {
  return useFlags()[key] === true
}
