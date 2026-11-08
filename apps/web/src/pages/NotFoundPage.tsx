import type { JSX } from 'react'
import { Link } from 'react-router'

export function NotFoundPage(): JSX.Element {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <Link className="underline" to="/">
        Back to the home page
      </Link>
    </div>
  )
}
