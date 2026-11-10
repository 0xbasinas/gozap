import { Suspense, type JSX } from 'react'
import { cn } from '@repo/ui'
import { Link, NavLink, Outlet } from 'react-router'
import { SITE_NAME } from '../config'
import { authClient } from '../lib/auth'
import { ImpersonationBanner } from './ImpersonationBanner'
import { Menu, menuItem } from './Menu'
import { PresenceBeat } from './PresenceBeat'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const tab = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-muted font-medium text-foreground'
      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
  )

/** The frame for the signed-in part of the site: workspace switcher, page tabs and the profile menu. */
export function AppLayout(): JSX.Element {
  const { data: session } = authClient.useSession()
  const email = session?.user.email ?? ''
  const staff = ['admin', 'support'].includes(
    (session?.user as { role?: string | null } | undefined)?.role ?? ''
  )

  return (
    <div className="flex min-h-screen flex-col">
      <ImpersonationBanner />
      {session && <PresenceBeat userId={session.user.id} />}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          <Link to="/app" className="shrink-0 font-semibold">
            {SITE_NAME}
          </Link>
          {session && <WorkspaceSwitcher />}
          <div className="flex-1" />
          {session && (
            <Menu
              label="Account menu"
              align="right"
              trigger={
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {email.slice(0, 1).toUpperCase()}
                </span>
              }
            >
              {(close) => (
                <>
                  <p className="truncate px-3 py-2 text-xs text-muted-foreground">{email}</p>
                  <Link role="menuitem" to="/account" className={menuItem} onClick={close}>
                    Account
                  </Link>
                  <Link role="menuitem" to="/download" className={menuItem} onClick={close}>
                    Download the app
                  </Link>
                  <a role="menuitem" href="/docs/" className={menuItem}>
                    Docs
                  </a>
                  <Link role="menuitem" to="/feedback" className={menuItem} onClick={close}>
                    Feedback
                  </Link>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => {
                      close()
                      void authClient.signOut()
                    }}
                  >
                    Sign out
                  </button>
                </>
              )}
            </Menu>
          )}
        </div>
        {session && (
          <nav aria-label="App" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
            <NavLink to="/app" className={tab} end>
              Home
            </NavLink>
            <NavLink to="/teams" className={tab}>
              Teams
            </NavLink>
            <NavLink to="/account" className={tab}>
              Account
            </NavLink>
            {staff && (
              <NavLink to="/admin" className={tab}>
                Admin
              </NavLink>
            )}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
