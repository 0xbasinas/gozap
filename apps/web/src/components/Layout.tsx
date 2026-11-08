import type { JSX } from 'react'
import { cn } from '@repo/ui'
import { Link, NavLink, Outlet } from 'react-router'
import { SITE_NAME } from '../config'
import { authClient } from '../lib/auth'

const link = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'text-sm transition-colors hover:text-foreground',
    isActive ? 'text-foreground' : 'text-muted-foreground'
  )

export function Layout(): JSX.Element {
  const { data: session } = authClient.useSession()
  const impersonating = Boolean(
    (session?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy
  )
  return (
    <div className="flex min-h-screen flex-col">
      {impersonating && (
        <div
          role="status"
          className="flex items-center justify-center gap-3 bg-muted px-4 py-2 text-sm"
        >
          You are signed in as {session?.user.email} to help them.
          <button
            type="button"
            className="underline"
            onClick={() =>
              void authClient.admin.stopImpersonating().then(() => window.location.assign('/admin'))
            }
          >
            Stop
          </button>
        </div>
      )}
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <NavLink to="/" className="font-semibold" end>
            {SITE_NAME}
          </NavLink>
          <div className="flex items-center gap-5">
            <NavLink to="/download" className={link}>
              Download
            </NavLink>
            <NavLink to="/releases" className={link}>
              Releases
            </NavLink>
            <NavLink to="/app" className={link}>
              Open web app
            </NavLink>
            {['admin', 'support'].includes(
              (session?.user as { role?: string | null } | undefined)?.role ?? ''
            ) && (
              <NavLink to="/admin" className={link}>
                Admin
              </NavLink>
            )}
            {session && (
              <NavLink to="/teams" className={link}>
                Teams
              </NavLink>
            )}
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
        {SITE_NAME} ·{' '}
        <Link className="underline" to="/feedback">
          Feedback
        </Link>{' '}
        ·{' '}
        <Link className="underline" to="/sub-processors">
          Sub-processors
        </Link>{' '}
        ·{' '}
        <Link className="underline" to="/status">
          Version status
        </Link>{' '}
        ·{' '}
        <a className="underline" href="/.well-known/security.txt">
          Security
        </a>
      </footer>
    </div>
  )
}
