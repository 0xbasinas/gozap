import { useCallback, useEffect, useState } from 'react'
import type { Account } from '../../../shared/ipc'

/** Who is signed in, kept in sync with main. `signIn` opens the system browser. */
export function useAccount(): {
  account: Account | undefined
  signIn: () => Promise<void>
  signOut: () => Promise<void>
} {
  const [account, setAccount] = useState<Account>()

  useEffect(() => {
    void window.api.getAccount().then(setAccount)
    return window.api.onAccountChanged(setAccount)
  }, [])

  const signIn = useCallback(() => window.api.signIn(), [])
  const signOut = useCallback(async (): Promise<void> => {
    await window.api.signOut()
    setAccount(await window.api.getAccount())
  }, [])

  return { account, signIn, signOut }
}
