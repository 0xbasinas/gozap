import type { JSX } from 'react'
import { buttonVariants } from '@repo/ui'
import { Link } from 'react-router'
import { SITE_NAME } from '../config'

const FEATURES = [
  { title: 'Fast and native', text: 'A real desktop app with a tray, shortcuts and offline use.' },
  {
    title: 'Updates itself',
    text: 'New versions download in the background and install on restart.'
  },
  { title: 'Also in your browser', text: 'The same product runs on the web, with your account.' }
]

export function HomePage(): JSX.Element {
  return (
    <div className="space-y-16">
      <section className="space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{SITE_NAME}</h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          Use it on your desktop, or open it in the browser. Same app, same data.
        </p>
        <div className="flex justify-center gap-3">
          <Link to="/download" className={buttonVariants({ size: 'lg' })}>
            Download
          </Link>
          <Link to="/app" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
            Open web app
          </Link>
        </div>
      </section>
      <section className="grid gap-6 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-border p-5">
            <h2 className="font-medium">{f.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
