import type { JSX } from 'react'
import { cn } from '@repo/ui'
import { NavLink, Outlet } from 'react-router'
import { SITE_NAME } from '../config'
import { authClient } from '../lib/auth'

const link = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'text-sm transition-colors hover:text-foreground',
    isActive ? 'text-foreground' : 'text-muted-foreground'
  )

export function Layout(): JSX.Element {
  const { data: session } = authClient.useSession()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <NavLink to="/" className="font-semibold" end>
            {SITE_NAME}
          </NavLink>
          <div className="flex items-center gap-5">
            <NavLink to="/download" className={link}>
              Download
            </NavLink>
            <NavLink to="/app" className={link}>
              Open web app
            </NavLink>
            {session && (
              <NavLink to="/account" className={link}>
                Account
              </NavLink>
            )}
            {session ? (
              <button
                type="button"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => void authClient.signOut()}
              >
                Sign out
              </button>
            ) : (
              <NavLink to="/sign-in" className={link}>
                Sign in
              </NavLink>
            )}
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {SITE_NAME}
      </footer>
    </div>
  )
}
